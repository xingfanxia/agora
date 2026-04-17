// ============================================================
// POST /api/rooms/open-chat — Create an open-chat room from a team
// ============================================================
//
// Open-chat rooms are always composed from a team (V1). The snapshot
// includes the leader's dispatcher directive already appended to their
// system prompt — zero runtime cost, survives rehydration.

import { NextResponse, type NextRequest } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createRoom, setGameState } from '../../../lib/room-store'
import { getTeam } from '../../../lib/team-store'
import { buildTeamSnapshot } from '../../../lib/team-room'
import { requireAuthUserId } from '../../../lib/auth'
import { resolveAgentLanguage } from '../../../lib/language'

export const dynamic = 'force-dynamic'

interface CreateOpenChatBody {
  teamId?: unknown
  topic?: unknown
  rounds?: unknown
  language?: unknown
  humanSeatId?: unknown      // legacy single-seat; still honored
  humanSeatIds?: unknown     // Phase 4.5d multi-seat
}

export async function POST(request: NextRequest) {
  let body: CreateOpenChatBody
  try {
    body = (await request.json()) as CreateOpenChatBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.teamId !== 'string' || body.teamId.length === 0) {
    return NextResponse.json({ error: 'teamId is required' }, { status: 400 })
  }
  if (typeof body.topic !== 'string' || body.topic.trim().length === 0) {
    return NextResponse.json({ error: 'topic is required' }, { status: 400 })
  }
  const topic = body.topic.trim()

  let rounds = 3
  if (body.rounds !== undefined) {
    if (typeof body.rounds !== 'number' || body.rounds < 1 || body.rounds > 10) {
      return NextResponse.json({ error: 'rounds must be 1-10' }, { status: 400 })
    }
    rounds = Math.trunc(body.rounds)
  }

  const team = await getTeam(body.teamId)
  if (!team) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  }

  const language = await resolveAgentLanguage(
    body.language === 'en' || body.language === 'zh' ? body.language : undefined,
  )

  // Build the snapshot (richer than werewolf's thin AgentInfo — carries persona,
  // systemPrompt with leader directive baked in, and style).
  const { agents, leaderAgentId } = await buildTeamSnapshot({
    team,
    topic,
    modeId: 'open-chat',
    language,
  })

  if (agents.length === 0) {
    return NextResponse.json({ error: 'Team has no members' }, { status: 400 })
  }
  if (agents.length > 12) {
    return NextResponse.json({ error: 'Open-chat supports at most 12 agents' }, { status: 400 })
  }

  // Mark human seats (Phase 4.5d — multi, with legacy single fallback).
  const humanSeatIds = new Set<string>()
  if (Array.isArray(body.humanSeatIds)) {
    for (const id of body.humanSeatIds) if (typeof id === 'string') humanSeatIds.add(id)
  }
  if (typeof body.humanSeatId === 'string') humanSeatIds.add(body.humanSeatId)
  for (const seatId of humanSeatIds) {
    const seat = agents.find((a) => a.id === seatId)
    if (seat) {
      (seat as { isHuman?: boolean }).isHuman = true
    }
  }

  const roomId = crypto.randomUUID()
  const auth = await requireAuthUserId()
  if (!auth.ok) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }
  const createdBy = auth.id

  await createRoom({
    id: roomId,
    modeId: 'open-chat',
    topic,
    config: { teamId: team.id, topic, rounds, language },
    modeConfig: { topic, rounds, leaderAgentId, language },
    agents,
    teamId: team.id,
    createdBy,
  })

  await setGameState(roomId, {
    topic,
    turnsCompleted: 0,
    totalTurns: agents.length * rounds,
    leaderAgentId,
  })

  // Fire the first tick asynchronously — durable runtime takes over from here.
  const tickUrl = new URL('/api/rooms/tick', request.url)
  tickUrl.searchParams.set('id', roomId)
  waitUntil(
    fetch(tickUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    }).catch((err) => console.error(`[open-chat-create] ${roomId} first-tick fetch failed:`, err)),
  )

  return NextResponse.json({ roomId })
}
