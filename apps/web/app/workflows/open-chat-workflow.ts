// ============================================================
// Phase 4.5d-2.9 — Open-chat workflow (WDK port)
// ============================================================
//
// Second production WDK port. Mirrors `roundtable-workflow.ts`'s
// shape but adds the createHook-based pause/resume for human seats
// that the spike (`spike/4.5d-2.0-wdk-port:apps/web/app/workflows/
// open-chat-spike.ts`) validated. The non-AI substrate work --
// terminal-error guard (4.5d-2.4), deterministic message IDs +
// content-key idempotency (4.5d-2.6), token-cost tracking
// (4.5d-2.5) -- is shared with roundtable; this file's diff is
// almost entirely the human-seat branch.
//
// Obeys all 8 rules of the durability contract
// (`docs/design/workflow-architecture.md` § 2026-04-29):
//
//   Rule 1 (idempotent step bodies)        — Per-AI-turn split into
//                                             generateAgentReply +
//                                             persistAgentMessage +
//                                             recordTurnUsage; per-
//                                             human-turn into
//                                             persistHumanMessage.
//                                             createHook is a workflow
//                                             primitive, not a step,
//                                             and is replay-safe by
//                                             design (resumeHook is
//                                             at-most-once).
//   Rule 2 (seq computed inside step)      — getEventCount() at write
//                                             time inside each step.
//   Rule 3 (no Realtime in steps)          — no realtime imports.
//   Rule 4 (no setTimeout in workflow)     — workflow body uses no
//                                             timers; loop is the
//                                             round-robin pointer.
//   Rule 5 (flow.onMessage as single MP)   — N/A. Each step writes
//                                             ONE message:created
//                                             event; that IS the
//                                             mutation. Game-state
//                                             snapshot (turnsCompleted
//                                             counter the legacy path
//                                             keeps in rooms.gameState)
//                                             is intentionally NOT
//                                             reproduced -- the events
//                                             log is the source of
//                                             truth, and the live UI
//                                             counts message:created
//                                             events directly.
//   Rule 6 (scalar step inputs)            — turnIdx + agentId only.
//                                             Step bodies derive full
//                                             history from DB.
//   Rule 7 (mode-namespaced hook tokens)   — humanTurnToken format
//                                             `agora/room/<uuid>/mode/
//                                             open-chat/turn/<idx>`
//                                             namespaces under `mode/`
//                                             so werewolf can drop in
//                                             `mode/werewolf-day-vote`
//                                             without collision.
//   Rule 8 (no module-level state)         — all persistence via DB.

import { createHook, FatalError } from 'workflow'
import {
  appendEvent,
  getEventCount,
  getEventsSince,
  getMessagesSince,
  getRoom,
  refreshMessageCount,
  refreshRoomTokenAggregates as bumpRoomTokenAggregates,
  setGameState,
  updateRoomStatus,
  type AgentInfo,
} from '../lib/room-store.js'
import { createGenerateFn } from '../lib/llm-factory.js'
import { resolvePricing, calculateCost } from '@agora/llm'
import type {
  LLMProvider,
  Message,
  ModelConfig,
  PlatformEvent,
  TokenUsage,
} from '@agora/shared'

// ── Public types ───────────────────────────────────────────

export interface OpenChatWorkflowInput {
  /** UUID of a room already created via createRoom() with status='running'. */
  readonly roomId: string
  /** 1..12 agents. systemPrompt should be pre-composed (with leader directive baked in). */
  readonly agents: readonly OpenChatAgentSnapshot[]
  /** Topic shown in UI; agents already have it baked into systemPrompt. */
  readonly topic: string
  /** 1..10 laps through the roster. Each lap = agents.length turns. */
  readonly rounds: number
}

export interface OpenChatAgentSnapshot {
  readonly id: string
  readonly name: string
  readonly persona: string
  readonly systemPrompt: string
  readonly model: ModelConfig
  /** True if this seat is human-controlled. Workflow pauses on their turn. */
  readonly isHuman?: boolean
}

export interface OpenChatWorkflowResult {
  readonly roomId: string
  readonly totalTurns: number
}

// ── Hook-token contract ────────────────────────────────────
//
// Deterministic per (roomId, turnIdx) so external resumers (the
// human-input UI, or test harness) compute the token without round-
// tripping to the workflow run id. Mirrors the spike's contract
// (commit 206e0f0 on spike/4.5d-2.0-wdk-port).
//
// Format: slash-separated path so 4.5d-2.x werewolf can drop in
// `mode/werewolf-day-vote`, `mode/werewolf-night-action`, etc.
// without colliding with this namespace. Tokens must be unique
// across all RUNNING workflows (per WDK hook-conflict.mdx);
// collision risk is gated at the room-creation layer (don't start
// a second workflow for an already-running roomId).
//
// LOAD-BEARING: external resumers (`/api/rooms/.../human-input`)
// reconstruct the same string from URL params and call resumeHook.
// A format change without coordinated callers silently drops human
// turns on the floor.

export function humanTurnToken(roomId: string, turnIdx: number): string {
  return `agora/room/${roomId}/mode/open-chat/turn/${turnIdx}`
}

// ── Workflow ───────────────────────────────────────────────

export async function openChatWorkflow(
  input: OpenChatWorkflowInput,
): Promise<OpenChatWorkflowResult> {
  'use workflow'

  const { roomId, agents, rounds } = input

  // Outer try/catch is the terminal-error guard (4.5d-2.4). Same
  // pattern as roundtable-workflow.ts. Any throw inside the body --
  // validation, step exhaustion, invariant violation -- runs through
  // markRoomError so the room row leaves 'running' and gets a
  // recoverable error message.
  try {
    if (typeof roomId !== 'string' || roomId.length === 0) {
      throw new FatalError('roomId must be a non-empty UUID string')
    }
    // roomId is also embedded in humanTurnToken; reject `/` so a
    // malformed input can't silently shift the token shape and
    // collide with another room's hook namespace.
    if (roomId.includes('/')) {
      throw new FatalError('roomId must not contain "/"')
    }
    if (agents.length < 1 || agents.length > 12) {
      throw new FatalError('open-chat requires 1..12 agents')
    }
    if (rounds < 1 || rounds > 10) {
      throw new FatalError('rounds must be 1..10')
    }
    for (const a of agents) {
      if (!a.id || a.id.length === 0) throw new FatalError('agent.id required')
      if (!a.name || a.name.length === 0) {
        throw new FatalError(`agent ${a.id}: name required`)
      }
      if (!a.systemPrompt || a.systemPrompt.length === 0) {
        throw new FatalError(`agent ${a.id}: systemPrompt required`)
      }
      // Defense-in-depth: workflows accept arbitrary JSON, not the
      // TypeScript-checked OpenChatAgentSnapshot. A non-human seat
      // missing `a.model` would otherwise throw a low-quality
      // TypeError at the .provider read below; surface a clean
      // FatalError instead.
      if (!a.isHuman && !a.model) {
        throw new FatalError(`agent ${a.id}: model required`)
      }
      // Allowed providers checked only for AI seats. Human seats may
      // still carry a placeholder model config (cosmetic; not used).
      if (!a.isHuman && !ALLOWED_PROVIDERS.includes(a.model.provider)) {
        throw new FatalError(`agent ${a.id}: bad provider "${a.model.provider}"`)
      }
      if (!a.isHuman && (!a.model.modelId || a.model.modelId.length === 0)) {
        throw new FatalError(`agent ${a.id}: model.modelId required`)
      }
    }

    await emitRoomStarted({ roomId })

    const totalTurns = agents.length * rounds
    for (let turnIdx = 0; turnIdx < totalTurns; turnIdx++) {
      const agentIdx = turnIdx % agents.length
      const agent = agents[agentIdx]
      if (!agent) {
        throw new FatalError(`invariant: missing agent at idx ${agentIdx}`)
      }

      // Pre-flight DB short-circuit: identical to roundtable. If a
      // prior run already wrote this turn's message (crash + restart
      // from seeded state), skip the work. Cheap full-history read
      // since open-chat is bounded at 12 * 10 = 120 turns.
      const alreadyDone = await isTurnAlreadyPersisted({ roomId, turnIdx })
      if (alreadyDone) continue

      if (agent.isHuman) {
        // Human seat: pause the workflow waiting for resumeHook from
        // the /api/rooms/.../human-input endpoint. createHook is a
        // workflow PRIMITIVE (not a step), so replay-safety comes
        // from WDK directly: on workflow restart, the hook is
        // re-registered with the same token and a previously
        // received event is replayed without re-blocking.
        //
        // resumeHook is per-turn at-most-once IN PRACTICE: this
        // `await hook` form consumes only the FIRST received event.
        // The workflow then advances to the next turn's hook
        // (different token), so any stray duplicate resumeHook for
        // this turn just buffers a `hook_received` event that's
        // never consumed -- the buffer is disposed at run
        // termination or earlier when `using` triggers `dispose()`.
        // The runtime does NOT reject duplicates; that's the
        // human-input endpoint's authZ job.
        //
        // `using hook = ...` (TC39 explicit resource management)
        // disposes the hook at the end of this block scope -- frees
        // the token reservation BEFORE the next turn's hook is
        // registered, instead of holding all 12*10=120 tokens for
        // the entire workflow lifetime. Per WDK's docs/foundations
        // /hooks.mdx best practice for short-lived hooks.
        //
        // ORDERING IS LOAD-BEARING:
        //   1. createHook FIRST (synchronous primitive -- registers
        //      the token in the workflow runtime's hook storage)
        //   2. markWaitingForHuman SECOND (writes status='waiting'
        //      + gameState.waitingForHuman / waitingForTurnIdx)
        //   3. await hook
        //
        // If markWaitingForHuman ran first, a poll-based caller (UI
        // refresh or in-process test) sees status='waiting' before
        // the hook is registered. resumeHook called in that window
        // throws HookNotFoundError. Reversing the order closes the
        // race -- by the time status='waiting' is observable, the
        // hook is already in storage and resumeHook succeeds even
        // if it fires before the workflow body actually awaits.
        //
        // The UI contract `status === 'waiting' && gameState
        // .waitingForHuman` (HumanPlayBar.tsx:44) holds: cleared
        // by markRunningAgain AFTER persistHumanMessage on the
        // happy path. On error, the outer catch's markRoomError
        // sets status='error' which overrides any stale waiting
        // fields in the UI's isMyTurn check.
        {
          using hook = createHook<HumanTurnPayload>({
            token: humanTurnToken(roomId, turnIdx),
          })
          await markWaitingForHuman({ roomId, agentId: agent.id, turnIdx })
          const event = await hook

          // Defense-in-depth: the human-input endpoint (4.5d-2.10
          // and onward) is expected to validate payload shape, but
          // workflows can also be resumed by other tooling (Vercel
          // dashboard, scripts). Guard the persistence step so a
          // missing/empty text doesn't write an unrenderable
          // message:created event. FatalError signals "input
          // problem -- don't retry" since retries always see the
          // same buffered event.
          if (typeof event.text !== 'string' || event.text.length === 0) {
            throw new FatalError(
              `turn ${turnIdx} (agent ${agent.id}): human payload missing text`,
            )
          }

          await persistHumanMessage({
            roomId,
            turnIdx,
            agentId: agent.id,
            agentName: agent.name,
            content: event.text,
          })
        }
        await markRunningAgain({ roomId })
      } else {
        // AI seat: same three-step shape as roundtable. Step 1 caches
        // the LLM result; step 2's retry doesn't re-invoke the LLM.
        const reply = await generateAgentReply({
          roomId,
          turnIdx,
          agentId: agent.id,
          systemPrompt: agent.systemPrompt,
          provider: agent.model.provider,
          modelId: agent.model.modelId,
          maxTokens: agent.model.maxTokens ?? 1024,
        })

        const messageId = await persistAgentMessage({
          roomId,
          turnIdx,
          agentId: agent.id,
          agentName: agent.name,
          content: reply.content,
        })

        await recordTurnUsage({
          roomId,
          agentId: agent.id,
          messageId,
          provider: agent.model.provider,
          modelId: agent.model.modelId,
          usage: reply.usage,
        })
      }
    }

    await emitRoomEnded({ roomId })
    await markRoomComplete({ roomId })

    return { roomId, totalTurns }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await markRoomError({ roomId, message })
    } catch (markErr) {
      console.error(
        `[openChatWorkflow] markRoomError failed for room ${roomId}; ` +
          `room row stays at 'running'. Original error: ${message}`,
        markErr,
      )
      if (error instanceof Error) {
        ;(error as Error & { cause?: unknown }).cause = markErr
      }
    }
    throw error
  }
}

const ALLOWED_PROVIDERS: readonly LLMProvider[] = [
  'anthropic',
  'openai',
  'google',
  'deepseek',
]

/**
 * Payload shape for a human-seat hook resume.
 *
 * LOAD-BEARING: external resumers (`/api/rooms/[id]/human-input`)
 * construct this exact shape and pass it to `resumeHook`. The
 * workflow body's `await hook` returns the same shape. A drift here
 * silently misroutes the human turn -- the workflow's defense-in-
 * depth check (text non-empty) catches the missing-field case but
 * not a renamed field. Exported so callers share the type.
 */
export interface HumanTurnPayload {
  /** The human's typed message. */
  readonly text: string
}

// ── Steps ──────────────────────────────────────────────────

interface EmitRoomStartedInput {
  readonly roomId: string
}

async function emitRoomStarted(input: EmitRoomStartedInput): Promise<void> {
  'use step'
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
  readonly usage: TokenUsage
}

async function generateAgentReply(
  input: GenerateAgentReplyInput,
): Promise<GenerateAgentReplyResult> {
  'use step'

  const { roomId, agentId, systemPrompt, provider, modelId, maxTokens } = input

  const priorMessages: Message[] = await getMessagesSince(roomId, 0)

  // Identical to roundtable's history role tagging. Own messages ->
  // 'assistant' raw, others -> 'user' with `[name]:` prefix.
  // Cross-runtime equivalence requires this match -- 4.5d-2.7 aligned
  // legacy AIAgent's messageToChatMessage to the same shape.
  const history = priorMessages.map((m: Message) => {
    if (m.senderId === agentId) {
      return { role: 'assistant' as const, content: m.content }
    }
    return { role: 'user' as const, content: `[${m.senderName}]: ${m.content}` }
  })

  const model: ModelConfig = { provider, modelId, maxTokens }
  const generateFn = createGenerateFn(model)
  const result = await generateFn(systemPrompt, history)

  return { content: result.content, usage: result.usage }
}

interface PersistAgentMessageInput {
  readonly roomId: string
  readonly turnIdx: number
  readonly agentId: string
  readonly agentName: string
  readonly content: string
}

async function persistAgentMessage(input: PersistAgentMessageInput): Promise<string> {
  'use step'

  const { roomId, turnIdx, agentId, agentName, content } = input

  const seq = await getEventCount(roomId)

  // Open-chat's deterministic message-id namespace. The `oc-` prefix
  // distinguishes from roundtable's `rt-` so the events_message_id_uq
  // partial UNIQUE works correctly across modes -- two rooms running
  // different modes can never collide on the same id.
  const messageId = deriveOpenChatMessageId(roomId, turnIdx, agentId)
  const message: Message = {
    id: messageId,
    roomId,
    senderId: agentId,
    senderName: agentName,
    content,
    channelId: 'main',
    timestamp: Date.now(),
    metadata: { turnIdx },
  }

  const event: PlatformEvent = { type: 'message:created', message }
  await appendEvent(roomId, seq, event)
  await refreshMessageCount(roomId)

  return messageId
}

interface PersistHumanMessageInput {
  readonly roomId: string
  readonly turnIdx: number
  readonly agentId: string
  readonly agentName: string
  readonly content: string
}

async function persistHumanMessage(input: PersistHumanMessageInput): Promise<void> {
  'use step'

  const { roomId, turnIdx, agentId, agentName, content } = input

  const seq = await getEventCount(roomId)

  // Same id namespace as AI seats -- the AI/human distinction is
  // implicit in the senderId mapping (the `agents` snapshot tags
  // human seats), not in the id format. Keeps the partial UNIQUE
  // index simple.
  const messageId = deriveOpenChatMessageId(roomId, turnIdx, agentId)
  // Note: human-vs-AI distinction is identified at the senderId
  // boundary -- the room snapshot's `agents[i].isHuman` flag is the
  // source of truth, used by RoundtableView / WerewolfView for
  // rendering. Don't tag a metadata.source here -- the legacy
  // http_chain path uses `{ isHumanInput: true, turnId }` (different
  // shape) and the rest of the codebase reads neither convention,
  // so adding a third tag would just create more drift to clean up.
  // Field divergence note (4.5d-2.9): WDK uses `metadata.turnIdx`
  // (numeric -- isTurnAlreadyPersisted reads this); legacy human-
  // input uses `metadata.turnId` (string semantic). Different fields
  // intentionally. No cross-runtime room migration translates
  // between them today.
  const message: Message = {
    id: messageId,
    roomId,
    senderId: agentId,
    senderName: agentName,
    content,
    channelId: 'main',
    timestamp: Date.now(),
    metadata: { turnIdx },
  }

  const event: PlatformEvent = { type: 'message:created', message }
  await appendEvent(roomId, seq, event)
  await refreshMessageCount(roomId)
}

interface RecordTurnUsageInput {
  readonly roomId: string
  readonly agentId: string
  readonly messageId: string
  readonly provider: LLMProvider
  readonly modelId: string
  readonly usage: TokenUsage
}

async function recordTurnUsage(input: RecordTurnUsageInput): Promise<void> {
  'use step'

  const { roomId, agentId, messageId, provider, modelId, usage } = input

  const pricing = await resolvePricing(provider, modelId)
  const cost = calculateCost(usage, pricing)

  const seq = await getEventCount(roomId)
  const event: PlatformEvent = {
    type: 'token:recorded',
    roomId,
    agentId,
    messageId,
    provider,
    modelId,
    usage,
    cost,
  }
  await appendEvent(roomId, seq, event)
  await bumpRoomTokenAggregates(roomId)
}

interface EmitRoomEndedInput {
  readonly roomId: string
}

async function emitRoomEnded(input: EmitRoomEndedInput): Promise<void> {
  'use step'
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
  await updateRoomStatus(input.roomId, 'completed')
}

interface MarkRoomErrorInput {
  readonly roomId: string
  readonly message: string
}

async function markRoomError(input: MarkRoomErrorInput): Promise<void> {
  'use step'
  // Same idempotency + sustained-DB-outage semantics as roundtable's
  // markRoomError. See that file for the full rationale.
  await updateRoomStatus(input.roomId, 'error', input.message)
}

interface MarkWaitingForHumanInput {
  readonly roomId: string
  readonly agentId: string
  readonly turnIdx: number
}

/**
 * Mark the room as awaiting a specific human seat's input.
 *
 * Writes BOTH `gameState.waitingForHuman` (legacy UI contract --
 * `HumanPlayBar.tsx:44` reads this with `room.status === 'waiting'`)
 * AND `gameState.waitingForTurnIdx` (new for WDK -- the human-input
 * endpoint reads it to reconstruct `humanTurnToken(roomId, turnIdx)`
 * before calling `resumeHook`).
 *
 * Read-merge pattern preserves topic / totalTurns / leaderAgentId
 * that the open-chat creation route wrote at room-init. setGameState
 * OVERWRITES the JSONB column, so a partial write would clobber.
 *
 * IDEMPOTENT: replay re-runs read+merge with the same input ->
 * same output. waitingSince is captured INSIDE the step body, so
 * WDK's step-result cache pins it on first success and replay
 * returns the cached result without re-reading the clock.
 */
async function markWaitingForHuman(
  input: MarkWaitingForHumanInput,
): Promise<void> {
  'use step'
  const { roomId, agentId, turnIdx } = input

  const room = await getRoom(roomId)
  if (!room) {
    throw new FatalError(`markWaitingForHuman: room ${roomId} not found`)
  }
  const existing = (room.gameState ?? {}) as Record<string, unknown>

  // ORDERING INVARIANT: setGameState (gameState.waitingForHuman /
  // waitingForTurnIdx / waitingSince) MUST commit BEFORE
  // updateRoomStatus(..., 'waiting'). The /api/rooms/[id]/human-input
  // endpoint validates `room.status === 'waiting'` first, then reads
  // `gameState.waitingForTurnIdx` to reconstruct the hook token.
  // Reversing the writes opens a window where status='waiting' is
  // observable but the breadcrumb isn't yet committed -- the endpoint
  // would 500 on missing waitingForTurnIdx.
  //
  // Crash safety: a crash AFTER setGameState but BEFORE
  // updateRoomStatus leaves status='running' with the breadcrumb
  // partially written. The endpoint sees status='running' (returns
  // 409 -- correct, room not yet waiting). On WDK retry the step
  // re-runs both writes with the same args -- read-merge produces
  // the same output, setGameState overwrites with identical content,
  // updateRoomStatus is idempotent. No data corruption.
  await setGameState(roomId, {
    ...existing,
    waitingForHuman: agentId,
    waitingForTurnIdx: turnIdx,
    waitingSince: Date.now(),
  })
  await updateRoomStatus(roomId, 'waiting')
}

interface MarkRunningAgainInput {
  readonly roomId: string
}

/**
 * Clear the waiting-for-human breadcrumb and return to 'running'.
 *
 * Inverse of markWaitingForHuman. Strips waitingForHuman /
 * waitingForTurnIdx / waitingSince from gameState; preserves
 * topic / totalTurns / leaderAgentId. Sets status='running' so
 * the next turn (AI or human) renders correctly in the UI.
 *
 * Called only on the happy path (after persistHumanMessage). On
 * error the outer try/catch's markRoomError sets status='error'
 * which overrides waitingForHuman in the UI's isMyTurn check.
 *
 * IDEMPOTENT: replay re-strips already-stripped keys (no-op).
 */
async function markRunningAgain(
  input: MarkRunningAgainInput,
): Promise<void> {
  'use step'
  const { roomId } = input

  const room = await getRoom(roomId)
  if (!room) {
    throw new FatalError(`markRunningAgain: room ${roomId} not found`)
  }
  const existing = (room.gameState ?? {}) as Record<string, unknown>
  const {
    waitingForHuman: _h,
    waitingForTurnIdx: _t,
    waitingSince: _s,
    ...preserved
  } = existing
  void _h
  void _t
  void _s
  await setGameState(roomId, preserved)
  await updateRoomStatus(roomId, 'running')
}

// ── Helpers (compile-time consumers) ───────────────────────

/**
 * Derive a deterministic messageId for an open-chat turn.
 *
 * Format: `oc-${roomId}-t${turnIdx}-${agentId}`. The `oc-` prefix is
 * load-bearing -- it namespaces the open-chat content key so the
 * events_message_id_uq partial UNIQUE index (packages/db/drizzle/
 * 0010_event_content_key_idempotency.sql) cannot collide between
 * modes. Roundtable uses `rt-`; werewolf will pick another.
 *
 * INPUT DOMAIN (callers must satisfy):
 * - `roomId` and `agentId` MUST be UUIDs.
 * - `turnIdx` MUST be a non-negative integer.
 *
 * Synthetic / test inputs that break these constraints CAN collide.
 * The unit test at `apps/web/tests/durability/open-chat-workflow
 * .test.ts` includes a boundary case that documents the trade-off.
 *
 * If the format ever changes, you MUST also reconcile any existing
 * data that may have legacy ids -- and update the format-pinning
 * test. Pinning prevents an accidental rename from quietly breaking
 * idempotency for in-flight rooms.
 */
export function deriveOpenChatMessageId(
  roomId: string,
  turnIdx: number,
  agentId: string,
): string {
  return `oc-${roomId}-t${turnIdx}-${agentId}`
}

/**
 * Build a snapshot from an `AgentInfo` row + composed system prompt.
 * Used by the API route when starting a workflow run.
 *
 * Caller is responsible for composing systemPrompt before passing
 * (open-chat snapshots include the leader's dispatcher directive
 * baked into the system prompt -- buildTeamSnapshot does this).
 */
export function toOpenChatAgentSnapshot(
  info: AgentInfo,
  systemPrompt: string,
): OpenChatAgentSnapshot {
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
    isHuman: info.isHuman === true,
  }
}
