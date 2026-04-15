// ============================================================
// Team store — Postgres-backed CRUD for agent teams
// ============================================================
//
// Teams are named compositions of agents with optional leader.
// Templates are system-owned rows (`is_template=true`, `created_by=null`).
// Team membership is a join table with display `position`.
//
// Ownership checks happen in the API routes, not here.

import {
  agents,
  getDb,
  teamMembers,
  teams,
  type AgentRow,
  type NewTeamMemberRow,
  type NewTeamRow,
  type TeamMemberRow,
  type TeamRow,
} from '@agora/db'
import { and, asc, desc, eq, sql } from 'drizzle-orm'

const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    const instance = getDb() as unknown as Record<string | symbol, unknown>
    const value = instance[prop]
    return typeof value === 'function' ? (value as Function).bind(instance) : value
  },
})

// ── Types ──────────────────────────────────────────────────

export interface CreateTeamArgs {
  id?: string
  createdBy: string | null
  name: string
  description?: string | null
  avatarSeed: string
  leaderAgentId?: string | null
  defaultModeId?: string | null
  isTemplate?: boolean
}

export interface UpdateTeamArgs {
  name?: string
  description?: string | null
  avatarSeed?: string
  leaderAgentId?: string | null
  defaultModeId?: string | null
}

export interface ListTeamsFilter {
  createdBy?: string | null
  isTemplate?: boolean
  limit?: number
}

export interface TeamWithMembers {
  team: TeamRow
  members: (TeamMemberRow & { agent: AgentRow })[]
}

// ── Team CRUD ──────────────────────────────────────────────

export async function createTeam(args: CreateTeamArgs): Promise<TeamRow> {
  const row: NewTeamRow = {
    createdBy: args.createdBy,
    name: args.name,
    description: args.description ?? null,
    avatarSeed: args.avatarSeed,
    leaderAgentId: args.leaderAgentId ?? null,
    defaultModeId: args.defaultModeId ?? null,
    isTemplate: args.isTemplate ?? false,
  }
  if (args.id) row.id = args.id
  const [inserted] = await db.insert(teams).values(row).returning()
  return inserted!
}

export async function getTeam(id: string): Promise<TeamRow | null> {
  const [row] = await db.select().from(teams).where(eq(teams.id, id)).limit(1)
  return row ?? null
}

export async function listTeams(filter: ListTeamsFilter = {}): Promise<TeamRow[]> {
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500)
  const clauses = []
  if (filter.createdBy !== undefined) {
    clauses.push(
      filter.createdBy === null
        ? sql`${teams.createdBy} IS NULL`
        : eq(teams.createdBy, filter.createdBy),
    )
  }
  if (filter.isTemplate !== undefined) {
    clauses.push(eq(teams.isTemplate, filter.isTemplate))
  }
  const where = clauses.length ? and(...clauses) : undefined
  const query = db.select().from(teams)
  const scoped = where ? query.where(where) : query
  return scoped.orderBy(desc(teams.createdAt)).limit(limit)
}

export async function updateTeam(
  id: string,
  patch: UpdateTeamArgs,
): Promise<TeamRow | null> {
  const updates: Partial<NewTeamRow> = { updatedAt: new Date() }
  if (patch.name !== undefined) updates.name = patch.name
  if (patch.description !== undefined) updates.description = patch.description
  if (patch.avatarSeed !== undefined) updates.avatarSeed = patch.avatarSeed
  if (patch.leaderAgentId !== undefined) updates.leaderAgentId = patch.leaderAgentId
  if (patch.defaultModeId !== undefined) updates.defaultModeId = patch.defaultModeId

  const [updated] = await db.update(teams).set(updates).where(eq(teams.id, id)).returning()
  return updated ?? null
}

export async function deleteTeam(id: string): Promise<boolean> {
  const deleted = await db.delete(teams).where(eq(teams.id, id)).returning({ id: teams.id })
  return deleted.length > 0
}

// ── Membership ─────────────────────────────────────────────

export async function getMembers(teamId: string): Promise<(TeamMemberRow & { agent: AgentRow })[]> {
  const rows = await db
    .select({
      teamId: teamMembers.teamId,
      agentId: teamMembers.agentId,
      position: teamMembers.position,
      createdAt: teamMembers.createdAt,
      agent: agents,
    })
    .from(teamMembers)
    .innerJoin(agents, eq(agents.id, teamMembers.agentId))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(teamMembers.position))
  return rows
}

export async function getTeamWithMembers(id: string): Promise<TeamWithMembers | null> {
  const team = await getTeam(id)
  if (!team) return null
  const members = await getMembers(id)
  return { team, members }
}

/**
 * Add an agent to a team. `position` defaults to end-of-list. No-op
 * (ON CONFLICT DO NOTHING) if the agent is already a member.
 */
export async function addMember(
  teamId: string,
  agentId: string,
  position?: number,
): Promise<TeamMemberRow | null> {
  const pos = position ?? (await nextPosition(teamId))
  const row: NewTeamMemberRow = { teamId, agentId, position: pos }
  const inserted = await db
    .insert(teamMembers)
    .values(row)
    .onConflictDoNothing({ target: [teamMembers.teamId, teamMembers.agentId] })
    .returning()
  return inserted[0] ?? null
}

export async function removeMember(teamId: string, agentId: string): Promise<boolean> {
  const deleted = await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.agentId, agentId)))
    .returning({ agentId: teamMembers.agentId })
  return deleted.length > 0
}

export async function reorderMembers(
  teamId: string,
  orderedAgentIds: readonly string[],
): Promise<void> {
  // Reassign position by index. Wrap in a transaction so partial failures
  // don't leave the team half-reordered.
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedAgentIds.length; i++) {
      await tx
        .update(teamMembers)
        .set({ position: i })
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.agentId, orderedAgentIds[i]!),
          ),
        )
    }
  })
}

/** Replace team roster with a new ordered list. Used by the composer save path. */
export async function setMembers(
  teamId: string,
  orderedAgentIds: readonly string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(teamMembers).where(eq(teamMembers.teamId, teamId))
    if (orderedAgentIds.length === 0) return
    const rows: NewTeamMemberRow[] = orderedAgentIds.map((agentId, i) => ({
      teamId,
      agentId,
      position: i,
    }))
    await tx.insert(teamMembers).values(rows)
  })
}

async function nextPosition(teamId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${teamMembers.position})` })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId))
  return (row?.max ?? -1) + 1
}
