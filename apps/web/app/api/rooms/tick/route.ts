// ============================================================
// POST /api/rooms/tick?id=ROOM_ID
// ============================================================
//
// Phase 4.5a durable dispatcher. Each call:
//   1. Invokes advanceRoom(roomId) — runs ONE phase, persists events,
//      returns { continue | complete | error }.
//   2. If continue: inline self-invokes /api/rooms/tick for the same
//      room via waitUntil(fetch(...)). The response is returned
//      immediately; the chain runs asynchronously.
//
// Each tick is a fresh Vercel function invocation, so the 5-minute
// function timeout resets per tick. Games of any length finish.

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { advanceRoom } from '../../../lib/room-runtime'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // seconds — Vercel Pro max; we expect <60s/tick

export async function POST(request: Request) {
  const url = new URL(request.url)
  const roomId = url.searchParams.get('id')
  if (!roomId) {
    return NextResponse.json({ error: 'Missing ?id=' }, { status: 400 })
  }

  const result = await advanceRoom(roomId)

  // Chain the next tick in the background. Fire-and-forget: this function
  // returns a 200 immediately; waitUntil keeps the invocation alive just
  // long enough for the outbound fetch to be accepted by the next
  // Vercel invocation. If the fetch fails, pg_cron / Vercel Cron (Round 5)
  // will pick up the stuck room.
  if (result.kind === 'continue') {
    const nextUrl = new URL(request.url)
    nextUrl.searchParams.set('id', roomId)
    waitUntil(
      fetch(nextUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Avoid edge-caching — each tick is a new request.
        cache: 'no-store',
      }).catch((err) =>
        console.error(`[tick-chain] ${roomId} next-tick fetch failed:`, err),
      ),
    )
  }

  return NextResponse.json({ roomId, ...result })
}

// Also accept GET for local dev convenience (curl / browser).
export async function GET(request: Request) {
  return POST(request)
}
