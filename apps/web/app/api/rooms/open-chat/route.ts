// ============================================================
// POST /api/rooms/open-chat — Create an open-chat room from a team
// ============================================================
//
// Open-chat rooms are always composed from a team (V1). The snapshot
// includes the leader's dispatcher directive already appended to their
// system prompt — zero runtime cost, survives rehydration.

import { NextResponse, type NextRequest } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { start } from 'workflow/api'
import { createRoom, setGameState, updateRoomStatus } from '../../../lib/room-store'
import { getTeam } from '../../../lib/team-store'
import { buildTeamSnapshot } from '../../../lib/team-room'
import { requireAuthUserId } from '../../../lib/auth'
import { resolveAgentLanguage } from '../../../lib/language'
import {
  openChatWorkflow,
  toOpenChatAgentSnapshot,
} from '../../../workflows/open-chat-workflow'

export const dynamic = 'force-dynamic'

interface CreateOpenChatBody {
  teamId?: unknown
  topic?: unknown
  rounds?: unknown
  language?: unknown
  humanSeatId?: unknown      // legacy single-seat; still honored
  humanSeatIds?: unknown     // Phase 4.5d multi-seat
  // Phase 4.5d-2.10 -- per-room runtime selector. Default 'http_chain'
  // until cross-runtime equivalence parity for open-chat is proven
  // (which 4.5d-2.8's test scope didn't yet cover -- only roundtable).
  // 'wdk' runs the durable openChatWorkflow; client opt-in until ready
  // to flip the default.
  runtime?: unknown
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

  // Default to http_chain for now -- the cross-runtime equivalence
  // test from 4.5d-2.8 covers roundtable but NOT open-chat (the
  // human-seat hook resume path needs its own integration test).
  // Caller can opt into wdk explicitly; flip to default 'wdk' once
  // open-chat equivalence is proven AND the WDK human-input
  // endpoint (4.5d-2.10b) is in place.
  const runtime: 'http_chain' | 'wdk' = body.runtime === 'wdk' ? 'wdk' : 'http_chain'

  // Pre-flight check for WDK humans: WDK supports human seats via
  // createHook, but the resumeHook caller (the human-input endpoint)
  // doesn't have a WDK branch yet (4.5d-2.10b). Reject WDK + humans
  // for now so a misconfigured client doesn't create a room that
  // appears to start but blocks indefinitely on the first human turn.
  // AI-only WDK rooms work today.
  if (runtime === 'wdk' && humanSeatIds.size > 0) {
    return NextResponse.json(
      {
        error:
          'WDK runtime does not yet support human seats for open-chat. Use http_chain or wait for 4.5d-2.10b.',
      },
      { status: 400 },
    )
  }

  await createRoom({
    id: roomId,
    modeId: 'open-chat',
    topic,
    config: { teamId: team.id, topic, rounds, language },
    modeConfig: { topic, rounds, leaderAgentId, language },
    agents,
    teamId: team.id,
    createdBy,
    runtime,
  })

  await setGameState(roomId, {
    topic,
    turnsCompleted: 0,
    totalTurns: agents.length * rounds,
    leaderAgentId,
  })

  if (runtime === 'wdk') {
    // WDK path: skip the legacy tick fetch entirely; the workflow
    // body owns its own LLM calls + persistence per the durability
    // contract. Mirrors roundtable's WDK enqueue (apps/web/app/api/
    // rooms/route.ts).
    //
    // Wrapped in try/catch: createRoom already committed by this
    // point. If snapshot-build or start() throws, the room row would
    // otherwise stay at status='running' forever (markOrphanedAsError
    // skips WDK rooms intentionally). Flip to 'error' explicitly so
    // the row is recoverable + observable.
    try {
      const snapshots = agents.map((info) => {
        if (!info.systemPrompt) {
          throw new Error(`agent ${info.id} missing systemPrompt for WDK runtime`)
        }
        return toOpenChatAgentSnapshot(info, info.systemPrompt)
      })

      await start(openChatWorkflow, [
        {
          roomId,
          agents: snapshots,
          topic,
          rounds,
        },
      ])

      return NextResponse.json({ roomId, runtime: 'wdk' })
    } catch (workflowStartError) {
      const msg =
        workflowStartError instanceof Error
          ? workflowStartError.message
          : String(workflowStartError)
      console.error(`[open-chat wdk-start] ${roomId} failed to enqueue:`, workflowStartError)
      await updateRoomStatus(roomId, 'error', `WDK enqueue failed: ${msg}`)
      return NextResponse.json(
        { error: 'Failed to start WDK runtime', roomId },
        { status: 500 },
      )
    }
  }

  // http_chain path (default): fire the first tick asynchronously —
  // durable runtime takes over from here.
  const tickUrl = new URL('/api/rooms/tick', request.url)
  tickUrl.searchParams.set('id', roomId)
  waitUntil(
    fetch(tickUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    }).catch((err) => console.error(`[open-chat-create] ${roomId} first-tick fetch failed:`, err)),
  )

  return NextResponse.json({ roomId, runtime: 'http_chain' })
}
