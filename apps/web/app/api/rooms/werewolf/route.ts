// ============================================================
// POST /api/rooms/werewolf — Create a werewolf game (Phase 4.5d-2.17)
// ============================================================
//
// Creates the DB row, computes role assignments, builds role-specific
// systemPrompts, and enqueues a durable WDK workflow run. The workflow
// (`werewolfWorkflow`) drives the game to completion via the phase-loop
// dispatch; resumption from human seats happens via `resumeHook` in
// `apps/web/app/api/rooms/[id]/human-input/route.ts`.
//
// Werewolf is WDK-only — no `body.runtime` opt-out. The legacy
// http_chain advance loop (`advanceWerewolfRoom` in `room-runtime.ts`)
// is scheduled for deletion in 4.5d-2.18.
//
// Mirrors the open-chat / roundtable WDK branches: createRoom commits
// the row, then `start()` is wrapped in try/catch so a failure to
// enqueue flips the room to 'error' (otherwise it would stay
// 'running' forever; markOrphanedAsError skips WDK rooms).
import { NextResponse } from 'next/server'
import { start } from 'workflow/api'
import {
  assignWerewolfRoles,
  buildRoleSystemPrompt,
  type WerewolfAdvancedRules,
  type WerewolfRole,
} from '@agora/modes'
import type { LLMProvider, ModelConfig } from '@agora/shared'
import {
  createRoom,
  updateRoomStatus,
  type AgentInfo,
} from '../../../lib/room-store'
import { buildLanguageDirective, resolveAgentLanguage } from '../../../lib/language'
import { getTeam, getMembers } from '../../../lib/team-store'
import { requireAuthUserId } from '../../../lib/auth'
import {
  werewolfWorkflow,
  type WerewolfAgentSnapshot,
} from '../../../workflows/werewolf-workflow'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

interface PlayerInput {
  name: string
  model: string
  provider?: LLMProvider
}

interface CreateWerewolfBody {
  players?: PlayerInput[]
  teamId?: string
  advancedRules?: WerewolfAdvancedRules
  language?: 'en' | 'zh'
  /** Accepted shapes for backwards-compat: single id, array of ids, or null. */
  humanSeatId?: string | null
  humanSeatIds?: readonly string[]
}

function resolveProvider(modelId: string): LLMProvider {
  if (modelId.startsWith('claude')) return 'anthropic'
  if (modelId.startsWith('gpt')) return 'openai'
  if (modelId.startsWith('gemini')) return 'google'
  if (modelId.startsWith('deepseek')) return 'deepseek'
  throw new Error(`Unknown model: ${modelId}`)
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateWerewolfBody

    // Resolve `players` list either from explicit body or a team.
    let players: PlayerInput[]
    let teamId: string | null = null
    const humanPlayerNames = new Set<string>()
    if (body.teamId) {
      const team = await getTeam(body.teamId)
      if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
      const members = await getMembers(body.teamId)
      if (members.length < 6 || members.length > 12) {
        return NextResponse.json(
          { error: `Team has ${members.length} members; werewolf requires 6-12` },
          { status: 400 },
        )
      }
      teamId = team.id
      players = members.map((m) => ({
        name: m.agent.name,
        model: m.agent.modelId,
        provider: m.agent.modelProvider as LLMProvider,
      }))
      const humanSeatAgentIds = new Set<string>()
      if (Array.isArray(body.humanSeatIds)) {
        for (const id of body.humanSeatIds) if (typeof id === 'string') humanSeatAgentIds.add(id)
      }
      if (typeof body.humanSeatId === 'string') humanSeatAgentIds.add(body.humanSeatId)
      for (const agentId of humanSeatAgentIds) {
        const humanMember = members.find((m) => m.agentId === agentId)
        if (humanMember) humanPlayerNames.add(humanMember.agent.name)
      }
    } else {
      if (!body.players || body.players.length < 6 || body.players.length > 12) {
        return NextResponse.json(
          { error: 'Werewolf requires 6-12 players' },
          { status: 400 },
        )
      }
      players = body.players
    }

    const advancedRules = body.advancedRules ?? {}
    const language = await resolveAgentLanguage(body.language)
    const languageDirective = buildLanguageDirective(language)
    const auth = await requireAuthUserId()
    if (!auth.ok) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }
    const createdBy = auth.id

    // Build agent ids + name map fresh. Determinism across requests
    // isn't needed (workflow replay reads from its own input, not from
    // a recompute path); IDs are stable within this request.
    const roomId = crypto.randomUUID()
    const agentIds = players.map(() => crypto.randomUUID())
    const agentNames: Record<string, string> = {}
    players.forEach((p, i) => {
      agentNames[agentIds[i]!] = p.name
    })

    // Role assignment via @agora/modes (additive export landed in
    // 4.5d-2.14a). PRNG is Math.random — seeded determinism would
    // only matter for cross-request reproducibility, which we don't
    // need: success → workflow holds state in DB; failure → room
    // marked 'error' below, no retry.
    const roleMap = assignWerewolfRoles(
      agentIds,
      agentNames,
      advancedRules,
      Math.random,
    )
    const roleAssignments: Record<string, WerewolfRole> = {}
    for (const [id, role] of roleMap) roleAssignments[id] = role

    const allPlayerNames = agentIds.map((id) => agentNames[id]!)
    const wolfNames = agentIds
      .filter((id) => roleMap.get(id) === 'werewolf')
      .map((id) => agentNames[id]!)

    // Persist the agent snapshot for replay / endpoint lookups.
    const agentInfos: AgentInfo[] = agentIds.map((id, i) => {
      const p = players[i]!
      return {
        id,
        name: p.name,
        model: p.model,
        provider: p.provider ?? resolveProvider(p.model),
        isHuman: humanPlayerNames.has(p.name),
      }
    })

    // Build the workflow input. Each snapshot carries the role +
    // pre-composed systemPrompt so the workflow body never recomputes
    // role assignments (load-bearing — see WerewolfAgentSnapshot
    // doc-comment in werewolf-workflow.ts).
    const snapshots: WerewolfAgentSnapshot[] = agentIds.map((id, i) => {
      const p = players[i]!
      const role = roleMap.get(id)!
      const provider = p.provider ?? resolveProvider(p.model)
      const systemPrompt = buildRoleSystemPrompt(
        p.name,
        role,
        [...allPlayerNames],
        [...wolfNames],
        languageDirective,
      )
      const model: ModelConfig = {
        provider,
        modelId: p.model,
        maxTokens: 1500,
      }
      return {
        id,
        name: p.name,
        persona: 'A player in the werewolf game',
        systemPrompt,
        role,
        model,
        isHuman: humanPlayerNames.has(p.name),
      }
    })

    // Persist the room shell. `runtime: 'wdk'` is load-bearing — the
    // human-input endpoint dispatches on it to use resumeHook instead
    // of the legacy tick chain. Initial gameState is set by the
    // workflow's `initializeGameState` step on first run, not here.
    await createRoom({
      id: roomId,
      modeId: 'werewolf',
      topic: 'Werewolf',
      config: { players, advancedRules, language },
      modeConfig: { advancedRules, language, playerCount: players.length },
      agents: agentInfos,
      roleAssignments,
      advancedRules: advancedRules as Record<string, boolean>,
      teamId,
      createdBy,
      runtime: 'wdk',
    })

    // Enqueue the workflow. start() returns immediately after
    // enqueueing; the workflow runs durably in the WDK runtime. If
    // enqueue itself throws, flip the room to 'error' so the row
    // doesn't sit at 'running' forever (markOrphanedAsError skips
    // WDK rooms intentionally).
    try {
      await start(werewolfWorkflow, [
        {
          roomId,
          agents: snapshots,
          advancedRules,
          seed: roomId,
        },
      ])
      return NextResponse.json({ roomId, runtime: 'wdk' })
    } catch (workflowStartError) {
      const msg =
        workflowStartError instanceof Error
          ? workflowStartError.message
          : String(workflowStartError)
      console.error(`[werewolf wdk-start] ${roomId} failed to enqueue:`, workflowStartError)
      await updateRoomStatus(roomId, 'error', `WDK enqueue failed: ${msg}`)
      return NextResponse.json(
        { error: 'Failed to start WDK runtime', roomId },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error('Failed to create werewolf game:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create game' },
      { status: 500 },
    )
  }
}
