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

const db = getDb()

export type RoomStatus = 'running' | 'completed' | 'error'

export interface AgentInfo {
  id: string
  name: string
  model: string
  provider: string
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
}

export async function createRoom(args: CreateRoomArgs): Promise<void> {
  await db.insert(rooms).values({
    id: args.id,
    modeId: args.modeId,
    topic: args.topic ?? null,
    config: args.config as object,
    agents: args.agents as unknown as object,
    currentRound: args.currentRound ?? 1,
    status: 'running',
    roleAssignments: (args.roleAssignments as object) ?? null,
    advancedRules: (args.advancedRules as object) ?? null,
    startedAt: new Date(),
  })
}

// ── Event append ────────────────────────────────────────────

export async function appendEvent(
  roomId: string,
  seq: number,
  event: PlatformEvent,
): Promise<void> {
  await db.insert(events).values({
    roomId,
    seq,
    type: event.type,
    payload: event as unknown as object,
  })
}

// ── Incremental room updates ────────────────────────────────

export async function setCurrentPhase(roomId: string, phase: string | null): Promise<void> {
  await db.update(rooms).set({ currentPhase: phase }).where(eq(rooms.id, roomId))
}

export async function setCurrentRound(roomId: string, round: number): Promise<void> {
  await db.update(rooms).set({ currentRound: round }).where(eq(rooms.id, roomId))
}

export async function setThinkingAgent(
  roomId: string,
  agentId: string | null,
): Promise<void> {
  await db.update(rooms).set({ thinkingAgentId: agentId }).where(eq(rooms.id, roomId))
}

export async function setGameState(
  roomId: string,
  gameState: Record<string, unknown>,
): Promise<void> {
  await db.update(rooms).set({ gameState: gameState as object }).where(eq(rooms.id, roomId))
}

export async function updateRoomStatus(
  roomId: string,
  status: RoomStatus,
  errorMessage?: string,
): Promise<void> {
  const now = new Date()
  const patch: Partial<RoomRow> = { status }
  if (status === 'completed' || status === 'error') patch.endedAt = now
  if (errorMessage) patch.errorMessage = errorMessage
  await db.update(rooms).set(patch).where(eq(rooms.id, roomId))
}

// Running aggregate bumps (hot-read columns maintained incrementally)

export async function incrementMessageCount(roomId: string): Promise<void> {
  await db
    .update(rooms)
    .set({ messageCount: sql`${rooms.messageCount} + 1` })
    .where(eq(rooms.id, roomId))
}

export async function recordTokenUsage(
  roomId: string,
  usage: TokenUsage,
  cost: number,
): Promise<void> {
  await db
    .update(rooms)
    .set({
      callCount: sql`${rooms.callCount} + 1`,
      totalTokens: sql`${rooms.totalTokens} + ${usage.totalTokens}`,
      totalCost: sql`${rooms.totalCost} + ${cost}`,
    })
    .where(eq(rooms.id, roomId))
}

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
}

export async function getRoom(roomId: string): Promise<RoomRow | null> {
  const [row] = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1)
  return row ?? null
}

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

/** Flag any rooms that were running but now orphaned (e.g. crashed on deploy). */
export async function markOrphanedAsError(maxAgeMinutes = 15): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000)
  const rowsAffected = await db
    .update(rooms)
    .set({
      status: 'error',
      errorMessage: 'Runtime orphaned (likely deploy or crash)',
      endedAt: new Date(),
    })
    .where(and(eq(rooms.status, 'running'), sql`${rooms.startedAt} < ${cutoff}`))
  return Array.isArray(rowsAffected) ? rowsAffected.length : 0
}
