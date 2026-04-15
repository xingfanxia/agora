// ============================================================
// GET  /api/teams/[id]/members          — list members with agent details
// POST /api/teams/[id]/members          — add one member { agentId, position? }
// PUT  /api/teams/[id]/members          — replace whole roster { orderedAgentIds }
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { getAgents } from '../../../../lib/agent-store'
import {
  addMember,
  getMembers,
  getTeam,
  setMembers,
  updateTeam,
} from '../../../../lib/team-store'
import { getUserIdFromRequest } from '../../../../lib/user-id'

export const dynamic = 'force-dynamic'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// ── GET ────────────────────────────────────────────────────

export async function GET(_request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const team = await getTeam(id)
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const members = await getMembers(id)
  return NextResponse.json({ members })
}

// ── POST ───────────────────────────────────────────────────

export async function POST(request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const uid = getUserIdFromRequest(request)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const team = await getTeam(id)
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (team.isTemplate) {
    return NextResponse.json({ error: 'Templates are read-only' }, { status: 403 })
  }
  if (team.createdBy !== uid) {
    return NextResponse.json({ error: 'Not owner' }, { status: 403 })
  }

  let body: { agentId?: unknown; position?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body.agentId !== 'string') {
    return NextResponse.json({ error: 'agentId required' }, { status: 400 })
  }
  let position: number | undefined
  if (body.position !== undefined) {
    if (typeof body.position !== 'number' || !Number.isInteger(body.position) || body.position < 0) {
      return NextResponse.json({ error: 'position must be a non-negative integer' }, { status: 400 })
    }
    position = body.position
  }

  // Current member count — enforce max 12.
  const current = await getMembers(id)
  if (current.length >= 12) {
    return NextResponse.json({ error: 'team is full (max 12)' }, { status: 400 })
  }

  // Confirm the agent is accessible to the caller (own or template).
  const [agent] = await getAgents([body.agentId])
  if (!agent) return NextResponse.json({ error: 'agent not found' }, { status: 404 })
  if (!agent.isTemplate && agent.createdBy !== uid) {
    return NextResponse.json({ error: 'not authorized to use this agent' }, { status: 403 })
  }

  const row = await addMember(id, body.agentId, position)
  if (!row) return NextResponse.json({ error: 'agent already a member' }, { status: 409 })
  return NextResponse.json({ member: row }, { status: 201 })
}

// ── PUT (replace/reorder entire roster) ────────────────────

export async function PUT(request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const uid = getUserIdFromRequest(request)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const team = await getTeam(id)
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (team.isTemplate) {
    return NextResponse.json({ error: 'Templates are read-only' }, { status: 403 })
  }
  if (team.createdBy !== uid) {
    return NextResponse.json({ error: 'Not owner' }, { status: 403 })
  }

  let body: { orderedAgentIds?: unknown; leaderAgentId?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (
    !Array.isArray(body.orderedAgentIds) ||
    !body.orderedAgentIds.every((x) => typeof x === 'string')
  ) {
    return NextResponse.json({ error: 'orderedAgentIds must be an array of strings' }, { status: 400 })
  }
  const ids = body.orderedAgentIds as string[]
  if (ids.length > 12) {
    return NextResponse.json({ error: 'max 12 members per team' }, { status: 400 })
  }
  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: 'duplicate agent ids' }, { status: 400 })
  }

  // Validate access on every id.
  if (ids.length > 0) {
    const agents = await getAgents(ids)
    const missing = ids.filter((x) => !agents.find((a) => a.id === x))
    if (missing.length) {
      return NextResponse.json({ error: `unknown agents: ${missing.join(', ')}` }, { status: 400 })
    }
    for (const agent of agents) {
      if (!agent.isTemplate && agent.createdBy !== uid) {
        return NextResponse.json({ error: `not authorized to use agent ${agent.id}` }, { status: 403 })
      }
    }
  }

  await setMembers(id, ids)

  // Optional leader update in the same call.
  if (body.leaderAgentId !== undefined) {
    if (body.leaderAgentId === null) {
      await updateTeam(id, { leaderAgentId: null })
    } else if (typeof body.leaderAgentId === 'string') {
      if (!ids.includes(body.leaderAgentId)) {
        return NextResponse.json({ error: 'leaderAgentId must be a member' }, { status: 400 })
      }
      await updateTeam(id, { leaderAgentId: body.leaderAgentId })
    } else {
      return NextResponse.json({ error: 'leaderAgentId invalid' }, { status: 400 })
    }
  }

  const members = await getMembers(id)
  return NextResponse.json({ members })
}
