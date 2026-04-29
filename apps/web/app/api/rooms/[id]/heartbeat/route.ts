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

  const { agentId } = body
  if (!agentId) {
    return NextResponse.json({ error: 'Missing agentId' }, { status: 400 })
  }

  const roomRow = await getRoom(roomId)
  if (!roomRow) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const authorized = await authorize(request, roomId, agentId, roomRow.createdBy)
  if (!authorized) {
    return NextResponse.json(
      { error: 'Missing or invalid seat token' },
      { status: 401 },
    )
  }

  await upsertPresence(roomId, agentId)

  return NextResponse.json({ ok: true })
}
