// ============================================================
// Agora DB — Schema (agents + teams + rooms + events)
// ============================================================
//
// Phase 6 Team Platform adds `agents`, `teams`, `team_members` as
// first-class entities. Prior tables kept unchanged aside from two
// additive columns on `rooms` (team_id + mode_config).
//
// - `agents`: reusable AI personas (name, persona text, model, style,
//   avatar seed). Scoped by `created_by` (localStorage UID for V1,
//   Supabase Auth user id once 4.5d lands). `is_template=true` rows
//   are ship-with starters visible to everyone.
// - `teams`: named compositions of agents with optional leader.
// - `team_members`: join table with display-order position.
// - `rooms`: denormalized snapshot of each Room's current state.
//   team_id now optionally links back to the composing team.
// - `events`: append-only log of every PlatformEvent.
//
// Single file to sidestep drizzle-kit's CJS loader not handling
// NodeNext `.js` imports during `db:generate`.

import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

// ── agents ─────────────────────────────────────────────────

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Ownership — localStorage UID now, Supabase Auth user id later (4.5d).
    // Null means system-owned (ship-with template seeds).
    createdBy: text('created_by'),

    // Identity
    name: text('name').notNull(),
    persona: text('persona').notNull(),      // ~200-word personality/voice
    systemPrompt: text('system_prompt'),     // optional override; if null, built from persona

    // LLM binding
    modelProvider: text('model_provider').notNull(),
    modelId: text('model_id').notNull(),
    style: jsonb('style').notNull().default({}),  // { temperature, maxTokens, language, ... }

    // Visual
    avatarSeed: text('avatar_seed').notNull(),    // DiceBear pixel-art seed (stable)

    // Catalog flag — true = ship-with starter, false = user-created
    isTemplate: boolean('is_template').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Partial indexes keep the "my agents" and "template gallery" queries fast
    // without polluting an all-rows index.
    index('agents_created_by_idx').on(table.createdBy),
    index('agents_template_idx').on(table.isTemplate),
  ],
)

export type AgentRow = typeof agents.$inferSelect
export type NewAgentRow = typeof agents.$inferInsert

// ── teams ──────────────────────────────────────────────────

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdBy: text('created_by'),

    name: text('name').notNull(),
    description: text('description'),
    avatarSeed: text('avatar_seed').notNull(),

    // Optional — if set, team has a designated leader. V1 appends the
    // "dispatch discipline" prompt block (§17.3) to this agent's
    // system prompt at room creation.
    leaderAgentId: uuid('leader_agent_id').references(() => agents.id, { onDelete: 'set null' }),

    // Default mode when starting a room from this team's "+ 开始对话"
    // button. Users can override in the room creator. Null = user must pick.
    defaultModeId: text('default_mode_id'),

    isTemplate: boolean('is_template').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('teams_created_by_idx').on(table.createdBy),
    index('teams_template_idx').on(table.isTemplate),
  ],
)

export type TeamRow = typeof teams.$inferSelect
export type NewTeamRow = typeof teams.$inferInsert

// ── team_members ───────────────────────────────────────────

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),     // display order within the team
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.agentId] }),
    // Reverse lookup: "which teams is this agent in?" (for cascade preview,
    // agent deletion confirmation, etc.)
    index('team_members_agent_idx').on(table.agentId),
  ],
)

export type TeamMemberRow = typeof teamMembers.$inferSelect
export type NewTeamMemberRow = typeof teamMembers.$inferInsert

// ── rooms ──────────────────────────────────────────────────

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Identity
    modeId: text('mode_id').notNull(), // 'roundtable' | 'werewolf' | 'open-chat' | ...
    topic: text('topic'),

    // Team that composed this room (Phase 6). Nullable — legacy ad-hoc
    // rooms (from /create + /create-werewolf fast-paths) have null.
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),

    // Mode-specific configuration (rounds, advanced rules, turn count, etc.)
    // Replaces ad-hoc keys that used to live inside `config`.
    modeConfig: jsonb('mode_config'),

    // Raw creation config (agent definitions, rules, etc.)
    config: jsonb('config').notNull(),

    // Lifecycle
    status: text('status').notNull(), // 'running' | 'completed' | 'error'
    currentPhase: text('current_phase'),
    currentRound: integer('current_round').default(1).notNull(),
    thinkingAgentId: text('thinking_agent_id'),

    // Denormalized, fast-read fields (projected from events)
    agents: jsonb('agents').notNull().default([]), // AgentInfo[]
    roleAssignments: jsonb('role_assignments'),    // werewolf: agentId → role
    advancedRules: jsonb('advanced_rules'),        // werewolf toggles
    gameState: jsonb('game_state'),                // werewolf custom state snapshot

    // Aggregates
    totalCost: doublePrecision('total_cost').default(0).notNull(),
    totalTokens: integer('total_tokens').default(0).notNull(),
    callCount: integer('call_count').default(0).notNull(),
    messageCount: integer('message_count').default(0).notNull(),

    // Errors
    errorMessage: text('error_message'),

    // Durable runtime state (Phase 4.5a).
    // When status='waiting', `waitingFor` holds the predicate the room is
    // paused on ({ eventName, match }) and `waitingUntil` the wall-clock
    // deadline after which fallback logic fires.
    waitingFor: jsonb('waiting_for'),
    waitingUntil: timestamp('waiting_until', { withTimezone: true }),

    // Per-room runtime flag (Phase 4.5d-2). 'http_chain' = legacy
    // advanceRoom + chained ticks; 'wdk' = Vercel Workflow DevKit
    // orchestrator. Set at room creation, never mutated mid-game.
    // Default 'http_chain' until WDK substrate ships in 4.5d-2.
    runtime: text('runtime').notNull().default('http_chain'),

    // Provenance (future-proof for auth)
    createdBy: text('created_by'), // user id when auth lands; nullable for now

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('rooms_status_created_idx').on(table.status, table.createdAt),
    index('rooms_mode_id_idx').on(table.modeId),
    index('rooms_created_by_idx').on(table.createdBy),
    index('rooms_team_id_idx').on(table.teamId),
  ],
)

export type RoomRow = typeof rooms.$inferSelect
export type NewRoomRow = typeof rooms.$inferInsert

// ── allowed_emails (Phase 4.5d) ────────────────────────────
//
// Signup gate. The magic-link /login form always accepts any email
// and sends the link. The /auth/callback checks `allowed_emails`
// when exchanging the code; if the email isn't in the list we sign
// the user out and redirect to a "request access" page.
//
// Writes are service-role only (no RLS SELECT policy for authed
// users — a member shouldn't be able to enumerate other members).

export const allowedEmails = pgTable(
  'allowed_emails',
  {
    email: text('email').primaryKey(), // always stored lower-cased
    invitedBy: uuid('invited_by'),     // auth.users.id of the inviter, nullable for seeds
    note: text('note'),                // free-form context ("friend from twitter")
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
)

export type AllowedEmailRow = typeof allowedEmails.$inferSelect
export type NewAllowedEmailRow = typeof allowedEmails.$inferInsert

// ── seat_presence (Phase 4.5d-1) ───────────────────────────
//
// Postgres-backed liveness signal for human seats. Updated on each
// client heartbeat (debounced ~5s). Read from WDK step bodies in
// 4.5d-2 to decide vote-fallback-vs-wait without introducing a
// Realtime side effect into durable workflow steps (per the
// durability contract in docs/design/phase-4.5d-plan.md §4.5d-2.1).
//
// Realtime is still used for client-side UX (peer awareness,
// typing indicators) but Postgres is the source of truth for
// "is this seat connected".
//
// Multi-tab semantics: presence is keyed on (room_id, agent_id),
// not connection. Multiple tabs of the same seat → "connected"
// if ANY tab heartbeated within the grace window (default 30s).
//
// No RLS — service-role-only writes via the heartbeat API route.

export const seatPresence = pgTable(
  'seat_presence',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    // Agent ID matching seat-tokens.ts JWT payload. NOT FK'd to
    // agents table because room snapshots may include synthetic
    // HumanAgent IDs that don't have a corresponding agents row.
    agentId: uuid('agent_id').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.roomId, table.agentId] })],
)

export type SeatPresenceRow = typeof seatPresence.$inferSelect
export type NewSeatPresenceRow = typeof seatPresence.$inferInsert

// ── events ─────────────────────────────────────────────────

export const events = pgTable(
  'events',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),     // 'message:created' | 'token:recorded' | ...
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.seq] }),
    index('events_room_type_idx').on(table.roomId, table.type),
  ],
)

export type EventRow = typeof events.$inferSelect
export type NewEventRow = typeof events.$inferInsert
