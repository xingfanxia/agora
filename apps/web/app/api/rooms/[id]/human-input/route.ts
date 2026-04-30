// ============================================================
// POST /api/rooms/[id]/human-input
// ============================================================
//
// Phase 4.5c — Accept human player input and resume the tick chain.
// Phase 4.5d-2.10b — WDK runtime branch via resumeHook (open-chat).
// Phase 4.5d-2.17 — WDK werewolf branch via resumeHook (day-vote).
//
// Flow (legacy http_chain):
//   1. Validate room is in 'waiting' state and agentId matches waitingForHuman
//   2. Insert the human's message as a regular message:created event
//   3. Set room status back to 'running'
//   4. Fire the next tick via waitUntil(fetch(/api/rooms/tick))
//
// Flow (WDK, mode='open-chat'):
//   1. Same validation (room.status='waiting', gameState.waitingForHuman)
//   2. Same authZ (Bearer seat-token OR owner session)
//   3. Read gameState.waitingForTurnIdx (set by workflow's
//      markWaitingForHuman step)
//   4. Reconstruct `humanTurnToken(roomId, turnIdx)` and call
//      `resumeHook(token, { text })`. The workflow itself owns
//      persistence + status update on resume.
//
// Flow (WDK, mode='werewolf'):
//   1. NO room-status lock — runDayVote registers hooks for every
//      human voter in parallel, room stays 'running' across the
//      whole vote phase. Eligibility is computed from
//      gameState.currentPhase + the agents snapshot.
//   2. Same authZ (Bearer seat-token OR owner session)
//   3. Validate phase == 'dayVote', voter is in snapshot + isHuman
//      + not eliminated, payload.target is non-empty
//   4. Reconstruct `werewolfDayVoteToken(roomId, nightNumber, agentId)`
//      and call `resumeHook(token, { target, reason })`. Workflow's
//      collectHumanDayVote handles persistence on resume.
//
// Other WDK + human modes are rejected with 501 until they ship their
// own token namespace and dispatch entry.
//
// The human's message is indistinguishable from an AI message in the
// event stream — same schema, same replay semantics.

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { resumeHook } from 'workflow/api'
import { getRoom, updateRoomStatus, appendEvent, getEventCount } from '../../../../lib/room-store'
import { getAuthUser } from '../../../../lib/supabase-server'
import { verifySeatToken } from '../../../../lib/seat-tokens'
import {
  humanTurnToken as openChatHumanTurnToken,
  type HumanTurnPayload,
} from '../../../../workflows/open-chat-workflow'
import {
  werewolfDayVoteToken,
  type WerewolfPersistedState,
} from '../../../../workflows/werewolf-workflow'
import type { HumanDayVotePayload } from '../../../../workflows/werewolf-day-phases'

export const dynamic = 'force-dynamic'

async function authorizeSeatClaim(
  request: Request,
  roomId: string,
  agentId: string,
  ownerUserId: string | null,
): Promise<boolean> {
  // Bearer seat-token → must be for this (roomId, agentId) pair.
  const authHeader = request.headers.get('authorization') ?? ''
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim()
    const payload = await verifySeatToken(token, roomId)
    return payload?.agentId === agentId
  }

  // Else fall back to a logged-in room owner — they can play any seat
  // (e.g. testing locally with a second tab).
  const user = await getAuthUser()
  if (user && ownerUserId && user.id === ownerUserId) return true

  return false
}

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
  // agentId + payload are required by both runtimes. turnId is the
  // legacy http_chain branch's discriminator for resolveHumanMessage's
  // switch (see bottom of this file); the WDK branch reads turnIdx
  // from gameState.waitingForTurnIdx instead and ignores turnId.
  // Validating turnId only when it's actually used keeps the WDK
  // contract from leaking a confusing legacy field requirement.
  if (!agentId || !payload) {
    return NextResponse.json(
      { error: 'Missing required fields: agentId, payload' },
      { status: 400 },
    )
  }

  // Validate room state
  const roomRow = await getRoom(roomId)
  if (!roomRow) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  // Werewolf-WDK has different room-lock semantics: status stays
  // 'running' across dayVote because runDayVote collects votes from
  // all human seats in parallel via Promise.all over independent
  // hooks (no single waitingForHuman marker). Skip the lock checks
  // here; the werewolf branch below validates phase + voter
  // eligibility instead.
  const isWerewolfWdk =
    roomRow.runtime === 'wdk' && roomRow.modeId === 'werewolf'

  if (!isWerewolfWdk) {
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
  }

  // AuthZ — bearer seat-token or owner session.
  const authorized = await authorizeSeatClaim(request, roomId, agentId, roomRow.createdBy)
  if (!authorized) {
    return NextResponse.json(
      { error: 'Missing or invalid seat token' },
      { status: 401 },
    )
  }

  // ── WDK branch (4.5d-2.10b) ─────────────────────────────────
  //
  // For WDK rooms, the workflow itself owns persistence + status
  // transitions. We just resume the hook the workflow is paused on.
  // The workflow's persistHumanMessage step writes the message:created
  // event after resume; markRunningAgain step flips status back.
  //
  // This branch runs AFTER state-validation and authZ. Same checks as
  // legacy: status='waiting', gameState.waitingForHuman===agentId.
  if (roomRow.runtime === 'wdk') {
    if (roomRow.modeId === 'open-chat') {
      // Defense-in-depth: validate text BEFORE calling resumeHook so a
      // bad payload doesn't push the workflow into FatalError → room
      // 'error' state. The workflow body has its own non-empty check
      // for resumes triggered by other tooling (Vercel dashboard,
      // scripts), but we should fail cleanly here for endpoint callers.
      const text = typeof payload.content === 'string' ? payload.content.trim() : ''
      if (text.length === 0) {
        return NextResponse.json(
          { error: 'WDK human-input requires non-empty payload.content' },
          { status: 400 },
        )
      }

      // turnIdx is the workflow loop index, written by the workflow's
      // markWaitingForHuman step into gameState.waitingForTurnIdx
      // alongside waitingForHuman. The endpoint cannot derive it
      // independently (would have to parse events to count turns),
      // so the workflow → endpoint contract is: workflow writes the
      // breadcrumb, endpoint reads it. A missing field means the
      // workflow paused without setting state correctly -- 500, not
      // 400, since this is a server-side invariant violation.
      const gs = roomRow.gameState as { waitingForTurnIdx?: unknown } | null
      const turnIdx = gs?.waitingForTurnIdx
      if (typeof turnIdx !== 'number' || !Number.isInteger(turnIdx) || turnIdx < 0) {
        return NextResponse.json(
          { error: 'gameState.waitingForTurnIdx missing or invalid' },
          { status: 500 },
        )
      }

      const token = openChatHumanTurnToken(roomId, turnIdx)
      const hookPayload: HumanTurnPayload = { text }

      try {
        await resumeHook(token, hookPayload)
      } catch (resumeErr) {
        // resumeHook throws if the hook isn't currently registered
        // (workflow not paused at this token, or already resumed
        // by a duplicate POST). Treat as 409 Conflict — the
        // resource state moved out from under the request, not
        // server breakage. Log the underlying error for diagnosis;
        // don't leak it verbatim (run ids etc.).
        console.warn(
          `[human-input wdk open-chat] resumeHook failed for ${token}:`,
          resumeErr,
        )
        return NextResponse.json(
          { error: 'Turn already submitted or no longer accepting input' },
          { status: 409 },
        )
      }

      return NextResponse.json({ ok: true, runtime: 'wdk' })
    }

    if (roomRow.modeId === 'werewolf') {
      // Werewolf differs from open-chat: runDayVote collects votes
      // from all human seats in parallel (each seat has its own
      // hook), so the room stays at status='running' throughout and
      // there's no single waitingForHuman marker. Eligibility is
      // computed from gameState.currentPhase + agents snapshot.
      //
      // Only dayVote accepts human input today. lastWords / hunter
      // / sheriff phases land in 4.5d-2.16 with their own tokens.
      const gs = roomRow.gameState as Partial<WerewolfPersistedState> | null
      if (gs?.currentPhase !== 'dayVote') {
        return NextResponse.json(
          {
            error:
              `Werewolf room not accepting human input (phase: ${gs?.currentPhase ?? 'unknown'})`,
          },
          { status: 409 },
        )
      }

      // Voter must be in the snapshot, marked human, and alive.
      const agents = (roomRow.agents as unknown as Array<{
        id: string
        name: string
        isHuman?: boolean
      }>) ?? []
      const voter = agents.find((a) => a.id === agentId)
      if (!voter) {
        return NextResponse.json(
          { error: `Agent ${agentId} not in this room` },
          { status: 403 },
        )
      }
      if (!voter.isHuman) {
        return NextResponse.json(
          { error: `Agent ${agentId} is not a human seat` },
          { status: 403 },
        )
      }
      // Defensive shape check on eliminatedIds — the workflow owns
      // this field but corruption (manual edit, partial migration)
      // could leave non-string entries that .includes silently
      // misses, letting an eliminated player vote.
      const eliminatedRaw = gs.eliminatedIds
      const eliminated: string[] = Array.isArray(eliminatedRaw)
        ? eliminatedRaw.filter((x): x is string => typeof x === 'string')
        : []
      if (eliminated.includes(agentId)) {
        return NextResponse.json(
          { error: `Agent ${agentId} has been eliminated` },
          { status: 409 },
        )
      }

      // Validate payload shape. The workflow's collectHumanDayVote
      // has its own defensive normalization (empty target → abstain),
      // but reject obviously bad shapes here so callers get a clean
      // 400 rather than a silent abstain on the workflow side.
      const target = typeof payload.target === 'string' ? payload.target.trim() : ''
      if (target.length === 0) {
        return NextResponse.json(
          { error: 'Werewolf day-vote requires payload.target (a player name or "skip")' },
          { status: 400 },
        )
      }
      const reason =
        typeof payload.reason === 'string' && payload.reason.trim().length > 0
          ? payload.reason.trim()
          : undefined

      // nightNumber is the cycle index in the persisted state. It's
      // load-bearing for token reconstruction — the workflow's
      // collectHumanDayVote built the hook with this exact value,
      // and we have to match.
      const nightNumber = typeof gs.nightNumber === 'number' ? gs.nightNumber : null
      if (nightNumber === null || !Number.isInteger(nightNumber) || nightNumber < 0) {
        return NextResponse.json(
          { error: 'gameState.nightNumber missing or invalid' },
          { status: 500 },
        )
      }

      const token = werewolfDayVoteToken(roomId, nightNumber, agentId)
      const hookPayload: HumanDayVotePayload = reason
        ? { target, reason }
        : { target }

      try {
        await resumeHook(token, hookPayload)
      } catch (resumeErr) {
        // 409 not 500: under werewolf's parallel-hook design the
        // 45s grace timeout makes "stale hook" the most likely
        // failure mode (sleep won the race, runDayVote moved on).
        // Duplicate POST during the window also lands here. The
        // resource state changed underneath the request — it's
        // not server breakage. Log for diagnosis; surface a
        // generic message so callers don't infer too much.
        console.warn(
          `[human-input wdk werewolf] resumeHook failed for ${token}:`,
          resumeErr,
        )
        return NextResponse.json(
          { error: 'Vote window closed or already submitted' },
          { status: 409 },
        )
      }

      return NextResponse.json({ ok: true, runtime: 'wdk', mode: 'werewolf' })
    }

    return NextResponse.json(
      {
        error:
          `WDK runtime + human seats not yet supported for mode '${roomRow.modeId}'`,
      },
      { status: 501 },
    )
  }

  // ── Legacy http_chain branch (default) ───────────────────────

  // turnId discriminates the legacy `resolveHumanMessage` switch
  // (channel + payload-shape per game phase). Required only on this
  // branch -- the WDK branch above derives turnIdx from gameState.
  if (!turnId) {
    return NextResponse.json(
      { error: 'Missing required field: turnId (http_chain runtime)' },
      { status: 400 },
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
