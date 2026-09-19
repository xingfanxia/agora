// ============================================================
// POST /api/rooms/[id]/start
// ============================================================
//
// P2 owner force-start. Bypasses the all-ready gate — flips
// status='lobby' → 'running' and starts the workflow regardless of
// per-seat ready state. Useful when humans drop out and the owner
// wants to play out the rest of the seats as AI / spectate.
//
// AuthZ: room owner only. Seat-token holders cannot force-start.

import { NextResponse, type NextRequest } from 'next/server'
import { getRoom } from '../../../../lib/room-store'
import { requireAuthUserId } from '../../../../lib/auth'
import { resolveLobby } from '../../../../lib/lobby'

export const dynamic = 'force-dynamic'

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function POST(_request: NextRequest, ctx: RouteCtx) {
  const { id: roomId } = await ctx.params

  const auth = await requireAuthUserId()
  if (!auth.ok) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const room = await getRoom(roomId)
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (room.createdBy !== auth.id) {
    return NextResponse.json({ error: 'Not the owner' }, { status: 403 })
  }

  if (room.status !== 'lobby') {
    return NextResponse.json(
      { error: `Room is in '${room.status}', not 'lobby'` },
      { status: 409 },
    )
  }

  const resolved = await resolveLobby(roomId, { force: true })
  if (resolved.reason === 'not-lobby') {
    // Race: someone else flipped between our getRoom check and the
    // resolveLobby flip. Treat as success — workflow has been started.
    return NextResponse.json({ ok: true, status: 'running' })
  }
  if (resolved.flipped && resolved.started === false) {
    return NextResponse.json(
      { error: 'Workflow start failed; room marked error' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, status: 'running' })
}
