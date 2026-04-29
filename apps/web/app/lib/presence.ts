// ============================================================
// Server-side presence helpers (Phase 4.5d-1)
// ============================================================
//
// Postgres-backed liveness signal for human seats. Called by:
//
//   - POST /api/rooms/[id]/heartbeat — upserts on every client tick
//   - WDK steps in 4.5d-2 — read isOnline() to decide vote fallback
//
// Realtime is for client UX only (peer awareness, typing dots);
// Postgres is the source of truth so WDK step bodies stay
// deterministic (no Realtime side effects in step.run).
//
// `isOnline` takes `now` and `graceMs` for testability — keeps the
// pure decision logic separate from the wall-clock clock.

import type { SeatPresenceRow } from '@agora/db'
import { getDb, seatPresence } from '@agora/db'
import { and, eq, sql } from 'drizzle-orm'

const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    const instance = getDb() as unknown as Record<string | symbol, unknown>
    const value = instance[prop]
    return typeof value === 'function' ? (value as Function).bind(instance) : value
  },
})

/** Default disconnect grace window — 30s from last heartbeat. */
export const PRESENCE_GRACE_MS = 30_000

/**
 * Update last_seen_at to now for (roomId, agentId). Upsert — creates
 * the row on first heartbeat. Idempotent.
 *
 * Server-side rate limit: the conditional `setWhere` makes the UPDATE
 * a no-op if a heartbeat landed within the last 1s. Saves write
 * amplification when a misbehaving client (or two tabs) tick faster
 * than the documented 5s interval.
 */
export async function upsertPresence(roomId: string, agentId: string): Promise<void> {
  const now = new Date()
  await db
    .insert(seatPresence)
    .values({ roomId, agentId, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [seatPresence.roomId, seatPresence.agentId],
      set: { lastSeenAt: now },
      setWhere: sql`${seatPresence.lastSeenAt} < now() - interval '1 second'`,
    })
}

/** Fetch a single seat's presence row, or null if never heartbeated. */
export async function getPresence(
  roomId: string,
  agentId: string,
): Promise<SeatPresenceRow | null> {
  const rows = await db
    .select()
    .from(seatPresence)
    .where(and(eq(seatPresence.roomId, roomId), eq(seatPresence.agentId, agentId)))
    .limit(1)
  return rows[0] ?? null
}

/** Fetch all presence rows for a room. */
export async function getRoomPresence(roomId: string): Promise<SeatPresenceRow[]> {
  return await db.select().from(seatPresence).where(eq(seatPresence.roomId, roomId))
}

/**
 * Pure helper — true if `presence` shows activity within `graceMs` ms
 * before `now`. `now` is injected for testability; defaults to
 * wall-clock Date.now(). null/undefined presence is always offline.
 */
export function isOnline(
  presence: SeatPresenceRow | null | undefined,
  graceMs: number = PRESENCE_GRACE_MS,
  now: number = Date.now(),
): boolean {
  if (!presence) return false
  return now - presence.lastSeenAt.getTime() < graceMs
}
