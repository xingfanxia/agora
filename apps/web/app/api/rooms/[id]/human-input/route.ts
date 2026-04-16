// ============================================================
// POST /api/rooms/[id]/human-input
// ============================================================
//
// Phase 4.5c — Accept human player input and resume the tick chain.
//
// Flow:
//   1. Validate room is in 'waiting' state and agentId matches waitingForHuman
//   2. Insert the human's message as a regular message:created event
//   3. Set room status back to 'running'
//   4. Fire the next tick via waitUntil(fetch(/api/rooms/tick))
//
// The human's message is indistinguishable from an AI message in the
// event stream — same schema, same replay semantics.

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getRoom, updateRoomStatus, appendEvent, getEventCount } from '../../../../lib/room-store'

export const dynamic = 'force-dynamic'

interface HumanInputBody {
  /** The agent seat ID the human is playing as */
  agentId: string
  /** The turn type (for structured payloads) */
  turnId: string
  /** The actual input content */
  payload: {
    content?: string
    target?: string
    reason?: string
    action?: string
    poisonTarget?: string
    shoot?: boolean
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: roomId } = await params

  let body: HumanInputBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { agentId, turnId, payload } = body
  if (!agentId || !turnId || !payload) {
    return NextResponse.json(
      { error: 'Missing required fields: agentId, turnId, payload' },
      { status: 400 },
    )
  }

  // Validate room state
  const roomRow = await getRoom(roomId)
  if (!roomRow) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }
  if (roomRow.status !== 'waiting') {
    return NextResponse.json(
      { error: `Room is not waiting for input (status: ${roomRow.status})` },
      { status: 409 },
    )
  }

  const gameState = roomRow.gameState as { waitingForHuman?: string } | null
  if (gameState?.waitingForHuman !== agentId) {
    return NextResponse.json(
      { error: `Room is not waiting for agent ${agentId}` },
      { status: 403 },
    )
  }

  // Find the agent info from the room snapshot
  const agents = (roomRow.agents as unknown as Array<{ id: string; name: string }>) ?? []
  const agentInfo = agents.find((a) => a.id === agentId)
  const senderName = agentInfo?.name ?? 'Human'

  // Determine channel and content from turnId + payload
  const { channelId, content } = resolveHumanMessage(turnId, payload)

  // Insert the human's message as a regular message:created event
  const eventCount = await getEventCount(roomId)
  const message = {
    id: crypto.randomUUID(),
    roomId,
    senderId: agentId,
    senderName,
    content,
    channelId,
    timestamp: Date.now(),
    metadata: { isHumanInput: true, turnId },
  }

  await appendEvent(roomId, eventCount, {
    type: 'message:created',
    message,
  })

  // Resume: set status back to running and fire the next tick
  await updateRoomStatus(roomId, 'running')

  const tickUrl = new URL('/api/rooms/tick', request.url)
  tickUrl.searchParams.set('id', roomId)
  waitUntil(
    fetch(tickUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    }).catch((err) =>
      console.error(`[human-input] ${roomId} tick resume failed:`, err),
    ),
  )

  return NextResponse.json({ ok: true, messageId: message.id })
}

// ── Helpers ────────────────────────────────────────────────

function resolveHumanMessage(
  turnId: string,
  payload: HumanInputBody['payload'],
): { channelId: string; content: string } {
  switch (turnId) {
    case 'speak':
      return { channelId: 'main', content: payload.content ?? '' }

    case 'wolf-speak':
      return { channelId: 'werewolf', content: payload.content ?? '' }

    case 'wolf-vote':
      return {
        channelId: 'wolf-vote',
        content: JSON.stringify({ target: payload.target, reason: payload.reason }),
      }

    case 'day-vote':
      return {
        channelId: 'day-vote',
        content: JSON.stringify({ target: payload.target, reason: payload.reason }),
      }

    case 'witch-action':
      return {
        channelId: 'witch-action',
        content: JSON.stringify({
          action: payload.action,
          poisonTarget: payload.poisonTarget,
        }),
      }

    case 'seer-check':
      return {
        channelId: 'seer-result',
        content: JSON.stringify({ target: payload.target }),
      }

    case 'guard-protect':
      return {
        channelId: 'guard-action',
        content: JSON.stringify({ target: payload.target }),
      }

    case 'hunter-shoot':
      return {
        channelId: 'main',
        content: JSON.stringify({ shoot: payload.shoot, target: payload.target }),
      }

    case 'sheriff-election':
      return {
        channelId: 'day-vote',
        content: JSON.stringify({ target: payload.target }),
      }

    case 'sheriff-transfer':
      return {
        channelId: 'main',
        content: JSON.stringify({ target: payload.target }),
      }

    case 'last-words':
      return { channelId: 'main', content: payload.content ?? '' }

    default:
      return { channelId: 'main', content: payload.content ?? '' }
  }
}
