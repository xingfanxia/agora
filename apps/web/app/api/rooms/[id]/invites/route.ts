// ============================================================
// POST /api/rooms/[id]/invites — mint seat invite URLs
// ============================================================
//
// Owner-only. Returns one invite URL per requested human seat
// (defaults: all seats marked `isHuman` in the room snapshot).
// Caller pastes the URLs to invited humans; anyone with the URL
// can claim that seat (no account required).
//
// Tokens are short-lived JWTs (see `lib/seat-tokens.ts`). If the
// host wants to kick someone, rotate AGORA_SEAT_SECRET to
// invalidate everything. Per-token revocation is not MVP-scoped.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAuthUserId } from '../../../../lib/auth'
import { getRoom } from '../../../../lib/room-store'
import { buildInviteUrl, signSeatToken } from '../../../../lib/seat-tokens'

export const dynamic = 'force-dynamic'

interface RouteCtx {
  params: Promise<{ id: string }>
}

interface InviteBody {
  agentIds?: unknown
}

export async function POST(request: NextRequest, ctx: RouteCtx) {
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

  // Empty body is fine — default to all human seats. Only a malformed
  // JSON body reaches the .catch — silent fallback.
  const body = (await request.json().catch(() => ({}))) as InviteBody

  const agents = (room.agents as unknown as Array<{ id: string; name: string; isHuman?: boolean }>) ?? []
  const humanSeats = agents.filter((a) => a.isHuman)

  let targets = humanSeats
  if (Array.isArray(body.agentIds) && body.agentIds.every((x) => typeof x === 'string')) {
    const requested = new Set(body.agentIds as string[])
    targets = humanSeats.filter((a) => requested.has(a.id))
    if (targets.length !== requested.size) {
      return NextResponse.json(
        { error: 'one or more agentIds are not human seats in this room' },
        { status: 400 },
      )
    }
  }

  if (targets.length === 0) {
    return NextResponse.json({ invites: [] })
  }

  const origin = new URL(request.url).origin
  const invites = await Promise.all(
    targets.map(async (seat) => {
      const token = await signSeatToken({ roomId, agentId: seat.id })
      return {
        agentId: seat.id,
        agentName: seat.name,
        url: buildInviteUrl(origin, roomId, token),
      }
    }),
  )

  return NextResponse.json({ invites })
}
