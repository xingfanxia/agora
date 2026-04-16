// ============================================================
// Agent store — Postgres-backed CRUD for reusable agent personas
// ============================================================
//
// Agents are reusable AI personas owned by a user (via localStorage
// UID in V1, Supabase Auth in 4.5d). Templates are system-owned rows
// with `is_template = true` and `created_by = null`, readable by all.
//
// DO NOT enforce ownership here — that's the API route's job.
// This layer is pure data access; the caller decides who can write.

import { agents, getDb, type AgentRow, type NewAgentRow } from '@agora/db'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

const db = new Proxy({} as ReturnType<typeof getDb>, {
  get(_target, prop) {
    const instance = getDb() as unknown as Record<string | symbol, unknown>
    const value = instance[prop]
    return typeof value === 'function' ? (value as Function).bind(instance) : value
  },
})

// ── Types ──────────────────────────────────────────────────

export interface AgentStyle {
  maxTokens?: number
  language?: 'en' | 'zh'
  [extra: string]: unknown
}

export interface CreateAgentArgs {
  id?: string
  createdBy: string | null
  name: string
  persona: string
  systemPrompt?: string | null
  modelProvider: string
  modelId: string
  style?: AgentStyle
  avatarSeed: string
  isTemplate?: boolean
}

export interface UpdateAgentArgs {
  name?: string
  persona?: string
  systemPrompt?: string | null
  modelProvider?: string
  modelId?: string
  style?: AgentStyle
  avatarSeed?: string
}

export interface ListAgentsFilter {
  createdBy?: string | null
  isTemplate?: boolean
  limit?: number
}

// ── Create ─────────────────────────────────────────────────

export async function createAgent(args: CreateAgentArgs): Promise<AgentRow> {
  const row: NewAgentRow = {
    createdBy: args.createdBy,
    name: args.name,
    persona: args.persona,
    systemPrompt: args.systemPrompt ?? null,
    modelProvider: args.modelProvider,
    modelId: args.modelId,
    style: (args.style ?? {}) as object,
    avatarSeed: args.avatarSeed,
    isTemplate: args.isTemplate ?? false,
  }
  if (args.id) row.id = args.id
  const [inserted] = await db.insert(agents).values(row).returning()
  return inserted!
}

// ── Read ───────────────────────────────────────────────────

export async function getAgent(id: string): Promise<AgentRow | null> {
  const [row] = await db.select().from(agents).where(eq(agents.id, id)).limit(1)
  return row ?? null
}

export async function getAgents(ids: readonly string[]): Promise<AgentRow[]> {
  if (ids.length === 0) return []
  return db.select().from(agents).where(inArray(agents.id, ids as string[]))
}

export async function listAgents(filter: ListAgentsFilter = {}): Promise<AgentRow[]> {
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500)
  const clauses = []
  if (filter.createdBy !== undefined) {
    clauses.push(
      filter.createdBy === null
        ? sql`${agents.createdBy} IS NULL`
        : eq(agents.createdBy, filter.createdBy),
    )
  }
  if (filter.isTemplate !== undefined) {
    clauses.push(eq(agents.isTemplate, filter.isTemplate))
  }
  const where = clauses.length ? and(...clauses) : undefined
  const query = db.select().from(agents)
  const scoped = where ? query.where(where) : query
  return scoped.orderBy(desc(agents.createdAt)).limit(limit)
}

// ── Update ─────────────────────────────────────────────────

export async function updateAgent(
  id: string,
  patch: UpdateAgentArgs,
): Promise<AgentRow | null> {
  const updates: Partial<NewAgentRow> = { updatedAt: new Date() }
  if (patch.name !== undefined) updates.name = patch.name
  if (patch.persona !== undefined) updates.persona = patch.persona
  if (patch.systemPrompt !== undefined) updates.systemPrompt = patch.systemPrompt
  if (patch.modelProvider !== undefined) updates.modelProvider = patch.modelProvider
  if (patch.modelId !== undefined) updates.modelId = patch.modelId
  if (patch.style !== undefined) updates.style = patch.style as object
  if (patch.avatarSeed !== undefined) updates.avatarSeed = patch.avatarSeed

  const [updated] = await db
    .update(agents)
    .set(updates)
    .where(eq(agents.id, id))
    .returning()
  return updated ?? null
}

// ── Delete ─────────────────────────────────────────────────

export async function deleteAgent(id: string): Promise<boolean> {
  const deleted = await db.delete(agents).where(eq(agents.id, id)).returning({ id: agents.id })
  return deleted.length > 0
}
