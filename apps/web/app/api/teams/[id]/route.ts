// ============================================================
// GET    /api/teams/[id]   — team + members (anyone reads templates + own)
// PATCH  /api/teams/[id]   — update (owner only, not templates)
// DELETE /api/teams/[id]   — delete (owner only; cascades team_members)
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import {
  deleteTeam,
  getTeam,
  getTeamWithMembers,
  updateTeam,
  type UpdateTeamArgs,
} from '../../../lib/team-store'
import { getUserIdFromRequest } from '../../../lib/user-id'

export const dynamic = 'force-dynamic'

interface RouteCtx {
  params: Promise<{ id: string }>
}

const VALID_MODES = ['open-chat', 'roundtable', 'werewolf'] as const

// ── GET ────────────────────────────────────────────────────

export async function GET(_request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const data = await getTeamWithMembers(id)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

// ── PATCH ──────────────────────────────────────────────────

export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const uid = getUserIdFromRequest(request)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await getTeam(id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.isTemplate) {
    return NextResponse.json({ error: 'Templates are read-only' }, { status: 403 })
  }
  if (existing.createdBy !== uid) {
    return NextResponse.json({ error: 'Not owner' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const patch: UpdateTeamArgs = {}

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > 100) {
      return NextResponse.json({ error: 'name invalid' }, { status: 400 })
    }
    patch.name = body.name.trim()
  }
  if (body.description !== undefined) {
    if (body.description === null) {
      patch.description = null
    } else if (typeof body.description === 'string' && body.description.length <= 2000) {
      patch.description = body.description.length > 0 ? body.description : null
    } else {
      return NextResponse.json({ error: 'description invalid' }, { status: 400 })
    }
  }
  if (body.avatarSeed !== undefined) {
    if (typeof body.avatarSeed !== 'string' || body.avatarSeed.trim().length === 0) {
      return NextResponse.json({ error: 'avatarSeed invalid' }, { status: 400 })
    }
    patch.avatarSeed = body.avatarSeed.trim()
  }
  if (body.leaderAgentId !== undefined) {
    if (body.leaderAgentId === null) {
      patch.leaderAgentId = null
    } else if (typeof body.leaderAgentId === 'string') {
      patch.leaderAgentId = body.leaderAgentId
    } else {
      return NextResponse.json({ error: 'leaderAgentId invalid' }, { status: 400 })
    }
  }
  if (body.defaultModeId !== undefined) {
    if (body.defaultModeId === null) {
      patch.defaultModeId = null
    } else if (
      typeof body.defaultModeId === 'string' &&
      VALID_MODES.includes(body.defaultModeId as (typeof VALID_MODES)[number])
    ) {
      patch.defaultModeId = body.defaultModeId
    } else {
      return NextResponse.json(
        { error: `defaultModeId must be one of ${VALID_MODES.join(', ')}` },
        { status: 400 },
      )
    }
  }

  const updated = await updateTeam(id, patch)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ team: updated })
}

// ── DELETE ─────────────────────────────────────────────────

export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const uid = getUserIdFromRequest(request)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await getTeam(id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.isTemplate) {
    return NextResponse.json({ error: 'Templates are read-only' }, { status: 403 })
  }
  if (existing.createdBy !== uid) {
    return NextResponse.json({ error: 'Not owner' }, { status: 403 })
  }

  const ok = await deleteTeam(id)
  return NextResponse.json({ deleted: ok })
}
