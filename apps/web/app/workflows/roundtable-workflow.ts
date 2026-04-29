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
//   Rule 1 (idempotent step bodies)        — Per-turn split into two
//                                             steps: generateAgentReply
//                                             (cached by WDK, retry
//                                             does NOT re-invoke LLM)
//                                             and persistAgentMessage
//                                             (ON CONFLICT-safe DB
//                                             write). The pre-flight
//                                             isTurnAlreadyPersisted
//                                             handles workflow-level
//                                             restart-from-scratch.
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
//
// Step layout per turn — TWO steps, not one:
//   1. generateAgentReply  — calls LLM, returns { content, usage }.
//      WDK caches THIS step's result. Retry of the persistence step
//      after this completes does NOT re-pay for the LLM call.
//   2. persistAgentMessage — writes appendEvent given content +
//      scalars. Cheap retries; ON CONFLICT DO NOTHING on (roomId,seq).
// The pre-flight DB poll for an existing-turn message is still useful
// (it short-circuits BOTH steps when the workflow is restarted from
// scratch with seeded state), but the retry-window cost claim now
// rests on WDK's step-result cache, not on a DB-poll race.

import {
  appendEvent,
  getEventCount,
  getEventsSince,
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

  const { roomId, agents, rounds } = input

  // Boundary validation at the workflow boundary. Errors surface as
  // workflow failure, NOT step retries (which would burn money on
  // shape problems). Validate everything once, up front.
  if (typeof roomId !== 'string' || roomId.length === 0) {
    throw new Error('roomId must be a non-empty UUID string')
  }
  if (agents.length < 2 || agents.length > 8) {
    throw new Error('roundtable requires 2..8 agents')
  }
  if (rounds < 1 || rounds > 10) {
    throw new Error('rounds must be 1..10')
  }
  for (const a of agents) {
    if (!a.id || a.id.length === 0) throw new Error('agent.id required')
    if (!a.name || a.name.length === 0) throw new Error(`agent ${a.id}: name required`)
    if (!a.systemPrompt || a.systemPrompt.length === 0) {
      throw new Error(`agent ${a.id}: systemPrompt required`)
    }
    if (!ALLOWED_PROVIDERS.includes(a.model.provider)) {
      throw new Error(`agent ${a.id}: bad provider "${a.model.provider}"`)
    }
    if (!a.model.modelId || a.model.modelId.length === 0) {
      throw new Error(`agent ${a.id}: model.modelId required`)
    }
  }

  await emitRoomStarted({ roomId })

  const totalTurns = agents.length * rounds
  for (let turnIdx = 0; turnIdx < totalTurns; turnIdx++) {
    const agentIdx = turnIdx % agents.length
    const agent = agents[agentIdx]
    if (!agent) throw new Error(`invariant: missing agent at idx ${agentIdx}`)

    // Pre-flight DB short-circuit: if a prior workflow run already
    // wrote this turn's message (e.g. crash + restart from seeded
    // state), skip both steps. This is OUTSIDE the steps so it
    // doesn't bloat any step-input cache; the workflow function
    // re-runs cheaply on replay.
    const alreadyDone = await isTurnAlreadyPersisted({ roomId, turnIdx })
    if (alreadyDone) continue

    // Step 1 (cached by WDK): generate the LLM reply. Retry of step 2
    // does NOT re-invoke step 1 — WDK serves step 1's cached result.
    const reply = await generateAgentReply({
      roomId,
      turnIdx,
      agentId: agent.id,
      systemPrompt: agent.systemPrompt,
      provider: agent.model.provider,
      modelId: agent.model.modelId,
      maxTokens: agent.model.maxTokens ?? 1024,
    })

    // Step 2: persist. Cheap; ON CONFLICT-safe; can retry freely.
    await persistAgentMessage({
      roomId,
      turnIdx,
      agentId: agent.id,
      agentName: agent.name,
      content: reply.content,
    })
  }

  await emitRoomEnded({ roomId })
  await markRoomComplete({ roomId })

  return { roomId, totalTurns }
}

const ALLOWED_PROVIDERS: readonly LLMProvider[] = [
  'anthropic',
  'openai',
  'google',
  'deepseek',
]

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

interface IsTurnAlreadyPersistedInput {
  readonly roomId: string
  readonly turnIdx: number
}

async function isTurnAlreadyPersisted(
  input: IsTurnAlreadyPersistedInput,
): Promise<boolean> {
  'use step'
  // Read all messages and check for the per-turn marker. Roundtable's
  // history is bounded (max 8 * 10 = 80 events), so a full read here
  // is cheap. Werewolf will need a smaller-window helper.
  const messages: Message[] = await getMessagesSince(input.roomId, 0)
  return messages.some(
    (m: Message) =>
      typeof m.metadata?.['turnIdx'] === 'number' &&
      (m.metadata['turnIdx'] as number) === input.turnIdx,
  )
}

interface GenerateAgentReplyInput {
  readonly roomId: string
  readonly turnIdx: number
  readonly agentId: string
  readonly systemPrompt: string
  readonly provider: LLMProvider
  readonly modelId: string
  readonly maxTokens: number
}

interface GenerateAgentReplyResult {
  readonly content: string
}

async function generateAgentReply(
  input: GenerateAgentReplyInput,
): Promise<GenerateAgentReplyResult> {
  'use step'

  const { roomId, agentId, systemPrompt, provider, modelId, maxTokens } = input

  // Read the full prior transcript from DB. The step input is scalars
  // (Rule 6); history is reconstructed inside the step from durable
  // state, NOT passed in. Prevents quadratic step-input cache growth.
  const priorMessages: Message[] = await getMessagesSince(roomId, 0)

  // History role tagging matches the legacy AIAgent path
  // (packages/core/src/agent.ts:90-99): own messages → 'assistant',
  // others' messages → 'user' with `[name]:` prefix. This preserves
  // the agent's self-vs-other distinction the LLM needs to use first-
  // person consistently. Cross-runtime equivalence depends on this
  // matching the legacy path.
  const history = priorMessages.map((m: Message) => {
    if (m.senderId === agentId) {
      return { role: 'assistant' as const, content: m.content }
    }
    return { role: 'user' as const, content: `[${m.senderName}]: ${m.content}` }
  })

  // createGenerateFn is the clean LLM wrapper without eventBus
  // coupling. Token cost tracking is its own event (Phase 4.5d-2.3 —
  // emit a separate `usage:tracked` event alongside message:created).
  const model: ModelConfig = { provider, modelId, maxTokens }
  const generateFn = createGenerateFn(model)
  const result = await generateFn(systemPrompt, history)

  return { content: result.content }
}

interface PersistAgentMessageInput {
  readonly roomId: string
  readonly turnIdx: number
  readonly agentId: string
  readonly agentName: string
  readonly content: string
}

async function persistAgentMessage(input: PersistAgentMessageInput): Promise<void> {
  'use step'

  const { roomId, turnIdx, agentId, agentName, content } = input

  // Compute seq inside the step (Rule 2). If two workflows for the
  // same room ever ran concurrently (forbidden by the room-creation
  // 409 guard, but defensive), both could compute the same seq —
  // appendEvent's ON CONFLICT DO NOTHING silently drops the loser.
  // The cross-runtime equivalence guarantee depends on the room-
  // creation guard preventing this case from happening in practice.
  const seq = await getEventCount(roomId)

  const message: Message = {
    id: crypto.randomUUID(),
    roomId,
    senderId: agentId,
    senderName: agentName,
    content,
    channelId: 'main',
    timestamp: Date.now(),
    metadata: {
      // Per-turn idempotency marker. Lets `isTurnAlreadyPersisted`
      // detect this turn's prior write on workflow restart.
      turnIdx,
    },
  }

  const event: PlatformEvent = { type: 'message:created', message }
  await appendEvent(roomId, seq, event)
}

interface EmitRoomEndedInput {
  readonly roomId: string
}

async function emitRoomEnded(input: EmitRoomEndedInput): Promise<void> {
  'use step'
  // Idempotent via type-check: ON CONFLICT only catches (roomId, seq)
  // collisions, NOT duplicate events at different seqs. So a step
  // retry would write a SECOND room:ended at seq+1. Guard explicitly
  // by reading the events log for an existing room:ended.
  const events = await getEventsSince(input.roomId, -1)
  const alreadyEnded = events.some((e) => e.event.type === 'room:ended')
  if (alreadyEnded) return

  const seq = await getEventCount(input.roomId)
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
