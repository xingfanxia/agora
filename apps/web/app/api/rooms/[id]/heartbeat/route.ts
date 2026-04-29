// ============================================================
// POST /api/rooms/[id]/heartbeat
// ============================================================
//
// Phase 4.5d-1 — Update seat liveness signal. Called by the
// useRoomLive hook every ~5s (debounced) for human seats. The
// (room_id, agent_id) row in seat_presence is upserted with
// last_seen_at = now(). Read by WDK step bodies in 4.5d-2 for
// vote-fallback-vs-wait decisions (durability contract: presence
// reads come from Postgres, never Realtime).
//
// AuthZ — same shape as /human-input:
//   - Bearer seat-token → must match (roomId, agentId)
//   - OR logged-in room owner (testing locally with multiple tabs)

import { NextResponse } from 'next/server'
import { upsertPresence } from '../../../../lib/presence'
import { getRoom } from '../../../../lib/room-store'
import { getAuthUser } from '../../../../lib/supabase-server'
import { verifySeatToken } from '../../../../lib/seat-tokens'

export const dynamic = 'force-dynamic'

interface HeartbeatBody {
  agentId: string
}

// Standard UUID regex (any version). Apps/web doesn't depend on zod
// directly, so a regex check matches the existing route style without
// pulling in a new dep just for one validator.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function authorize(
  request: Request,
  roomId: string,
  agentId: string,
  ownerUserId: string | null,
): Promise<boolean> {
  const authHeader = request.headers.get('authorization') ?? ''
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim()
    const payload = await verifySeatToken(token, roomId)
    return payload?.agentId === agentId
  }
  const user = await getAuthUser()
  if (user && ownerUserId && user.id === ownerUserId) return true
  return false
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: roomId } = await params

  let body: HeartbeatBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Boundary validation — UUID syntax check before the value reaches
  // Drizzle (where seat_presence.agent_id is uuid NOT NULL; non-UUID
  // input would 500 with `invalid input syntax for type uuid`).
  const { agentId } = body
  if (typeof agentId !== 'string' || !UUID_RE.test(agentId)) {
    return NextResponse.json({ error: 'agentId must be a valid UUID' }, { status: 400 })
  }

  const roomRow = await getRoom(roomId)
  if (!roomRow) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  // The agentId must correspond to a real seat in this room's snapshot.
  // Without this check, a room owner could write presence rows for
  // arbitrary UUIDs that don't belong to actual seats — those rows
  // would later influence WDK fan-in fallback decisions in 4.5d-2
  // for seats the owner doesn't legitimately occupy.
  const agents = (roomRow.agents as unknown as Array<{ id: string }>) ?? []
  if (!agents.some((a) => a.id === agentId)) {
    return NextResponse.json({ error: 'Unknown seat for this room' }, { status: 404 })
  }

  const authorized = await authorize(request, roomId, agentId, roomRow.createdBy)
  if (!authorized) {
    // Structured log so legitimate seat-token expiry is distinguishable
    // from probing in production.
    console.warn('[heartbeat] auth failed', {
      roomId,
      agentId,
      hasBearer: (request.headers.get('authorization') ?? '').startsWith('Bearer '),
    })
    return NextResponse.json(
      { error: 'Missing or invalid seat token' },
      { status: 401 },
    )
  }

  await upsertPresence(roomId, agentId)

  return NextResponse.json({ ok: true })
}
