// ============================================================
// GET  /api/teams          — list (scope: mine|templates|null)
// POST /api/teams          — create team (+ optional member ids)
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { getAgents } from '../../lib/agent-store'
import { createTeam, listTeams, setMembers } from '../../lib/team-store'
import { getUserIdFromRequest } from '../../lib/user-id'

export const dynamic = 'force-dynamic'

const VALID_MODES = ['open-chat', 'roundtable', 'werewolf'] as const

interface CreateTeamBody {
  name?: unknown
  description?: unknown
  avatarSeed?: unknown
  leaderAgentId?: unknown
  defaultModeId?: unknown
  memberIds?: unknown
}

// ── GET ────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const scope = url.searchParams.get('scope')
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '200', 10), 1), 500)
  const uid = getUserIdFromRequest(request)

  if (scope === 'mine') {
    if (!uid) return NextResponse.json({ teams: [] })
    const rows = await listTeams({ createdBy: uid, limit })
    return NextResponse.json({ teams: rows })
  }
  if (scope === 'templates') {
    const rows = await listTeams({ isTemplate: true, limit })
    return NextResponse.json({ teams: rows })
  }

  const [templates, mine] = await Promise.all([
    listTeams({ isTemplate: true, limit }),
    uid ? listTeams({ createdBy: uid, limit }) : Promise.resolve([]),
  ])
  return NextResponse.json({ teams: [...templates, ...mine] })
}

// ── POST ───────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const uid = getUserIdFromRequest(request)
  if (!uid) {
    return NextResponse.json(
      { error: 'Missing agora-uid cookie. Visit the app once to initialize.' },
      { status: 401 },
    )
  }

  let body: CreateTeamBody
  try {
    body = (await request.json()) as CreateTeamBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (body.name.length > 100) {
    return NextResponse.json({ error: 'name too long' }, { status: 400 })
  }
  if (typeof body.avatarSeed !== 'string' || body.avatarSeed.trim().length === 0) {
    return NextResponse.json({ error: 'avatarSeed is required' }, { status: 400 })
  }

  let description: string | null = null
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string' || body.description.length > 2000) {
      return NextResponse.json({ error: 'description invalid' }, { status: 400 })
    }
    description = body.description.length > 0 ? body.description : null
  }

  let defaultModeId: string | null = null
  if (body.defaultModeId !== undefined && body.defaultModeId !== null) {
    if (typeof body.defaultModeId !== 'string' || !VALID_MODES.includes(body.defaultModeId as (typeof VALID_MODES)[number])) {
      return NextResponse.json({ error: `defaultModeId must be one of ${VALID_MODES.join(', ')}` }, { status: 400 })
    }
    defaultModeId = body.defaultModeId
  }

  let memberIds: string[] = []
  if (body.memberIds !== undefined) {
    if (!Array.isArray(body.memberIds) || !body.memberIds.every((x) => typeof x === 'string')) {
      return NextResponse.json({ error: 'memberIds must be an array of strings' }, { status: 400 })
    }
    if (body.memberIds.length > 12) {
      return NextResponse.json({ error: 'max 12 members per team' }, { status: 400 })
    }
    memberIds = body.memberIds as string[]
  }

  let leaderAgentId: string | null = null
  if (body.leaderAgentId !== undefined && body.leaderAgentId !== null) {
    if (typeof body.leaderAgentId !== 'string') {
      return NextResponse.json({ error: 'leaderAgentId invalid' }, { status: 400 })
    }
    if (memberIds.length > 0 && !memberIds.includes(body.leaderAgentId)) {
      return NextResponse.json(
        { error: 'leaderAgentId must be one of memberIds' },
        { status: 400 },
      )
    }
    leaderAgentId = body.leaderAgentId
  }

  // Check all memberIds refer to agents the user can use (own or templates).
  if (memberIds.length > 0) {
    const agents = await getAgents(memberIds)
    const missing = memberIds.filter((id) => !agents.find((a) => a.id === id))
    if (missing.length) {
      return NextResponse.json({ error: `unknown agent ids: ${missing.join(', ')}` }, { status: 400 })
    }
    for (const agent of agents) {
      const isAccessible = agent.isTemplate || agent.createdBy === uid
      if (!isAccessible) {
        return NextResponse.json({ error: `not authorized to use agent ${agent.id}` }, { status: 403 })
      }
    }
  }

  const team = await createTeam({
    createdBy: uid,
    name: body.name.trim(),
    description,
    avatarSeed: body.avatarSeed.trim(),
    leaderAgentId,
    defaultModeId,
    isTemplate: false,
  })

  if (memberIds.length > 0) {
    await setMembers(team.id, memberIds)
  }

  return NextResponse.json({ team }, { status: 201 })
}
