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

import { FatalError } from 'workflow'
import {
  appendEvent,
  getEventCount,
  getEventsSince,
  getMessagesSince,
  refreshMessageCount,
  // Renamed locally to disambiguate from this file's recordTurnUsage
  // step. The room-store helper recomputes aggregates from events;
  // the workflow step is the event-write + aggregate-refresh pair.
  refreshRoomTokenAggregates as bumpRoomTokenAggregates,
  updateRoomStatus,
  type AgentInfo,
} from '../lib/room-store.js'
// Phase 4.5d-2.3: route through the local factory so integration
// tests can swap in a deterministic mock via WORKFLOW_TEST=1. The
// factory's GenerateFn signature is identical to @agora/llm's;
// production behavior is unchanged when WORKFLOW_TEST is unset.
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

  // Destructure outside the try: TypeScript's call-site contract on
  // start() prevents null/undefined input; if it somehow happens, the
  // API route's try/catch around start() (apps/web/app/api/rooms/route.ts
  // -- the WDK enqueue catch) flips the room to 'error' before the
  // workflow runtime ever sees the bad input. No belt-and-suspenders
  // needed at this layer.
  const { roomId, agents, rounds } = input

  // Outer try/catch is the terminal-error guard (4.5d-2.4). Any
  // throw from inside the body -- validation, step exhaustion,
  // invariant violation -- runs through `markRoomError` so the
  // room row leaves 'running' and gets a recoverable error message.
  // Without this, a step's permanent failure leaves the row at
  // 'running' forever (markOrphanedAsError now skips WDK rooms by
  // design, so the cron sweeper won't rescue it either).
  //
  // Re-throw at the end preserves WDK's failure recording -- the run
  // is still marked failed in the workflow runtime's run log even
  // after we marked the room.
  try {
    // Boundary validation at the workflow boundary. NOTE: FatalError
    // vs plain Error is mechanically identical at the workflow-body
    // level -- WDK only honors the fatal flag inside step bodies
    // (where it skips retries). Used here as a signal-of-intent:
    // "this error category should never be retried at any layer."
    // Validation outcomes are deterministic on input, so retry is
    // never useful regardless of the type used.
    if (typeof roomId !== 'string' || roomId.length === 0) {
      throw new FatalError('roomId must be a non-empty UUID string')
    }
    if (agents.length < 2 || agents.length > 8) {
      throw new FatalError('roundtable requires 2..8 agents')
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
      if (!ALLOWED_PROVIDERS.includes(a.model.provider)) {
        throw new FatalError(`agent ${a.id}: bad provider "${a.model.provider}"`)
      }
      if (!a.model.modelId || a.model.modelId.length === 0) {
        throw new FatalError(`agent ${a.id}: model.modelId required`)
      }
    }

    await emitRoomStarted({ roomId })

    const totalTurns = agents.length * rounds
    for (let turnIdx = 0; turnIdx < totalTurns; turnIdx++) {
      const agentIdx = turnIdx % agents.length
      const agent = agents[agentIdx]
      if (!agent) {
        // Invariant: agentIdx is always in [0, agents.length).
        // FatalError used as signal-of-intent (see body-level
        // validation comment above) -- mechanically identical to
        // plain Error at workflow-body level, but signals "code bug,
        // not transient" to anyone reading the file.
        throw new FatalError(`invariant: missing agent at idx ${agentIdx}`)
      }

      // Pre-flight DB short-circuit: if a prior workflow run already
      // wrote this turn's message (e.g. crash + restart from seeded
      // state), skip both steps. This is OUTSIDE the steps so it
      // doesn't bloat any step-input cache; the workflow function
      // re-runs cheaply on replay.
      const alreadyDone = await isTurnAlreadyPersisted({ roomId, turnIdx })
      if (alreadyDone) continue

      // Step 1 (cached by WDK): generate the LLM reply. Retry of
      // step 2 does NOT re-invoke step 1 -- WDK serves step 1's
      // cached result. Returns content + usage so step 3 has the
      // numbers without re-paying the LLM call.
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
      // Returns the messageId so step 3 can reference it in the
      // token:recorded event without computing a separate UUID.
      const messageId = await persistAgentMessage({
        roomId,
        turnIdx,
        agentId: agent.id,
        agentName: agent.name,
        content: reply.content,
      })

      // Step 3 (4.5d-2.5): persist token usage. Idempotent under
      // standard WDK retry (step throws / transient failure). NOT
      // idempotent under delivery-failure-after-success retries --
      // see recordTurnUsage's body comment for the full hazard
      // analysis and the 4.5d-2.6 schema work that closes it.
      await recordTurnUsage({
        roomId,
        agentId: agent.id,
        messageId,
        provider: agent.model.provider,
        modelId: agent.model.modelId,
        usage: reply.usage,
      })
    }

    await emitRoomEnded({ roomId })
    await markRoomComplete({ roomId })

    return { roomId, totalTurns }
  } catch (error) {
    // markRoomError is itself a step -- WDK retries on transient DB
    // failure. Inner try/catch preserves the ORIGINAL error in the
    // re-throw: if markRoomError exhausts retries (sustained DB
    // outage), we don't want WDK's run_failed event to record the
    // markRoomError exception as the run cause -- the user cares
    // about WHY the workflow failed (LLM provider down, timeout,
    // etc.), not about a downstream side-effect failure. Attach
    // markErr as Error.cause for forensics.
    //
    // Row-state semantics on sustained DB outage: stays 'running'
    // (since markRoomError didn't succeed). This is the same
    // failure mode as today -- nothing new is broken at the row
    // level, but the run-log attribution is now correct.
    const message = error instanceof Error ? error.message : String(error)
    try {
      await markRoomError({ roomId, message })
    } catch (markErr) {
      console.error(
        `[roundtableWorkflow] markRoomError failed for room ${roomId}; ` +
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
  readonly usage: TokenUsage
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

  // History role tagging: own messages -> 'assistant' (raw, no
  // prefix), others' messages -> 'user' with `[name]:` prefix. This
  // preserves the self-vs-other distinction the LLM needs to use
  // first-person consistently.
  //
  // NOTE: this DIVERGES from the legacy AIAgent path
  // (packages/core/src/agent.ts:98-99 messageToChatMessage), which
  // tags ALL messages as 'user' with `[name]:` prefix and provides
  // no own-vs-other signal. Alignment is tracked in
  // apps/web/tests/durability/cross-runtime-equivalence.integration.test.ts
  // (the .skip'd "TURN 2+" test + the .not.toEqual regression marker).
  // Until the legacy path is updated, content-level cross-runtime
  // equivalence cannot hold for multi-round runs starting at the
  // turn where an agent first sees its own past message.
  const history = priorMessages.map((m: Message) => {
    if (m.senderId === agentId) {
      return { role: 'assistant' as const, content: m.content }
    }
    return { role: 'user' as const, content: `[${m.senderName}]: ${m.content}` }
  })

  // createGenerateFn is the clean LLM wrapper without eventBus
  // coupling. Token cost tracking lives in the separate
  // recordTurnUsage step (4.5d-2.5) which receives the usage from
  // here as input. Splitting LLM call from cost-recording prevents
  // a recordTurnUsage retry from re-paying for the LLM call.
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

  // Compute seq inside the step (Rule 2). If two workflows for the
  // same room ever ran concurrently (forbidden by the room-creation
  // 409 guard, but defensive), both could compute the same seq —
  // appendEvent's ON CONFLICT DO NOTHING silently drops the loser.
  // The cross-runtime equivalence guarantee depends on the room-
  // creation guard preventing this case from happening in practice.
  const seq = await getEventCount(roomId)

  // Deterministic messageId derived from (roomId, turnIdx, agentId).
  // Was random crypto.randomUUID() before 4.5d-2.5; combined with
  // the events_message_id_uq partial UNIQUE index added in 4.5d-2.6
  // (packages/db/drizzle/0010_event_content_key_idempotency.sql),
  // step retries triggered by `step_completed` delivery failure
  // re-execute the body, recompute the same id, and the duplicate
  // INSERT is swallowed by ON CONFLICT in appendEvent. End-to-end
  // idempotency without the previous "ghost message" failure mode.
  const messageId = deriveTurnMessageId(roomId, turnIdx, agentId)
  const message: Message = {
    id: messageId,
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
      // NOTE (cross-runtime equivalence): legacy AIAgent populates
      // metadata.tokenUsage / provider / modelId here. WDK does NOT
      // -- the WDK runtime carries token data in the separate
      // `token:recorded` event written by recordTurnUsage. Both
      // runtimes' room-aggregate readers go through the events log,
      // so the live UI is consistent. Future replay/audit code that
      // reads message.metadata directly for cost will silently miss
      // WDK rooms.
    },
  }

  const event: PlatformEvent = { type: 'message:created', message }
  await appendEvent(roomId, seq, event)

  // 4.5d-2.6: refresh rooms.messageCount from events log. WDK path
  // didn't bump this column at all in 4.5d-2.5, leaving WDK rooms
  // with messageCount=0 in the UI. refreshMessageCount is idempotent
  // (recomputes from events), so retries don't double-count.
  await refreshMessageCount(roomId)

  // Return messageId so the workflow body can wire it into the
  // subsequent recordTurnUsage step. The ID is deterministic on
  // input, so workflow replays + step retries see the same value
  // (no reliance on WDK's step-result cache for ID stability).
  return messageId
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

  // Resolve pricing inline. The LiteLLM registry is process-cached
  // (packages/llm/src/pricing.ts module-level Promise), so the first
  // turn pays the fetch latency and subsequent turns hit the cache.
  // Per-call resolution -- vs. passing a pre-built pricing map as
  // workflow input -- keeps step inputs scalar (Rule 6) and avoids
  // bloating the step-input cache with a pricing-map blob.
  //
  // CROSS-PROCESS DETERMINISM: WDK runs steps in isolated worker
  // contexts. Different turns can land on different workers, each
  // with its own LiteLLM registry fetch. If LiteLLM updates its JSON
  // mid-run (rare; hourly-to-daily cadence vs. <5min workflow), turn
  // N and turn N+1 could see different prices for the same model.
  // Bounded impact: USD aggregates only, no control-flow decision
  // depends on cost. Acceptable for V1. To harden: pre-resolve in
  // POST /api/rooms and pass a (model -> pricing) map as workflow
  // input -- O(agents) bounded, ~1KB step-input bloat. Defer.
  const pricing = await resolvePricing(provider, modelId)
  const cost = calculateCost(usage, pricing)

  // RETRY-IDEMPOTENCY (full, after 4.5d-2.6 schema migration):
  //
  //   * appendEvent: idempotent at TWO levels:
  //       - PK (roomId, seq) catches concurrent-tick collisions.
  //       - events_token_message_id_uq partial UNIQUE catches
  //         delivery-failure-after-success retries (where the prior
  //         attempt succeeded at seq=N and the retry recomputes
  //         seq=N+1). Both indexes are swallowed by the untargeted
  //         ON CONFLICT DO NOTHING in appendEvent.
  //
  //   * refreshRoomTokenAggregates (renamed from recordTokenUsage):
  //     idempotent by construction. Recomputes totalCost / totalTokens
  //     / callCount as SUM/COUNT over the events log. Multiple
  //     invocations for the same room produce the same result.
  //
  // Operation order no longer matters for idempotency (both ops are
  // independently idempotent), but kept event-write-first for clean
  // semantics: the aggregate refresh sees the just-written event.
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

interface MarkRoomErrorInput {
  readonly roomId: string
  readonly message: string
}

async function markRoomError(input: MarkRoomErrorInput): Promise<void> {
  'use step'
  // Idempotent: setting status='error' twice writes the same value.
  // updateRoomStatus also sets endedAt + clears waiting-state fields
  // (waitingFor/waitingUntil), so a partially-paused room is left
  // in a clean terminal state.
  //
  // NOTE for future modes (werewolf/open-chat): this drops
  // waitingFor/waitingUntil -- same behavior as completed runs but
  // loses the debug breadcrumb of where exactly the error happened.
  // When porting werewolf, decide whether to copy this step (and
  // optionally preserve waiting fields in a new errorContext JSONB)
  // vs. share this implementation.
  //
  // EVENTS-LOG GAP: this step does NOT emit a 'room:failed' event.
  // The live UI reads `snapshot.status + snapshot.error` from the
  // row directly so it shows the error correctly. The replay UI
  // (apps/web/app/replay/[id]/page.tsx) reconstructs status purely
  // from events and currently has no 'room:failed' to consume --
  // failed rooms render as 'running' in replay. Pre-existing issue
  // (http_chain has the same gap), tracked separately for future
  // reconciliation: introduce a 'room:failed' PlatformEvent variant
  // and emit it here alongside the row update.
  //
  // Step retries handle transient DB blips. If the DB is sustained-
  // unreachable, the step exhausts retries and the workflow's catch
  // block re-throws -- the room stays at 'running' (the failure mode
  // we're trying to fix), but that's exactly today's behavior, not
  // a regression.
  await updateRoomStatus(input.roomId, 'error', input.message)
}

// ── Helpers (compile-time consumers) ───────────────────────

/**
 * Derive a deterministic messageId for a turn.
 *
 * Format: `rt-${roomId}-t${turnIdx}-${agentId}`. The format itself
 * is load-bearing for retry idempotency -- combined with the partial
 * UNIQUE index `events_message_id_uq` (packages/db/drizzle/0010_*),
 * a step-internal retry that re-runs persistAgentMessage at a NEW
 * seq is silently no-op'd by ON CONFLICT.
 *
 * INPUT DOMAIN (callers must satisfy):
 * - `roomId` and `agentId` MUST be UUIDs (`gen_random_uuid()`-format).
 *   UUIDs are hex characters + `-`; they cannot contain the letter
 *   't' that precedes turnIdx in the format. This guarantees the
 *   format is unambiguous: `rt-X-t5-Y` cannot collide with `rt-X-t-t5-Y`
 *   because UUIDs never contain a substring like `-t-`.
 * - `turnIdx` MUST be a non-negative integer.
 *
 * Synthetic / test inputs that break these constraints (e.g. roomId
 * 'r-t5', agentId 't0-a') CAN collide. The test fixture in
 * `apps/web/tests/durability/roundtable-workflow.test.ts` includes
 * a boundary case that documents the trade-off; production-bound
 * callers are safe by construction.
 *
 * If the format ever changes, you MUST also reconcile any existing
 * data that may have legacy ids -- and update the format-pinning
 * test. Pinning prevents an accidental rename from quietly breaking
 * idempotency for in-flight rooms.
 */
export function deriveTurnMessageId(
  roomId: string,
  turnIdx: number,
  agentId: string,
): string {
  return `rt-${roomId}-t${turnIdx}-${agentId}`
}

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
