// ============================================================
// DELETE /api/teams/[id]/members/[agentId]  — remove one member
// ============================================================
//
// Reorder + set-leader live on PUT /members and PATCH /teams/[id]
// respectively; this endpoint is only for single-member removal.

import { NextResponse, type NextRequest } from 'next/server'
import { getTeam, removeMember, updateTeam } from '../../../../../lib/team-store'
import { requireAuthUserId } from '../../../../../lib/auth'

export const dynamic = 'force-dynamic'

interface RouteCtx {
  params: Promise<{ id: string; agentId: string }>
}

export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  const { id, agentId } = await ctx.params
  const auth = await requireAuthUserId()
  if (!auth.ok) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  const uid = auth.id

  const team = await getTeam(id)
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (team.isTemplate) {
    return NextResponse.json({ error: 'Templates are read-only' }, { status: 403 })
  }
  if (team.createdBy !== uid) {
    return NextResponse.json({ error: 'Not owner' }, { status: 403 })
  }

  // If removing the leader, null out the team's leader field too.
  if (team.leaderAgentId === agentId) {
    await updateTeam(id, { leaderAgentId: null })
  }

  const ok = await removeMember(id, agentId)
  if (!ok) return NextResponse.json({ error: 'member not found' }, { status: 404 })
  return NextResponse.json({ deleted: true })
}
