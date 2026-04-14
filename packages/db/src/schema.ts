// ============================================================
// Agora DB — Schema (rooms + events)
// ============================================================
//
// Two tables:
// - `rooms`: denormalized snapshot of each Room's current state.
//   Source of truth is the event log, but this row is the fast-read
//   projection for the UI polling path.
// - `events`: append-only log of every PlatformEvent emitted during
//   a room's lifetime. Source of truth for replay.
//
// Single file to sidestep drizzle-kit's CJS loader not handling
// NodeNext `.js` imports during `db:generate`.

import {
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

// ── rooms ──────────────────────────────────────────────────

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Identity
    modeId: text('mode_id').notNull(), // 'roundtable' | 'werewolf' | ...
    topic: text('topic'),

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

    // Provenance (future-proof for auth)
    createdBy: text('created_by'), // user id when auth lands; nullable for now

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [
    index('rooms_status_created_idx').on(table.status, table.createdAt),
    index('rooms_mode_id_idx').on(table.modeId),
    index('rooms_created_by_idx').on(table.createdBy),
  ],
)

export type RoomRow = typeof rooms.$inferSelect
export type NewRoomRow = typeof rooms.$inferInsert

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
