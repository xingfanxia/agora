// ============================================================
// GET /api/rooms/:id/presence — per-seat liveness map
// ============================================================
//
// Phase 4.5d-3 — Read complement of POST /heartbeat. The client polls
// this every ~5-10s via `usePresenceMap`; the resulting map drives
// `SeatPresenceIndicator` color (green / amber / red).
//
// Access model matches `/messages`: room URL is the access boundary —
// anyone holding the room id sees who's in it and message contents,
// so the per-seat heartbeat timestamp is no more sensitive than the
// already-public message stream. We do NOT require a seat token here.
//
// Source of truth: the `seat_presence` Postgres table (NOT Realtime —
// see `lib/presence.ts` and the durability contract in 4.5d-2). Rows
// only exist for seats that have heartbeated at least once; the client
// falls back to "never seen" for missing keys.
//
// Returns:
//   200 { presence: { [agentId]: ISO8601 } } — flat map for O(1) lookup
//   404 { error }                              — room not found
//
// Note on stale rooms: there is no time filter here — even very-old
// rows are returned. A janitor cron is planned (uses the
// `seat_presence_last_seen_idx` index added in migration 0009) to GC
// rows older than N days. The client tolerates stale timestamps
// because the indicator's color thresholds are time-since-now and
// "old" presence naturally renders red.
//
// Performance: getRoomPresence runs one indexed scan on
// (room_id, agent_id) PK; a 10-seat room reads at most 10 rows, no
// joins. Polling at 5s × N rooms is well under the per-room write
// budget for the heartbeat endpoint, so read amplification is fine.

import { NextResponse } from 'next/server'
import { getRoomPresence } from '../../../../lib/presence'
import { getRoom } from '../../../../lib/room-store'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: roomId } = await params

  const room = await getRoom(roomId)
  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const rows = await getRoomPresence(roomId)
  const presence: Record<string, string> = {}
  for (const row of rows) {
    presence[row.agentId] = row.lastSeenAt.toISOString()
  }

  return NextResponse.json({ presence })
}
