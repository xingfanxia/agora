// ============================================================
// Room store — Postgres-backed reads and writes
// ============================================================
//
// The DB is the single source of truth for external reads.
// Live game runtime (EventBus, Room, Flow, Accountant) lives
// in memory in runtime-registry.ts on the lambda that runs the
// game; every emit is persisted here via appendEvent(). All API
// routes read from Postgres.

import type { LLMProvider, Message, PlatformEvent, TokenUsage } from '@agora/shared'
import type { EventRow, RoomRow } from '@agora/db'
import { events, getDb, rooms } from '@agora/db'
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm'
// Phase 4.5d-2.8 -- in-memory seam for cross-runtime equivalence tests.
// Each writer + the three reads exercised by the WDK roundtable workflow
// short-circuit to the memory adapter when WORKFLOW_TEST=1. Production
// never sets this flag (vitest configs set it for the durability suite),
// so the seam is dead code at runtime in real deployments. Static import
// is intentional -- matches the llm-factory.ts pattern (always imports
// the real path, branches on env at call time).
import {
  memAppendEvent,
  memCreateRoom,
  memFlipLobbyToRunning,
  memGetEventCount,
  memGetEventsSince,
  memGetMessagesSince,
  memGetRoom,
  memMarkSeatReady,
  memRefreshMessageCount,
  memRefreshRoomTokenAggregates,
  memSetCurrentPhase,
  memSetCurrentRound,
  memSetGameState,
  memSetThinkingAgent,
  memSetWaiting,
  memUpdateRoomStatus,
} from './room-store-memory.js'

/**
 * Test seam: when WORKFLOW_TEST=1, all writers + the four reads
 * exercised by the WDK roundtable workflow route through the
 * in-memory adapter (see `room-store-memory.ts`). Per-call env
 * check (not module-load) so a single test process can flip the
 * flag mid-run if needed -- matches the llm-factory contract.
 */
const inMemoryMode = (): boolean => process.env.WORKFLOW_TEST === '1'

// Lazy accessor: defers Postgres client creation until the first actual
// query. Prevents Next.js build-time page data collection from crashing
// when DB env vars aren't set.
const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    const instance = getDb() as unknown as Record<string | symbol, unknown>
    const value = instance[prop]
    return typeof value === 'function' ? (value as Function).bind(instance) : value
  },
})

/**
 * Room lifecycle status.
 *
 * - `lobby`: pre-start gate when the room has at least one human seat.
 *   The workflow has NOT been started yet; createRoom skipped `start()`
 *   and is waiting for all human seats to flip ready (via the
 *   `/seats/[agentId]/ready` endpoint) before resolveLobby() fires
 *   `start(workflow, ...)`. Owner can also force-start. Rooms with no
 *   human seats skip 'lobby' entirely and start at 'running'.
 * - `running`: workflow is active (AI turns proceeding).
 * - `waiting`: workflow paused on a human input (open-chat/werewolf
 *   day-vote, etc.). NOT used during lobby — the lobby gate predates
 *   workflow start.
 * - `completed` / `error`: terminal.
 */
export type RoomStatus = 'lobby' | 'running' | 'waiting' | 'completed' | 'error'

export interface WaitingDescriptor {
  /** Event type the runtime is waiting on (e.g. 'human:input'). */
  eventName: string
  /** Predicate the incoming event payload must match. */
  match: Record<string, unknown>
}

export interface AgentInfo {
  id: string
  name: string
  model: string
  provider: string
  // Phase 6 — optional snapshot fields for richer modes (open-chat).
  // Absent for older rooms (werewolf fast-path) which compose their own
  // system prompts at runtime from roleMap.
  persona?: string
  systemPrompt?: string
  style?: Record<string, unknown>
  avatarSeed?: string
  /** Phase 4.5c — true if this seat is human-controlled */
  isHuman?: boolean
}

// ── Create ──────────────────────────────────────────────────

export interface CreateRoomArgs {
  id: string
  modeId: string
  topic?: string | null
  config: unknown
  agents: readonly AgentInfo[]
  currentRound?: number
  roleAssignments?: Record<string, string>
  advancedRules?: Record<string, boolean>
  // Phase 6 — optional. Set when the room was composed from a team.
  teamId?: string | null
  // Phase 6 — structured mode config (rounds, topic, leader, etc.).
  modeConfig?: Record<string, unknown> | null
  createdBy?: string | null
  // Phase 4.5d-2 — durable runtime. Default 'http_chain' (legacy
  // advanceRoom + chained ticks). Set to 'wdk' for new rooms that
  // should run on Vercel Workflow DevKit. Immutable per-room: a
  // room's runtime is fixed at creation. Schema CHECK constraint
  // enforces values; default in DDL is 'http_chain'.
  runtime?: 'http_chain' | 'wdk'
  /**
   * P2 lobby gate. Default 'running' preserves the old behavior:
   * createRoom commits a row that's immediately ready for the
   * workflow to run. Pass 'lobby' when humans are present and the
   * caller wants to defer `start(workflow, ...)` until all human
   * seats flip ready (or the owner force-starts). Lobby resolution
   * lives in apps/web/app/lib/lobby.ts:resolveLobby.
   */
  initialStatus?: 'lobby' | 'running'
}

export async function createRoom(args: CreateRoomArgs): Promise<void> {
  if (inMemoryMode()) return memCreateRoom(args)
  await db.insert(rooms).values({
    id: args.id,
    modeId: args.modeId,
    topic: args.topic ?? null,
    config: args.config as object,
    agents: args.agents as unknown as object,
    currentRound: args.currentRound ?? 1,
    status: args.initialStatus ?? 'running',
    roleAssignments: (args.roleAssignments as object) ?? null,
    advancedRules: (args.advancedRules as object) ?? null,
    teamId: args.teamId ?? null,
    modeConfig: (args.modeConfig as object) ?? null,
    createdBy: args.createdBy ?? null,
    runtime: args.runtime ?? 'http_chain',
    startedAt: new Date(),
  })
}

// ── Event append ────────────────────────────────────────────

export async function appendEvent(
  roomId: string,
  seq: number,
  event: PlatformEvent,
): Promise<void> {
  if (inMemoryMode()) return memAppendEvent(roomId, seq, event)
  // Untargeted ON CONFLICT DO NOTHING -- swallows duplicates from
  // ANY unique constraint, including:
  //
  //   1. PK (roomId, seq): under concurrent ticks (inline self-invoke
  //      overlapping pg_cron), two invocations may compute the same seq.
  //      Determinism guarantees both would write the identical payload.
  //
  //   2. events_message_id_uq (4.5d-2.6, type='message:created'):
  //      WDK step retries triggered by step_completed delivery failure
  //      may re-execute persistAgentMessage at a NEW seq. The PK doesn't
  //      catch this -- but the partial UNIQUE on (roomId, message.id)
  //      does, because messageId is deterministic on (roomId, turnIdx,
  //      agentId). Duplicate at new seq -> silent no-op.
  //
  //   3. events_token_message_id_uq (4.5d-2.6, type='token:recorded'):
  //      Same hazard for recordTurnUsage. Caught by partial UNIQUE on
  //      (roomId, payload->>'messageId').
  //
  // Untargeted is correct here -- the table has multiple unique
  // constraints and we want to swallow any of them. Targeted ON
  // CONFLICT requires Postgres to identify a specific index; expression
  // indexes with WHERE predicates are awkward to specify via Drizzle's
  // typed builder. Untargeted side-steps that and is semantically what
  // we want.
  await db
    .insert(events)
    .values({
      roomId,
      seq,
      type: event.type,
      payload: event as unknown as object,
    })
    .onConflictDoNothing()
}

// ── Incremental room updates ────────────────────────────────

export async function setCurrentPhase(roomId: string, phase: string | null): Promise<void> {
  if (inMemoryMode()) return memSetCurrentPhase(roomId, phase)
  await db.update(rooms).set({ currentPhase: phase }).where(eq(rooms.id, roomId))
}

export async function setCurrentRound(roomId: string, round: number): Promise<void> {
  if (inMemoryMode()) return memSetCurrentRound(roomId, round)
  await db.update(rooms).set({ currentRound: round }).where(eq(rooms.id, roomId))
}

export async function setThinkingAgent(
  roomId: string,
  agentId: string | null,
): Promise<void> {
  if (inMemoryMode()) return memSetThinkingAgent(roomId, agentId)
  await db.update(rooms).set({ thinkingAgentId: agentId }).where(eq(rooms.id, roomId))
}

export async function setGameState(
  roomId: string,
  gameState: Record<string, unknown>,
): Promise<void> {
  if (inMemoryMode()) return memSetGameState(roomId, gameState)
  await db.update(rooms).set({ gameState: gameState as object }).where(eq(rooms.id, roomId))
}

// ── P2 lobby gate helpers ───────────────────────────────────

/**
 * Atomically mark a seat as ready inside `gameState.seatReady[agentId]`.
 *
 * Implemented as a single-statement `jsonb_set` UPDATE so two humans
 * toggling ready concurrently can't race each other (the equivalent
 * read-modify-write in TS would lose updates). The `WHERE status =
 * 'lobby'` predicate guarantees the call no-ops once the gate has
 * resolved (someone hit force-start, or another seat's ready flip
 * already triggered the running-flip). Returns the new gameState +
 * agents snapshot for the caller's all-ready check, or `null` when
 * the room isn't in 'lobby' anymore.
 *
 * Returning `null` is the "you're too late" signal — the caller
 * should NOT then call resolveLobby; the room has already moved on.
 */
export interface MarkSeatReadyResult {
  gameState: Record<string, unknown>
  agents: AgentInfo[]
}
export async function markSeatReady(
  roomId: string,
  agentId: string,
): Promise<MarkSeatReadyResult | null> {
  if (inMemoryMode()) return memMarkSeatReady(roomId, agentId)
  // jsonb merge (||) + jsonb_build_object. We can't use jsonb_set with a
  // 2-deep path here: Postgres's `create_missing=true` only creates the
  // LAST element, and only if its immediate parent already exists. On a
  // freshly-created lobby room gameState is NULL → coalesces to '{}',
  // and `seatReady` doesn't exist as a parent, so jsonb_set silently
  // returns the input unchanged (the original P2 implementation hit
  // exactly this and never persisted any seat-ready flip).
  //
  // The `||` operator merges jsonb objects with right-side-wins on key
  // collision, so this both creates seatReady when missing AND preserves
  // its existing entries (every other human's prior ready flip) when
  // present. Other gameState keys are also preserved by the outer ||.
  // Single statement → still atomic against concurrent ready clicks.
  const result = await db
    .update(rooms)
    .set({
      gameState: sql`
        coalesce(${rooms.gameState}, '{}'::jsonb)
        || jsonb_build_object(
          'seatReady',
          coalesce(${rooms.gameState}->'seatReady', '{}'::jsonb)
          || jsonb_build_object(${agentId}::text, true)
        )
      `,
    })
    .where(and(eq(rooms.id, roomId), eq(rooms.status, 'lobby')))
    .returning({ gameState: rooms.gameState, agents: rooms.agents })
  if (result.length === 0) return null
  const row = result[0]!
  return {
    gameState: (row.gameState as Record<string, unknown>) ?? {},
    agents: (row.agents as unknown as AgentInfo[]) ?? [],
  }
}

/**
 * Compare-and-swap flip from 'lobby' to 'running'. Returns true if
 * THIS call won the race (the caller should now fire start(workflow,
 * ...)). Returns false if another caller already won — workflow has
 * been started or is being started by them, do nothing.
 *
 * Uses a single UPDATE ... WHERE status='lobby' RETURNING id so the
 * predicate + write are one atomic statement. No transaction needed.
 *
 * Naturally idempotent against duplicate calls: only the first one
 * gets the row back.
 */
export async function flipLobbyToRunning(roomId: string): Promise<boolean> {
  if (inMemoryMode()) return memFlipLobbyToRunning(roomId)
  const result = await db
    .update(rooms)
    .set({ status: 'running' })
    .where(and(eq(rooms.id, roomId), eq(rooms.status, 'lobby')))
    .returning({ id: rooms.id })
  return result.length === 1
}

export async function updateRoomStatus(
  roomId: string,
  status: RoomStatus,
  errorMessage?: string,
): Promise<void> {
  if (inMemoryMode()) return memUpdateRoomStatus(roomId, status, errorMessage)
  const now = new Date()
  const patch: Partial<RoomRow> = { status }
  if (status === 'completed' || status === 'error') patch.endedAt = now
  if (errorMessage) patch.errorMessage = errorMessage
  // Clear waiting fields whenever leaving 'waiting' state.
  if (status !== 'waiting') {
    patch.waitingFor = null
    patch.waitingUntil = null
  }
  await db.update(rooms).set(patch).where(eq(rooms.id, roomId))
}

export async function setWaiting(
  roomId: string,
  waitingFor: WaitingDescriptor,
  waitingUntil: Date | null,
): Promise<void> {
  if (inMemoryMode()) return memSetWaiting(roomId, waitingFor, waitingUntil)
  await db
    .update(rooms)
    .set({
      status: 'waiting',
      waitingFor: waitingFor as unknown as object,
      waitingUntil,
    })
    .where(eq(rooms.id, roomId))
}

// Aggregate refreshes (hot-read columns recomputed from events log)

/**
 * Refresh `rooms.messageCount` by recomputing from the events log.
 * 4.5d-2.6: replaces the prior `+= 1` increment pattern, which was
 * non-idempotent under WDK step retries (delivery-failure case).
 *
 * Idempotent by construction. Backwards-compatible alias
 * `incrementMessageCount` is exported below for any existing
 * callers; new code should call this directly.
 */
export async function refreshMessageCount(roomId: string): Promise<void> {
  if (inMemoryMode()) return memRefreshMessageCount(roomId)
  await db.execute(sql`
    UPDATE rooms r SET message_count = (
      SELECT count(*) FROM events
      WHERE room_id = r.id AND type = 'message:created'
    )
    WHERE r.id = ${roomId}
  `)
}

/**
 * @deprecated Use `refreshMessageCount` -- the increment behavior was
 * a 4.5d-2.5-and-earlier pattern that was non-idempotent. This alias
 * preserves the import name during the migration; remove when no
 * call sites reference it.
 */
export const incrementMessageCount = refreshMessageCount

/**
 * Refresh room token aggregates (totalCost, totalTokens, callCount)
 * by recomputing from the authoritative events log. Phase 4.5d-2.6
 * replaces the prior `+= N` increment pattern, which was non-idempotent
 * under WDK step retries triggered by `step_completed` delivery failure.
 *
 * Idempotent: multiple invocations for the same room produce the
 * same result. The events log is the single source of truth; the
 * denormalized aggregate columns are a read-cache that this refreshes.
 *
 * The legacy `(roomId, usage, cost)` signature is gone -- callers no
 * longer pass per-call deltas. Just `(roomId)` triggers a full refresh.
 *
 * Performance: roundtable max ~80 events, werewolf max ~150, both
 * easily SUM'd inline via the existing `events_room_type_idx` index
 * on (room_id, type). The 3 sub-SELECTs are fused into a single CTE
 * for one index lookup instead of three.
 *
 * NOTE: this recomputes regardless of room status. Callers that want
 * to avoid touching finalized aggregates should gate the call on
 * status. Today's only caller (the WDK recordTurnUsage step + the
 * legacy http_chain persist hook) only fires for live rooms, so the
 * gating is implicit.
 *
 * BIGINT cast on totalTokens: per-call usage is bounded but the SUM
 * across thousands of calls in long-running open-chat sessions can
 * approach INT_MAX (2^31). Cast to bigint defensively; the destination
 * column is integer and JS handles the bigint->number conversion fine
 * at typical magnitudes.
 */
export async function refreshRoomTokenAggregates(roomId: string): Promise<void> {
  if (inMemoryMode()) return memRefreshRoomTokenAggregates(roomId)
  await db.execute(sql`
    WITH agg AS (
      SELECT
        SUM((payload->>'cost')::float8)                       AS total_cost,
        SUM((payload->'usage'->>'totalTokens')::bigint)       AS total_tokens,
        COUNT(*)                                              AS call_count
      FROM events
      WHERE room_id = ${roomId} AND type = 'token:recorded'
    )
    UPDATE rooms SET
      total_cost   = COALESCE((SELECT total_cost FROM agg), 0),
      total_tokens = COALESCE((SELECT total_tokens FROM agg), 0),
      call_count   = (SELECT call_count FROM agg)
    WHERE id = ${roomId}
  `)
}

/**
 * @deprecated Renamed to `refreshRoomTokenAggregates` (the function is
 * a refresh, not an additive record). Old name kept as alias during
 * caller migration; remove once no code uses it.
 */
export const recordTokenUsage = refreshRoomTokenAggregates

// ── Reads ───────────────────────────────────────────────────

export interface AgentTotals {
  agentId: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheCreationTokens: number
  reasoningTokens: number
  totalTokens: number
  cost: number
  callCount: number
}

export interface ModelTotals {
  provider: LLMProvider
  modelId: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheCreationTokens: number
  reasoningTokens: number
  totalTokens: number
  cost: number
  callCount: number
}

export interface RoomSnapshot {
  id: string
  modeId: string
  topic: string | null
  config: unknown
  status: RoomStatus
  currentPhase: string | null
  currentRound: number
  thinkingAgentId: string | null
  agents: AgentInfo[]
  roleAssignments: Record<string, string> | null
  advancedRules: Record<string, boolean> | null
  gameState: Record<string, unknown> | null
  tokenSummary: {
    totalCost: number
    totalTokens: number
    callCount: number
    byAgent: AgentTotals[]
    byModel: ModelTotals[]
  }
  error?: string | null
  startedAt: Date | null
  endedAt: Date | null
  createdAt: Date
  createdBy: string | null
}

export async function getRoom(roomId: string): Promise<RoomRow | null> {
  if (inMemoryMode()) {
    // The mem adapter's MemRoomRow is a structural superset of RoomRow
    // (same column names + types). Cast through unknown is safe per
    // the shape contract documented in room-store-memory.ts.
    return (memGetRoom(roomId) as unknown as RoomRow | undefined) ?? null
  }
  const [row] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  return row ?? null
}

/**
 * NOTE on the seam: this read is intentionally NOT routed through the
 * in-memory adapter. The token-summary aggregation queries (per-agent
 * + per-model GROUP BY over the events log via Drizzle SQL) would
 * require a non-trivial reimplementation that the cross-runtime
 * equivalence test doesn't exercise. Tests asserting room-snapshot
 * shape should read primitives via `getMemoryRoom` (room state) and
 * `getMemoryEvents` (events log) directly. Extend the seam here when
 * the first test needs a snapshot through the public API.
 */
export async function getRoomSnapshot(roomId: string): Promise<RoomSnapshot | null> {
  const row = await getRoom(roomId)
  if (!row) return null

  const tokenSummary = await getTokenSummary(roomId, row)

  return {
    id: row.id,
    modeId: row.modeId,
    topic: row.topic,
    config: row.config,
    status: row.status as RoomStatus,
    currentPhase: row.currentPhase,
    currentRound: row.currentRound,
    thinkingAgentId: row.thinkingAgentId,
    agents: (row.agents as unknown as AgentInfo[]) ?? [],
    roleAssignments: (row.roleAssignments as Record<string, string> | null) ?? null,
    advancedRules: (row.advancedRules as Record<string, boolean> | null) ?? null,
    gameState: (row.gameState as Record<string, unknown> | null) ?? null,
    tokenSummary,
    error: row.errorMessage,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
    createdBy: row.createdBy ?? null,
  }
}

async function getTokenSummary(
  roomId: string,
  row: RoomRow,
): Promise<RoomSnapshot['tokenSummary']> {
  // Per-agent and per-model totals come from token:recorded events —
  // single JSONB query with GROUP BY aggregation.
  const tokenEvents = await db
    .select({
      agentId: sql<string>`(payload->>'agentId')`.as('agent_id'),
      provider: sql<string>`(payload->>'provider')`.as('provider'),
      modelId: sql<string>`(payload->>'modelId')`.as('model_id'),
      cost: sql<number>`(payload->>'cost')::float8`.as('cost'),
      inputTokens: sql<number>`(payload->'usage'->>'inputTokens')::int`.as('input'),
      outputTokens: sql<number>`(payload->'usage'->>'outputTokens')::int`.as('output'),
      cachedInputTokens: sql<number>`(payload->'usage'->>'cachedInputTokens')::int`.as('cached'),
      cacheCreationTokens:
        sql<number>`(payload->'usage'->>'cacheCreationTokens')::int`.as('cache_create'),
      reasoningTokens: sql<number>`(payload->'usage'->>'reasoningTokens')::int`.as('reason'),
      totalTokens: sql<number>`(payload->'usage'->>'totalTokens')::int`.as('total'),
    })
    .from(events)
    .where(and(eq(events.roomId, roomId), eq(events.type, 'token:recorded')))

  const byAgent = new Map<string, AgentTotals>()
  const byModel = new Map<string, ModelTotals>()

  for (const r of tokenEvents) {
    const agent =
      byAgent.get(r.agentId) ??
      ({
        agentId: r.agentId,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        cost: 0,
        callCount: 0,
      } satisfies AgentTotals)
    agent.inputTokens += r.inputTokens || 0
    agent.outputTokens += r.outputTokens || 0
    agent.cachedInputTokens += r.cachedInputTokens || 0
    agent.cacheCreationTokens += r.cacheCreationTokens || 0
    agent.reasoningTokens += r.reasoningTokens || 0
    agent.totalTokens += r.totalTokens || 0
    agent.cost += r.cost || 0
    agent.callCount += 1
    byAgent.set(r.agentId, agent)

    const modelKey = `${r.provider}:${r.modelId}`
    const model =
      byModel.get(modelKey) ??
      ({
        provider: r.provider as LLMProvider,
        modelId: r.modelId,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        cost: 0,
        callCount: 0,
      } satisfies ModelTotals)
    model.inputTokens += r.inputTokens || 0
    model.outputTokens += r.outputTokens || 0
    model.cachedInputTokens += r.cachedInputTokens || 0
    model.cacheCreationTokens += r.cacheCreationTokens || 0
    model.reasoningTokens += r.reasoningTokens || 0
    model.totalTokens += r.totalTokens || 0
    model.cost += r.cost || 0
    model.callCount += 1
    byModel.set(modelKey, model)
  }

  return {
    totalCost: row.totalCost,
    totalTokens: row.totalTokens,
    callCount: row.callCount,
    byAgent: [...byAgent.values()],
    byModel: [...byModel.values()],
  }
}

/** Fetch messages with timestamp > afterTs. Used by the polling endpoint. */
export async function getMessagesSince(
  roomId: string,
  afterTs: number,
): Promise<Message[]> {
  if (inMemoryMode()) return memGetMessagesSince(roomId, afterTs)
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.roomId, roomId),
        eq(events.type, 'message:created'),
        afterTs > 0
          ? sql`(payload->'message'->>'timestamp')::bigint > ${afterTs}`
          : sql`true`,
      ),
    )
    .orderBy(asc(events.seq))
  return rows.map((r) => {
    const payload = r.payload as { message: Message }
    return payload.message
  })
}

/** Fetch indexed events for the observability timeline. */
export async function getEventsSince(
  roomId: string,
  afterSeq: number,
): Promise<{ index: number; timestamp: number; event: PlatformEvent }[]> {
  if (inMemoryMode()) return memGetEventsSince(roomId, afterSeq)
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.roomId, roomId), gt(events.seq, afterSeq)))
    .orderBy(asc(events.seq))
  return rows.map((r: EventRow) => {
    const payload = r.payload as PlatformEvent & { message?: { timestamp?: number } }
    const timestamp = payload.message?.timestamp ?? r.occurredAt.getTime()
    return { index: r.seq, timestamp, event: payload }
  })
}

/** Total number of events (for pagination). */
export async function getEventCount(roomId: string): Promise<number> {
  if (inMemoryMode()) return memGetEventCount(roomId)
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.roomId, roomId))
  return row?.count ?? 0
}

/** List of completed rooms for /replays. */
export async function listCompletedRooms(limit = 100): Promise<RoomRow[]> {
  return db
    .select()
    .from(rooms)
    .where(eq(rooms.status, 'completed'))
    .orderBy(desc(rooms.endedAt))
    .limit(limit)
}

/** Rooms whose durable runtime may be stuck — pg_cron / Vercel Cron sweeper
 * uses this to re-fire ticks for rooms that haven't been updated recently.
 * Returns at most `limit` rooms in either 'running' or 'waiting' state whose
 * updated_at is older than `olderThanSeconds`.
 *
 * Filters to runtime='http_chain' only. WDK rooms have their own retry
 * semantics inside the workflow runtime; the cron must NOT tick-fire them
 * (would re-enter advanceRoom which has no WDK handler and dual-drive
 * for matching modes). Per durability contract Phase 4.5d-2.1.
 */
export async function getStuckRooms(
  olderThanSeconds = 30,
  limit = 20,
): Promise<{ id: string; status: string; updatedAt: Date }[]> {
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000)
  const rows = await db
    .select({ id: rooms.id, status: rooms.status, updatedAt: rooms.updatedAt })
    .from(rooms)
    .where(
      and(
        sql`${rooms.status} IN ('running', 'waiting')`,
        sql`${rooms.updatedAt} < ${cutoff}`,
        eq(rooms.runtime, 'http_chain'),
      ),
    )
    .limit(limit)
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    updatedAt: r.updatedAt,
  }))
}

/** Flag any rooms that were running but now orphaned (e.g. crashed on deploy).
 *
 * Filters to runtime='http_chain' only. WDK rooms can legitimately run
 * longer than 15 minutes (8 agents × 5 rounds × ~25s ≈ 17 min); they have
 * their own failure semantics inside the workflow runtime. Marking a
 * healthy WDK room as 'error' would corrupt active games.
 */
export async function markOrphanedAsError(maxAgeMinutes = 15): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000)
  const rowsAffected = await db
    .update(rooms)
    .set({
      status: 'error',
      errorMessage: 'Runtime orphaned (likely deploy or crash)',
      endedAt: new Date(),
    })
    .where(
      and(
        eq(rooms.status, 'running'),
        sql`${rooms.startedAt} < ${cutoff}`,
        eq(rooms.runtime, 'http_chain'),
      ),
    )
  return Array.isArray(rowsAffected) ? rowsAffected.length : 0
}
