// ============================================================
// GET /api/rooms/:id/events — Timeline event stream
// ============================================================

import { NextResponse } from 'next/server'
import { getRoomState } from '../../../../lib/room-store'

interface EventEnvelope {
  index: number
  timestamp: number
  event: unknown
}

/**
 * Returns events in insertion order with optional ?after= index for
 * incremental polling. Attaches a timestamp from the related message
 * when possible (otherwise uses Date.now at append time is not
 * preserved — index order is the source of truth).
 */
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
  const after = afterParam ? parseInt(afterParam, 10) : -1

  const events: EventEnvelope[] = []
  room.events.forEach((ev, i) => {
    if (i <= after) return
    // Derive timestamp — message events have their own, others don't,
    // so we use the message timestamp when present.
    let timestamp = 0
    const maybeEvent = ev as { message?: { timestamp?: number } }
    if (maybeEvent.message?.timestamp) {
      timestamp = maybeEvent.message.timestamp
    }
    events.push({ index: i, timestamp, event: ev })
  })

  return NextResponse.json({
    events,
    total: room.events.length,
    status: room.status,
  })
}
