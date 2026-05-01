// ============================================================
// Phase 4.5d-2.8 -- in-memory adapter for room-store
// ============================================================
//
// Test-only mirror of the room-store surface, gated by
// WORKFLOW_TEST=1 (same flag as llm-factory.ts). Lets the
// cross-runtime equivalence integration test drive BOTH the
// legacy http_chain runtime (Room/EventBus/Flow via
// `wireEventPersistence` -> `appendEvent`) and the WDK
// runtime (`roundtableWorkflow` steps -> `appendEvent`)
// in-process without a Postgres dependency.
//
// The seam mirrors the production semantics that matter for
// equivalence: monotonic `seq`, ON CONFLICT DO NOTHING under
// the three production unique constraints (PK + the two
// content-key partial UNIQUE indexes from migration 0010),
// and SUM/COUNT-from-events refresh for the aggregate
// helpers. Anything outside roundtable's surface (waiting
// state, role assignments, game state for werewolf) is
// stored verbatim but not exercised by the current test;
// werewolf will extend the surface as needed.
//
// Persistent state is intentional here: the in-memory adapter
// IS the durable state in test mode. Module-level handles
// (`eventsByRoom`, `roomsById`) bind to globalThis-backed Maps
// (see "State" section below) so the bundled-steps runtime and
// the test process share storage. Rule 8 of the durability
// contract (no module-level state) targets production workflow
// code, where module mutations are invisible to a workflow
// restart. In tests this Map IS the database -- by design.

import type { Message, PlatformEvent } from '@agora/shared'
import type {
  AgentInfo,
  CreateRoomArgs,
  MarkSeatReadyResult,
  RoomStatus,
  WaitingDescriptor,
} from './room-store.js'

// ── Shapes ────────────────────────────────────────────────

/**
 * In-memory room row. Field set tracks the production
 * `RoomRow` so callers reading via getMemoryRoom() see
 * the same column projection they'd get from Drizzle.
 */
export interface MemRoomRow {
  id: string
  modeId: string
  topic: string | null
  config: unknown
  status: RoomStatus
  currentPhase: string | null
  currentRound: number
  thinkingAgentId: string | null
  agents: unknown
  roleAssignments: unknown
  advancedRules: unknown
  gameState: unknown
  modeConfig: unknown
  totalCost: number
  totalTokens: number
  callCount: number
  messageCount: number
  errorMessage: string | null
  waitingFor: unknown
  waitingUntil: Date | null
  runtime: 'http_chain' | 'wdk'
  teamId: string | null
  createdBy: string | null
  startedAt: Date | null
  endedAt: Date | null
  updatedAt: Date
  createdAt: Date
}

export interface MemEventRow {
  roomId: string
  seq: number
  type: string
  payload: PlatformEvent
  occurredAt: Date
}

// ── State ─────────────────────────────────────────────────
//
// Stored on `globalThis` -- NOT module-level. Reason: the WDK
// vitest plugin (@workflow/vitest, 4.0.5) bundles step bodies via
// esbuild; files local to the apps/web tree (this one included)
// get INLINED into the bundle rather than externalized. That means
// the test process and the bundled-steps runtime each load their
// OWN copy of this module, with independent Map instances.
// Routing both copies through globalThis gives them a single shared
// store -- so a step body's `memAppendEvent(roomId, ...)` is
// observable when the test reads back via `getMemoryEvents(roomId)`.
//
// `??=` is critical here: subsequent imports bind to the existing
// Maps instead of resetting state. Tests use `resetMemoryStore()`
// for explicit isolation.

// Snake_case slot names match the existing `__agora_runtime__`
// convention in apps/web/app/lib/runtime-registry.ts. Consistency
// aids grep + signals "this is a global, not module-private."

declare global {
  // eslint-disable-next-line no-var
  var __agora_mem_events__: Map<string, MemEventRow[]> | undefined
  // eslint-disable-next-line no-var
  var __agora_mem_rooms__: Map<string, MemRoomRow> | undefined
}

const eventsByRoom: Map<string, MemEventRow[]> = (globalThis.__agora_mem_events__ ??=
  new Map())
const roomsById: Map<string, MemRoomRow> = (globalThis.__agora_mem_rooms__ ??=
  new Map())

/**
 * Reset between tests. MUST be called in beforeEach (or the
 * suite's setup hook) to avoid cross-test bleed.
 */
export function resetMemoryStore(): void {
  eventsByRoom.clear()
  roomsById.clear()
}

/**
 * Snapshot the events log for assertions. Returns a frozen
 * shallow copy so callers can't mutate the store via the
 * returned array.
 */
export function getMemoryEvents(roomId: string): readonly MemEventRow[] {
  const list = eventsByRoom.get(roomId) ?? []
  return list.slice()
}

/** Snapshot of the room row, undefined if never created. */
export function getMemoryRoom(roomId: string): MemRoomRow | undefined {
  const r = roomsById.get(roomId)
  return r ? { ...r } : undefined
}

/**
 * Seam-side single-row read. Mirrors `room-store.getRoom` -- production
 * issues a `SELECT ... LIMIT 1` against the rooms table; this returns
 * the same shape from the in-memory store. Returns a copy so callers
 * cannot mutate the store via the returned object (matches Drizzle's
 * fresh-deserialization semantics for rows).
 */
export function memGetRoom(roomId: string): MemRoomRow | undefined {
  return getMemoryRoom(roomId)
}

// ── Writes ────────────────────────────────────────────────

export async function memCreateRoom(args: CreateRoomArgs): Promise<void> {
  const now = new Date()
  roomsById.set(args.id, {
    id: args.id,
    modeId: args.modeId,
    topic: args.topic ?? null,
    config: args.config,
    status: args.initialStatus ?? 'running',
    currentPhase: null,
    currentRound: args.currentRound ?? 1,
    thinkingAgentId: null,
    agents: args.agents,
    roleAssignments: args.roleAssignments ?? null,
    advancedRules: args.advancedRules ?? null,
    gameState: null,
    modeConfig: args.modeConfig ?? null,
    totalCost: 0,
    totalTokens: 0,
    callCount: 0,
    messageCount: 0,
    errorMessage: null,
    waitingFor: null,
    waitingUntil: null,
    runtime: args.runtime ?? 'http_chain',
    teamId: args.teamId ?? null,
    createdBy: args.createdBy ?? null,
    startedAt: now,
    endedAt: null,
    updatedAt: now,
    createdAt: now,
  })
  if (!eventsByRoom.has(args.id)) {
    eventsByRoom.set(args.id, [])
  }
}

/**
 * In-memory mirror of the production `appendEvent` ON CONFLICT
 * semantics. Three independent unique constraints, all silently
 * no-op under collision:
 *
 *   1. PK (roomId, seq)                                       -- always
 *   2. events_message_id_uq partial UNIQUE on (roomId,
 *      payload->'message'->>'id') WHERE type='message:created' -- migration 0010
 *   3. events_token_message_id_uq partial UNIQUE on (roomId,
 *      payload->>'messageId') WHERE type='token:recorded'      -- migration 0010
 *
 * If the in-memory check disagreed with the production index
 * predicates, retries that work in prod could fail in tests
 * (or vice versa) -- a silent test-prod divergence we do NOT
 * want. Treat this as a pin of the migration shape.
 */
export async function memAppendEvent(
  roomId: string,
  seq: number,
  event: PlatformEvent,
): Promise<void> {
  const list = eventsByRoom.get(roomId) ?? []

  // Constraint 1: PK (roomId, seq)
  if (list.some((r) => r.seq === seq)) return

  // Constraint 2: events_message_id_uq
  // Empty/missing id: skip dedupe (matches prod -- a partial UNIQUE
  // on a NULL or empty extracted value still creates an index entry,
  // and the production WHERE predicate doesn't exclude empty strings,
  // so prod allows multiple inserts in that edge case too).
  if (event.type === 'message:created') {
    const messageId = (event as { message?: { id?: unknown } }).message?.id
    if (typeof messageId === 'string' && messageId.length > 0) {
      const collision = list.some(
        (r) =>
          r.type === 'message:created' &&
          (r.payload as { message?: { id?: unknown } }).message?.id === messageId,
      )
      if (collision) return
    }
  }

  // Constraint 3: events_token_message_id_uq
  // Same empty/missing-id rationale as constraint 2 above.
  if (event.type === 'token:recorded') {
    const messageId = (event as { messageId?: unknown }).messageId
    if (typeof messageId === 'string' && messageId.length > 0) {
      const collision = list.some(
        (r) =>
          r.type === 'token:recorded' &&
          (r.payload as { messageId?: unknown }).messageId === messageId,
      )
      if (collision) return
    }
  }

  list.push({ roomId, seq, type: event.type, payload: event, occurredAt: new Date() })
  // Defensive sort: production seq is monotonic-by-construction
  // (legacy serializes via runtime.pending; WDK awaits sequential
  // step calls). The sort here is O(n) on already-sorted input in
  // both expected paths -- kept as a guard against any future caller
  // that issues seqs out of order. Test sizes (max ~80 events) make
  // the cost trivial.
  list.sort((a, b) => a.seq - b.seq)
  eventsByRoom.set(roomId, list)
}

export async function memUpdateRoomStatus(
  roomId: string,
  status: RoomStatus,
  errorMessage?: string,
): Promise<void> {
  const room = roomsById.get(roomId)
  if (!room) return
  const now = new Date()
  room.status = status
  if (status === 'completed' || status === 'error') room.endedAt = now
  if (errorMessage !== undefined) room.errorMessage = errorMessage
  if (status !== 'waiting') {
    room.waitingFor = null
    room.waitingUntil = null
  }
  room.updatedAt = now
}

export async function memSetThinkingAgent(
  roomId: string,
  agentId: string | null,
): Promise<void> {
  const room = roomsById.get(roomId)
  if (!room) return
  room.thinkingAgentId = agentId
  room.updatedAt = new Date()
}

export async function memSetCurrentRound(roomId: string, round: number): Promise<void> {
  const room = roomsById.get(roomId)
  if (!room) return
  room.currentRound = round
  room.updatedAt = new Date()
}

export async function memSetCurrentPhase(
  roomId: string,
  phase: string | null,
): Promise<void> {
  const room = roomsById.get(roomId)
  if (!room) return
  room.currentPhase = phase
  room.updatedAt = new Date()
}

export async function memSetGameState(
  roomId: string,
  gameState: Record<string, unknown>,
): Promise<void> {
  const room = roomsById.get(roomId)
  if (!room) return
  room.gameState = gameState
  room.updatedAt = new Date()
}

// ── P2 lobby gate helpers ────────────────────────────────

/**
 * Mirror of `markSeatReady` (room-store.ts). Atomic in production via
 * `jsonb_set` UPDATE; here it's a synchronous in-process Map mutation
 * because the test runtime is single-threaded. The status='lobby'
 * predicate is mirrored too — returns null when the room moved on.
 */
export async function memMarkSeatReady(
  roomId: string,
  agentId: string,
): Promise<MarkSeatReadyResult | null> {
  const room = roomsById.get(roomId)
  if (!room) return null
  if (room.status !== 'lobby') return null
  const gs = (room.gameState as Record<string, unknown> | null) ?? {}
  const seatReady =
    typeof gs['seatReady'] === 'object' && gs['seatReady'] !== null
      ? { ...(gs['seatReady'] as Record<string, boolean>) }
      : {}
  seatReady[agentId] = true
  const newGs = { ...gs, seatReady }
  room.gameState = newGs
  room.updatedAt = new Date()
  return {
    gameState: newGs,
    agents: (room.agents as unknown as AgentInfo[]) ?? [],
  }
}

/**
 * Mirror of `flipLobbyToRunning` (room-store.ts). CAS via Map check —
 * only the first call to find status='lobby' wins.
 */
export async function memFlipLobbyToRunning(roomId: string): Promise<boolean> {
  const room = roomsById.get(roomId)
  if (!room) return false
  if (room.status !== 'lobby') return false
  room.status = 'running'
  room.updatedAt = new Date()
  return true
}

export async function memSetWaiting(
  roomId: string,
  waitingFor: WaitingDescriptor,
  waitingUntil: Date | null,
): Promise<void> {
  const room = roomsById.get(roomId)
  if (!room) return
  room.status = 'waiting'
  room.waitingFor = waitingFor
  room.waitingUntil = waitingUntil
  room.updatedAt = new Date()
}

/**
 * Mirror of `refreshMessageCount` -- recompute from events log.
 * Idempotent by construction (same inputs -> same output).
 */
export async function memRefreshMessageCount(roomId: string): Promise<void> {
  const room = roomsById.get(roomId)
  if (!room) return
  const list = eventsByRoom.get(roomId) ?? []
  room.messageCount = list.filter((r) => r.type === 'message:created').length
  room.updatedAt = new Date()
}

/**
 * Mirror of `refreshRoomTokenAggregates` -- SUM/COUNT from
 * token:recorded events. Idempotent by construction.
 */
export async function memRefreshRoomTokenAggregates(roomId: string): Promise<void> {
  const room = roomsById.get(roomId)
  if (!room) return
  const list = eventsByRoom.get(roomId) ?? []
  let totalCost = 0
  let totalTokens = 0
  let callCount = 0
  for (const r of list) {
    if (r.type !== 'token:recorded') continue
    const payload = r.payload as { cost?: number; usage?: { totalTokens?: number } }
    totalCost += payload.cost ?? 0
    totalTokens += payload.usage?.totalTokens ?? 0
    callCount += 1
  }
  room.totalCost = totalCost
  room.totalTokens = totalTokens
  room.callCount = callCount
  room.updatedAt = new Date()
}

// ── Reads ─────────────────────────────────────────────────

export async function memGetEventCount(roomId: string): Promise<number> {
  return (eventsByRoom.get(roomId) ?? []).length
}

export async function memGetEventsSince(
  roomId: string,
  afterSeq: number,
): Promise<{ index: number; timestamp: number; event: PlatformEvent }[]> {
  const list = eventsByRoom.get(roomId) ?? []
  return list
    .filter((r) => r.seq > afterSeq)
    .map((r) => {
      const payload = r.payload as PlatformEvent & { message?: { timestamp?: number } }
      const timestamp = payload.message?.timestamp ?? r.occurredAt.getTime()
      return { index: r.seq, timestamp, event: payload }
    })
}

export async function memGetMessagesSince(
  roomId: string,
  afterTs: number,
): Promise<Message[]> {
  const list = eventsByRoom.get(roomId) ?? []
  return list
    .filter((r) => r.type === 'message:created')
    .filter((r) => {
      if (afterTs <= 0) return true
      const ts = (r.payload as { message?: { timestamp?: number } }).message?.timestamp
      return typeof ts === 'number' && ts > afterTs
    })
    .map((r) => (r.payload as { message: Message }).message)
}
