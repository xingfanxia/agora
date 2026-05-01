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
import { roundtableHumanTurnToken } from '../../../../workflows/roundtable-workflow'
import {
  werewolfDayDiscussToken,
  werewolfDayVoteToken,
  type HumanDayDiscussPayload,
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

    if (roomRow.modeId === 'roundtable') {
      // Same shape as open-chat: workflow body markWaitingForRoundtableHuman
      // wrote `gameState.waitingForTurnIdx`. Reconstruct the per-turn
      // token via roundtableHumanTurnToken and resumeHook.
      const text = typeof payload.content === 'string' ? payload.content.trim() : ''
      if (text.length === 0) {
        return NextResponse.json(
          { error: 'WDK human-input requires non-empty payload.content' },
          { status: 400 },
        )
      }

      const gs = roomRow.gameState as { waitingForTurnIdx?: unknown } | null
      const turnIdx = gs?.waitingForTurnIdx
      if (typeof turnIdx !== 'number' || !Number.isInteger(turnIdx) || turnIdx < 0) {
        return NextResponse.json(
          { error: 'gameState.waitingForTurnIdx missing or invalid' },
          { status: 500 },
        )
      }

      const token = roundtableHumanTurnToken(roomId, turnIdx)
      const hookPayload: HumanTurnPayload = { text }

      try {
        await resumeHook(token, hookPayload)
      } catch (resumeErr) {
        console.warn(
          `[human-input wdk roundtable] resumeHook failed for ${token}:`,
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
      // Werewolf has TWO phases that accept human input:
      //
      // 1. dayVote (parallel): all human voters' hooks race in parallel,
      //    room stays 'running' across the phase — eligibility is
      //    computed from the snapshot, not from a waitingForHuman
      //    breadcrumb. 45s grace.
      //
      // 2. dayDiscuss (sequential): one human at a time, room flips to
      //    'waiting' with gameState.waitingForHuman set to the active
      //    speaker. The HumanPlayBar UI's isMyTurn check fires; the
      //    speaker types in the chat textarea. 90s grace.
      //
      // Other phases (wolfDiscuss, lastWords, hunter / sheriff /
      // witch / seer / guard private actions) are still AI-only or
      // panel-driven; their tokens land alongside their phase support.
      const gs = roomRow.gameState as Partial<WerewolfPersistedState> | null
      const phase = gs?.currentPhase
      if (phase !== 'dayVote' && phase !== 'dayDiscuss') {
        return NextResponse.json(
          {
            error:
              `Werewolf room not accepting human input (phase: ${phase ?? 'unknown'})`,
          },
          { status: 409 },
        )
      }

      // Voter / speaker must be in the snapshot, marked human, and alive.
      const agents = (roomRow.agents as unknown as Array<{
        id: string
        name: string
        isHuman?: boolean
      }>) ?? []
      const seat = agents.find((a) => a.id === agentId)
      if (!seat) {
        return NextResponse.json(
          { error: `Agent ${agentId} not in this room` },
          { status: 403 },
        )
      }
      if (!seat.isHuman) {
        return NextResponse.json(
          { error: `Agent ${agentId} is not a human seat` },
          { status: 403 },
        )
      }
      // Defensive shape check on eliminatedIds — the workflow owns
      // this field but corruption (manual edit, partial migration)
      // could leave non-string entries that .includes silently
      // misses, letting an eliminated player participate.
      const eliminatedRaw = gs?.eliminatedIds
      const eliminated: string[] = Array.isArray(eliminatedRaw)
        ? eliminatedRaw.filter((x): x is string => typeof x === 'string')
        : []
      if (eliminated.includes(agentId)) {
        return NextResponse.json(
          { error: `Agent ${agentId} has been eliminated` },
          { status: 409 },
        )
      }

      // nightNumber is the cycle index in the persisted state. It's
      // load-bearing for token reconstruction — the workflow's
      // collectHumanDayVote / collectHumanDayDiscuss built the hook
      // with this exact value, and we have to match.
      const nightNumber = typeof gs?.nightNumber === 'number' ? gs.nightNumber : null
      if (nightNumber === null || !Number.isInteger(nightNumber) || nightNumber < 0) {
        return NextResponse.json(
          { error: 'gameState.nightNumber missing or invalid' },
          { status: 500 },
        )
      }

      // Per-phase payload validation + token reconstruction.
      let token: string
      let hookPayload: HumanDayVotePayload | HumanDayDiscussPayload

      if (phase === 'dayVote') {
        // Validate vote shape. The workflow's collectHumanDayVote
        // has defensive normalization (empty target → abstain), but
        // reject obviously bad shapes here so callers get a clean 400.
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

        token = werewolfDayVoteToken(roomId, nightNumber, agentId)
        hookPayload = reason ? { target, reason } : { target }
      } else {
        // phase === 'dayDiscuss'
        // Sequential — additionally check `waitingForHuman` matches
        // this agentId. If it doesn't, another speaker holds the slot
        // (or the workflow already advanced). 409 is the right code:
        // resource state moved out from under the request, not server
        // breakage.
        // waitingForHuman is a transient breadcrumb the workflow writes
        // via markWaitingForWerewolfHuman; not part of WerewolfPersistedState's
        // strongly-typed surface. Read through a wider cast.
        const waitingHint = (roomRow.gameState ?? {}) as { waitingForHuman?: unknown }
        const waitingForHuman =
          typeof waitingHint.waitingForHuman === 'string' ? waitingHint.waitingForHuman : null
        if (waitingForHuman !== agentId) {
          return NextResponse.json(
            {
              error:
                waitingForHuman === null
                  ? 'Werewolf day-discuss not awaiting input'
                  : `Werewolf day-discuss is awaiting ${waitingForHuman}, not ${agentId}`,
            },
            { status: 409 },
          )
        }

        const text = typeof payload.content === 'string' ? payload.content.trim() : ''
        if (text.length === 0) {
          return NextResponse.json(
            { error: 'Werewolf day-discuss requires non-empty payload.content' },
            { status: 400 },
          )
        }

        token = werewolfDayDiscussToken(roomId, nightNumber, agentId)
        hookPayload = { text }
      }

      try {
        await resumeHook(token, hookPayload)
      } catch (resumeErr) {
        // 409 not 500: under werewolf's hook-based design, the most
        // likely failure mode is the grace timeout firing first
        // (sleep won the race, workflow moved on) or a duplicate POST
        // during the window. Resource state changed underneath the
        // request — not server breakage. Log for diagnosis; surface
        // a generic message so callers don't infer too much.
        console.warn(
          `[human-input wdk werewolf ${phase}] resumeHook failed for ${token}:`,
          resumeErr,
        )
        return NextResponse.json(
          {
            error:
              phase === 'dayVote'
                ? 'Vote window closed or already submitted'
                : 'Discussion window closed or already submitted',
          },
          { status: 409 },
        )
      }

      return NextResponse.json({ ok: true, runtime: 'wdk', mode: 'werewolf', phase })
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
