// ============================================================
// GET /api/rooms/:id/messages — Poll for room messages
// ============================================================

import { NextResponse } from 'next/server'
import { getRoomState } from '../../../../lib/room-store'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const room = getRoomState(id)

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const afterParam = url.searchParams.get('after')
  const after = afterParam ? parseInt(afterParam, 10) : 0

  // Filter messages after the given timestamp
  const messages = after > 0
    ? room.messages.filter((m) => m.timestamp > after)
    : room.messages

  return NextResponse.json({
    messages,
    status: room.status,
    currentRound: room.currentRound,
    totalRounds: room.rounds,
    thinkingAgentId: room.thinkingAgentId,
    agents: room.agents,
    topic: room.topic,
    error: room.error,
  })
}
