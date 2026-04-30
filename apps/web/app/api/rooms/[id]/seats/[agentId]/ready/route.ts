// ============================================================
// POST /api/rooms/[id]/seats/[agentId]/ready
// ============================================================
//
// P2 lobby gate. Marks a human seat ready; if all humans are now
// ready, atomically flips status='lobby' → 'running' and starts
// the workflow.
//
// AuthZ — same as /human-input:
//   - Bearer seat-token for (roomId, agentId), OR
//   - Logged-in room owner.
//
// Body: empty or { ready: true }. We only support flipping TO ready
// in V1; un-ready isn't a documented user flow (room is short-lived,
// users can refresh to bail). Idempotent — second call returns the
// same already-ready state.

import { NextResponse, type NextRequest } from 'next/server'
import {
  getRoom,
  markSeatReady,
  type AgentInfo,
} from '../../../../../../lib/room-store'
import { getAuthUser } from '../../../../../../lib/supabase-server'
import { verifySeatToken } from '../../../../../../lib/seat-tokens'
import { resolveLobby, readSeatReady } from '../../../../../../lib/lobby'

export const dynamic = 'force-dynamic'

interface RouteCtx {
  params: Promise<{ id: string; agentId: string }>
}

async function authorizeSeatClaim(
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

export async function POST(request: NextRequest, ctx: RouteCtx) {
  const { id: roomId, agentId } = await ctx.params

  const room = await getRoom(roomId)
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const ok = await authorizeSeatClaim(request, roomId, agentId, room.createdBy)
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agents = (room.agents as unknown as AgentInfo[]) ?? []
  const seat = agents.find((a) => a.id === agentId)
  if (!seat) {
    return NextResponse.json({ error: 'Agent not in this room' }, { status: 404 })
  }
  if (seat.isHuman !== true) {
    return NextResponse.json(
      { error: 'Seat is not human-controlled' },
      { status: 400 },
    )
  }

  // markSeatReady returns null when room is no longer in 'lobby'
  // (someone force-started, or the gate already resolved). Treat that
  // as a 200 idempotent no-op — the human's state is "already ready"
  // because the workflow is past lobby. Surface the room status so the
  // client can stop polling for the lobby UI.
  const result = await markSeatReady(roomId, agentId)
  if (result === null) {
    return NextResponse.json({
      ok: true,
      status: room.status,
      note: 'Room is past lobby; ready flip ignored',
    })
  }

  // Try to resolve. If not all human seats are ready yet, this is a
  // no-op flip-wise (returns reason='not-ready'). If all are ready,
  // it flips status + starts the workflow.
  const resolved = await resolveLobby(roomId)

  return NextResponse.json({
    ok: true,
    status: resolved.flipped ? 'running' : 'lobby',
    seatReady: readSeatReady(result.gameState),
    started: resolved.flipped ? resolved.started === true : false,
  })
}
