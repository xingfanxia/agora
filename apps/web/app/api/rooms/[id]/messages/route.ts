// ============================================================
// GET /api/rooms/:id/messages — Poll for room messages + state
// ============================================================
//
// Channel visibility is enforced HERE (not just in the UI). The wolf
// channels — `werewolf` (wolf chat) and `wolf-vote` (blind night
// vote) — leak the wolf identities if a non-wolf can read them, so
// returning all messages to all viewers would invalidate the game.
//
// Visibility model:
//   - Owner of the room (auth.user.id === room.createdBy) sees all
//     channels — they're the spectator/admin. The owner who's also
//     a player still gets all channels here; their player view is
//     up to the client (we may add a "player mode" toggle later).
//   - Caller passes `?seat=<agentId>` to identify their seat. The
//     claim is honored only with proof: a Bearer seat token signed
//     for (room, seat), or the room owner's session. An unproven
//     claim is treated as a strict observer. The seat must also
//     exist in the room's agents snapshot; its role then filters
//     channels.
//   - No seat + no owner-auth → caller is treated as a strict
//     observer and sees only public channels (`main`, `day-vote`,
//     `system`). Used for un-claimed shared links.
//
// `gameState.currentPhase` (JSONB, written by the WDK workflow) is
// surfaced as `snapshot.currentPhase` when the legacy column is null,
// so the client's PhaseBadge resolves correctly under the WDK runtime.

import { NextResponse } from 'next/server'
import { getMessagesSince, getRoomSnapshot, type AgentInfo } from '../../../../lib/room-store'
import { getAuthUser } from '../../../../lib/supabase-server'
import { verifySeatToken } from '../../../../lib/seat-tokens'
import {
  bearerToken,
  projectWerewolfAgents,
  projectWerewolfGameState,
  projectWerewolfThinkingAgentId,
  withholdsTokenUsage,
} from '../../../../lib/werewolf-visibility'

export const dynamic = 'force-dynamic'

// Werewolf-specific channel visibility. Roles not listed (villager,
// hunter, idiot) get only public channels.
// `day-vote` is NOT public: 狼人杀 closed-eyes voting expects votes to
// remain anonymous until the tally announcement (which goes to `main`).
// Spectators / replay still see individual votes via the spectator
// carve-out below.
const PUBLIC_CHANNELS = new Set(['main', 'system'])

const ROLE_PRIVATE_CHANNELS: Record<string, ReadonlySet<string>> = {
  werewolf: new Set(['werewolf', 'wolf-vote']),
  seer: new Set(['seer-result']),
  witch: new Set(['witch-action']),
  guard: new Set(['guard-action']),
}

function visibleChannelsFor(role: string | null | undefined): ReadonlySet<string> | null {
  // null → spectator: see all (no filter applied).
  if (role === 'spectator') return null
  const allowed = new Set<string>(PUBLIC_CHANNELS)
  if (role && ROLE_PRIVATE_CHANNELS[role]) {
    for (const ch of ROLE_PRIVATE_CHANNELS[role]) allowed.add(ch)
  }
  return allowed
}

interface MessageLike {
  channelId: string
}

function filterMessagesByChannels<T extends MessageLike>(
  messages: readonly T[],
  allowed: ReadonlySet<string> | null,
): readonly T[] {
  if (!allowed) return messages
  return messages.filter((m) => allowed.has(m.channelId))
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const snapshot = await getRoomSnapshot(id)
  if (!snapshot) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const afterParam = url.searchParams.get('after')
  const after = afterParam ? parseInt(afterParam, 10) : 0
  const seatParam = url.searchParams.get('seat')

  // Resolve the viewer's role for channel-visibility filtering.
  // Werewolf is the only mode that gates messages today; other modes
  // get the unfiltered (spectator) view.
  let viewerRole: string | null = null
  let verifiedSeat: string | null = null
  if (snapshot.modeId === 'werewolf') {
    const user = await getAuthUser().catch(() => null)
    const isOwner = user?.id != null && user.id === snapshot.createdBy

    if (seatParam) {
      // Caller claims a specific seat. Validate that seat exists in the
      // room's agents snapshot before honoring it (so a typo can't
      // accidentally upgrade visibility), and that the caller proved
      // the claim (seat token for this room+seat, or owner session).
      const agents = (snapshot.agents as readonly AgentInfo[]) ?? []
      const claimedSeat = agents.find((a) => a.id === seatParam)
      const token = bearerToken(request)
      const seatProven =
        isOwner ||
        (token != null && (await verifySeatToken(token, id))?.agentId === seatParam)
      if (claimedSeat && seatProven) {
        verifiedSeat = seatParam
        const role = snapshot.roleAssignments?.[seatParam] ?? null
        viewerRole = role
      } else {
        // Unknown or unproven seat — treat as strict observer.
        viewerRole = null
      }
    } else if (isOwner) {
      // Owner without a claimed seat — spectator view (sees all).
      viewerRole = 'spectator'
    } else {
      // No seat, not the owner — strict observer.
      viewerRole = null
    }
  } else {
    viewerRole = 'spectator'
  }

  const allowedChannels = visibleChannelsFor(viewerRole)
  const allMessages = await getMessagesSince(id, after)
  const messages = filterMessagesByChannels(allMessages, allowedChannels)

  // Filter roleAssignments by viewer's visibility:
  //   - Spectator (owner) and post-game (status=completed) → full reveal.
  //   - Werewolf player → see own role + other wolves (wolves coordinate).
  //   - Other players → see ONLY own role.
  //   - Strict observer (no seat, not owner) → see nothing.
  // Without this, the round-table view leaks every seat's role to every
  // viewer (caught while playtesting — 林溪's hunter, 顾君's werewolf
  // etc. were all visible to a non-spectator).
  let visibleRoles = snapshot.roleAssignments
  if (snapshot.modeId === 'werewolf' && visibleRoles) {
    if (snapshot.status === 'completed' || viewerRole === 'spectator') {
      // Full reveal — leave visibleRoles as-is.
    } else if (verifiedSeat && viewerRole) {
      const filtered: Record<string, string> = {}
      const ownRole = visibleRoles[verifiedSeat]
      if (ownRole) filtered[verifiedSeat] = ownRole
      if (ownRole === 'werewolf') {
        for (const [aid, role] of Object.entries(visibleRoles)) {
          if (role === 'werewolf') filtered[aid] = role
        }
      }
      visibleRoles = filtered
    } else {
      visibleRoles = {}
    }
  }

  // Prefer gameState.currentPhase (written by WDK workflow) over the
  // legacy `current_phase` column, which the WDK path doesn't update.
  // Falls back to the column for the legacy http_chain runtime.
  const gameStatePhase =
    typeof snapshot.gameState?.['currentPhase'] === 'string'
      ? (snapshot.gameState['currentPhase'] as string)
      : null
  const currentPhase = snapshot.currentPhase ?? gameStatePhase

  // In-progress werewolf games: players/observers get a projected view
  // (no roleMap, other roles' night state, role-bearing seat prompts,
  // or which seat is acting at night). tokenSummary is withheld too:
  // night actors record LLM usage per seat, so live per-agent/per-model
  // call counts would name the wolves, seer, witch and guard.
  const projectForViewer =
    snapshot.modeId === 'werewolf' &&
    snapshot.status !== 'completed' &&
    viewerRole !== 'spectator'

  return NextResponse.json({
    messages,
    status: snapshot.status,
    currentRound: snapshot.currentRound,
    totalRounds:
      (snapshot.config as { rounds?: number } | null)?.rounds ?? snapshot.currentRound,
    currentPhase,
    modeId: snapshot.modeId,
    thinkingAgentId: projectForViewer
      ? projectWerewolfThinkingAgentId(snapshot.thinkingAgentId, currentPhase, viewerRole)
      : snapshot.thinkingAgentId,
    agents: projectForViewer ? projectWerewolfAgents(snapshot.agents) : snapshot.agents,
    topic: snapshot.topic ?? '',
    tokenSummary: withholdsTokenUsage(snapshot.modeId, snapshot.status, viewerRole)
      ? null
      : snapshot.tokenSummary,
    roleAssignments: visibleRoles,
    advancedRules: snapshot.advancedRules,
    gameState: projectForViewer
      ? projectWerewolfGameState(snapshot.gameState, viewerRole, verifiedSeat)
      : snapshot.gameState,
    error: snapshot.error,
    // For the client to show a "your role" banner (and to know what
    // it can/can't see). Derived server-side so a forged client-side
    // role can't reveal hidden channels.
    viewerRole: viewerRole ?? 'observer',
  })
}
