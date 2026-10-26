// ============================================================
// GET /api/rooms/:id/events — Timeline event stream
// ============================================================
//
// The raw timeline carries every channel (wolf chat, night actions,
// decisions). For an in-progress werewolf game only the room owner
// (spectator) gets it; everyone else gets an empty page until the
// game completes. Players read their filtered view via /messages.

import { NextResponse } from 'next/server'
import { getEventCount, getEventsSince, getRoom } from '../../../../lib/room-store'
import { getAuthUser } from '../../../../lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const room = await getRoom(id)
  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const afterParam = url.searchParams.get('after')
  const after = afterParam ? parseInt(afterParam, 10) : -1

  if (room.modeId === 'werewolf' && room.status !== 'completed') {
    const user = await getAuthUser().catch(() => null)
    const isOwner = user?.id != null && user.id === room.createdBy
    if (!isOwner) {
      return NextResponse.json({ events: [], total: 0, status: room.status })
    }
  }

  const events = await getEventsSince(id, after)
  const total = await getEventCount(id)

  return NextResponse.json({
    events,
    total,
    status: room.status,
  })
}
