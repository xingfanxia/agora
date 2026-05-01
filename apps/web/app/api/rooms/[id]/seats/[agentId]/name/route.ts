// ============================================================
// POST /api/rooms/[id]/seats/[agentId]/name
// ============================================================
//
// P2 — rename a human seat in the lobby. Mirrors the auth model
// of /seats/[agentId]/ready: Bearer seat-token for (roomId, agentId)
// OR a logged-in room owner. Owner-as-player can rename any seat
// they own (e.g. testing locally with a second tab); otherwise the
// seat token gates per-seat.
//
// Body: { name: string } where the name is trimmed, ≤30 chars,
// non-empty, and unique within the room (other seats can't share).
//
// Server-side prompt regen: for werewolf, every agent's systemPrompt
// embeds the player roster + wolf list, so a rename rebuilds ALL
// agents' prompts. For roundtable / open-chat the rename only
// updates the agents JSONB column (peer prompts don't reference
// rosters; the renamed seat's own prompt is dead weight at runtime).
// See updateSeatName in room-store.ts for the full rationale.
//
// Status guard: only `lobby`. Once the workflow starts, names are
// locked — they're embedded in chat history and downstream tally
// announcements that already shipped under the old name.

import { NextResponse, type NextRequest } from 'next/server'
import { getRoom, updateSeatName } from '../../../../../../lib/room-store'
import { getAuthUser } from '../../../../../../lib/supabase-server'
import { verifySeatToken } from '../../../../../../lib/seat-tokens'

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

  let body: { name?: unknown }
  try {
    body = (await request.json()) as { name?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name : ''
  if (name.trim().length === 0) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 })
  }
  if (name.trim().length > 30) {
    return NextResponse.json({ error: 'Name too long (max 30 chars)' }, { status: 400 })
  }

  const room = await getRoom(roomId)
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const ok = await authorizeSeatClaim(request, roomId, agentId, room.createdBy)
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await updateSeatName(roomId, agentId, name)
  if (!result.ok) {
    // Map structured reason → HTTP. 4xx for caller-side issues, 409
    // for "room moved on" (race with lobby resolve).
    const status =
      result.reason === 'not-found'
        ? 404
        : result.reason === 'not-human' || result.reason === 'invalid-name' || result.reason === 'duplicate-name'
          ? 400
          : 409 // not-lobby
    const messages: Record<typeof result.reason, string> = {
      'not-found': 'Seat not in this room',
      'not-lobby': 'Room is past lobby; names are locked',
      'not-human': 'Only human seats can be renamed',
      'invalid-name': 'Name must be 1-30 characters after trimming',
      'duplicate-name': 'Another seat already uses that name',
    }
    return NextResponse.json({ error: messages[result.reason] }, { status })
  }

  return NextResponse.json({ ok: true, name: name.trim() })
}
