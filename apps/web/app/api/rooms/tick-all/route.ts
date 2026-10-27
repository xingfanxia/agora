// ============================================================
// GET|POST /api/rooms/tick-all
// ============================================================
//
// Safety-net sweeper invoked by Vercel Cron (apps/web/vercel.json) at
// a 1-minute cadence. For each room whose updated_at is stale (inline
// tick chain broke, function crashed, etc.), fires /api/rooms/tick.
//
// Auth: gated on CRON_SECRET env var — Vercel Cron passes it as
// `Authorization: Bearer <secret>`. If the secret is unset, the endpoint
// refuses to run (fail-closed). Vercel Cron invokes the path with GET;
// POST stays for manual calls.

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { secretMatches } from '../../../lib/secret-match'
import { getStuckRooms } from '../../../lib/room-store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function sweep(request: Request) {
  const secret = process.env['CRON_SECRET']
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 503 },
    )
  }
  const authHeader = request.headers.get('authorization') ?? ''
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!secretMatches(provided, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Older than 30s — comfortably past the expected inter-tick latency
  // (~100ms HTTP + <60s phase work). Anything older is likely orphaned.
  const stuck = await getStuckRooms(30, 20)

  let fired = 0
  for (const room of stuck) {
    const tickUrl = new URL('/api/rooms/tick', request.url)
    tickUrl.searchParams.set('id', room.id)
    waitUntil(
      fetch(tickUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      }).catch((err) =>
        console.error(`[tick-all] ${room.id} re-fire failed:`, err),
      ),
    )
    fired++
  }

  return NextResponse.json({
    swept: stuck.length,
    fired,
    rooms: stuck.map((r) => ({
      id: r.id,
      status: r.status,
      stuckSeconds: Math.round((Date.now() - r.updatedAt.getTime()) / 1000),
    })),
  })
}

export const GET = sweep
export const POST = sweep
