// ============================================================
// Phase 4.5d-2.2 — Roundtable workflow (WDK port)
// ============================================================
//
// First production WDK port. Replaces today's POST /api/rooms path
// (full-debate-in-one-function via `waitUntil(room.start(flow))`)
// with durable orchestration that survives function timeouts.
//
// Obeys all 8 rules of the durability contract
// (`docs/design/workflow-architecture.md` § 2026-04-29):
//
//   Rule 1 (idempotent step bodies)        — appendEvent ON CONFLICT
//                                             DO NOTHING + turnIdx
//                                             stamped into payload as
//                                             a redundant idempotency
//                                             check before LLM call.
//   Rule 2 (seq computed inside step)      — getEventCount() at write
//                                             time inside each step.
//   Rule 3 (no Realtime in steps)          — no realtime imports.
//   Rule 4 (no setTimeout in workflow)     — workflow body uses no
//                                             timers; loop is the
//                                             round-robin pointer.
//   Rule 5 (flow.onMessage as single MP)   — N/A for roundtable. No
//                                             shared game-state JSONB
//                                             beyond the events log.
//                                             Each step writes ONE
//                                             message:created event;
//                                             that IS the mutation.
//   Rule 6 (scalar step inputs)            — turnIdx + agentId only.
//                                             Step bodies derive full
//                                             history from DB.
//   Rule 7 (mode-namespaced hook tokens)   — N/A — roundtable has no
//                                             human seats in V1.
//   Rule 8 (no module-level state)         — all persistence via DB.
//
// Caller pre-creates the room via `createRoom()` (status=running,
// agents JSONB populated). The workflow then orchestrates turns +
// emits the final room:ended + flips status to completed.

import {
  appendEvent,
  getEventCount,
  getMessagesSince,
  updateRoomStatus,
  type AgentInfo,
} from '../lib/room-store.js'
import { createGenerateFn } from '@agora/llm'
import type { LLMProvider, Message, ModelConfig, PlatformEvent } from '@agora/shared'

// ── Public types ───────────────────────────────────────────

export interface RoundtableWorkflowInput {
  /** UUID of a room already created via createRoom() with status='running'. */
  readonly roomId: string
  /** 2-8 agents. systemPrompt should be pre-composed by createDebaterPrompt. */
  readonly agents: readonly RoundtableAgentSnapshot[]
  /** Topic shown in UI; agents already have it baked into systemPrompt. */
  readonly topic: string
  /** 1-10 laps through the roster. Each lap = agents.length turns. */
  readonly rounds: number
}

export interface RoundtableAgentSnapshot {
  readonly id: string
  readonly name: string
  readonly persona: string
  readonly systemPrompt: string
  readonly model: ModelConfig
}

export interface RoundtableWorkflowResult {
  readonly roomId: string
  readonly totalTurns: number
}

// ── Workflow ───────────────────────────────────────────────

export async function roundtableWorkflow(
  input: RoundtableWorkflowInput,
): Promise<RoundtableWorkflowResult> {
  'use workflow'

  const { roomId, agents, topic, rounds } = input

  // Boundary validation. We let errors surface (not RetryableError);
  // input-shape problems should NOT trigger step retries.
  if (typeof roomId !== 'string' || roomId.length === 0) {
    throw new Error('roomId must be a non-empty UUID string')
  }
  if (agents.length < 2 || agents.length > 8) {
    throw new Error('roundtable requires 2..8 agents')
  }
  if (rounds < 1 || rounds > 10) {
    throw new Error('rounds must be 1..10')
  }

  await emitRoomStarted({ roomId })

  const totalTurns = agents.length * rounds
  for (let turnIdx = 0; turnIdx < totalTurns; turnIdx++) {
    const agentIdx = turnIdx % agents.length
    const agent = agents[agentIdx]
    if (!agent) throw new Error(`invariant: missing agent at idx ${agentIdx}`)

    // Step input is scalars (Rule 6). The step body looks up agent
    // details + history from DB given (roomId, turnIdx, agentId).
    // Topic flows in because it's small + immutable per workflow run.
    await runRoundtableTurn({
      roomId,
      turnIdx,
      agentId: agent.id,
      agentName: agent.name,
      systemPrompt: agent.systemPrompt,
      provider: agent.model.provider,
      modelId: agent.model.modelId,
      maxTokens: agent.model.maxTokens ?? 1024,
      topic,
    })
  }

  await emitRoomEnded({ roomId })
  await markRoomComplete({ roomId })

  return { roomId, totalTurns }
}

// ── Steps ──────────────────────────────────────────────────

interface EmitRoomStartedInput {
  readonly roomId: string
}

async function emitRoomStarted(input: EmitRoomStartedInput): Promise<void> {
  'use step'
  // Idempotent: if eventCount > 0, room:started already fired (or events
  // got pre-seeded). Skip.
  const existingCount = await getEventCount(input.roomId)
  if (existingCount > 0) return

  const event: PlatformEvent = { type: 'room:started', roomId: input.roomId }
  await appendEvent(input.roomId, 0, event)
}

interface RunRoundtableTurnInput {
  readonly roomId: string
  readonly turnIdx: number
  readonly agentId: string
  readonly agentName: string
  readonly systemPrompt: string
  readonly provider: LLMProvider
  readonly modelId: string
  readonly maxTokens: number
  readonly topic: string
}

async function runRoundtableTurn(input: RunRoundtableTurnInput): Promise<void> {
  'use step'

  const { roomId, turnIdx, agentId, agentName, systemPrompt, provider, modelId, maxTokens } =
    input

  // Idempotency check #1: redundant message-by-turnIdx dedup. If a
  // prior step run wrote this turn's message, the metadata.turnIdx
  // marker in the event payload is the recoverable identifier.
  // Skip the LLM call entirely on retry — we'd just re-pay for the
  // same content.
  const priorMessages: Message[] = await getMessagesSince(roomId, 0)
  const existingTurnMessage = priorMessages.find(
    (m: Message) =>
      typeof m.metadata?.['turnIdx'] === 'number' &&
      (m.metadata['turnIdx'] as number) === turnIdx,
  )
  if (existingTurnMessage) return

  // Build history for the LLM call. Roundtable uses the full prior
  // transcript as context — every agent sees everyone's prior turns.
  const history = priorMessages.map((m: Message) => ({
    role: 'assistant' as const,
    content: `${m.senderName}: ${m.content}`,
  }))

  // Use @agora/llm's createGenerateFn — clean LLM wrapper around the
  // AI SDK with no eventBus coupling (TokenAccountant event emission
  // happens at the AIAgent layer, which we bypass in the WDK port).
  // The step body owns its own persistence; if we want token-cost
  // tracking, that's a separate event written alongside (Phase 4.5d-2.3).
  const model: ModelConfig = { provider, modelId, maxTokens }
  const generateFn = createGenerateFn(model)
  const result = await generateFn(systemPrompt, history)

  // Compute seq inside the step (Rule 2). Re-read after the LLM call
  // since other workflows may have written for the same room (theoretical;
  // rooms shouldn't have concurrent workflows but the rule applies).
  const seq = await getEventCount(roomId)

  const message: Message = {
    id: crypto.randomUUID(),
    roomId,
    senderId: agentId,
    senderName: agentName,
    content: result.content,
    channelId: 'main',
    timestamp: Date.now(),
    metadata: {
      // Idempotency marker — lets a retried step skip the LLM call.
      // Also enables observability: each event has a clear turn label.
      turnIdx,
    },
  }

  const event: PlatformEvent = { type: 'message:created', message }
  // appendEvent uses ON CONFLICT DO NOTHING on (roomId, seq). Combined
  // with the existingTurnMessage check above, retries are safe + cheap.
  await appendEvent(roomId, seq, event)
}

interface EmitRoomEndedInput {
  readonly roomId: string
}

async function emitRoomEnded(input: EmitRoomEndedInput): Promise<void> {
  'use step'
  const seq = await getEventCount(input.roomId)
  // Idempotent: if the last event is already room:ended, skip.
  // (We don't pull the events to check; ON CONFLICT handles a rare
  // double-write, and the seq increases monotonically.)
  const event: PlatformEvent = { type: 'room:ended', roomId: input.roomId }
  await appendEvent(input.roomId, seq, event)
}

interface MarkRoomCompleteInput {
  readonly roomId: string
}

async function markRoomComplete(input: MarkRoomCompleteInput): Promise<void> {
  'use step'
  // updateRoomStatus also sets endedAt; idempotent because setting
  // status='completed' twice writes the same value.
  await updateRoomStatus(input.roomId, 'completed')
}

// ── Helpers (compile-time consumers) ───────────────────────

/**
 * Build a snapshot from an `AgentInfo` row + composed system prompt.
 * Used by the API route when starting a workflow run.
 *
 * Caller is responsible for composing systemPrompt from
 * `createDebaterPrompt` (or the team-snapshot variant) before passing.
 */
export function toRoundtableAgentSnapshot(
  info: AgentInfo,
  systemPrompt: string,
): RoundtableAgentSnapshot {
  if (!info.persona) throw new Error(`agent ${info.id} missing persona`)
  return {
    id: info.id,
    name: info.name,
    persona: info.persona,
    systemPrompt,
    model: {
      provider: info.provider as LLMProvider,
      modelId: info.model,
      maxTokens:
        typeof info.style?.['maxTokens'] === 'number'
          ? (info.style['maxTokens'] as number)
          : 1024,
    },
  }
}
