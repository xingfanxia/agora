// ============================================================
// GET /api/rooms/:id/events — Timeline event stream
// ============================================================

import { NextResponse } from 'next/server'
import { getEventCount, getEventsSince, getRoom } from '../../../../lib/room-store'

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

  const events = await getEventsSince(id, after)
  const total = await getEventCount(id)

  return NextResponse.json({
    events,
    total,
    status: room.status,
  })
}
