# Phase 4 — Persistence Foundation + Replay

> **Date**: 2026-04-14
> **Status**: APPROVED — user signed off 2026-04-14
> **Triggered by**: realization that DB isn't only for replay; the current `globalThis` room-store breaks on Vercel multi-instance hosting and is foundational for every remaining phase.
>
> **Resolved decisions** (user sign-off):
> - Auth: **public-by-UUID**. `created_by` column nullable for now, becomes `NOT NULL` when auth lands.
> - Read model: **DB-only reads**. In-memory for runtime orchestration (EventBus, Flow, Accountant); Postgres is the only source for external polls.
> - Replay UX: **animated playback** with play/pause, speed control (0.5x / 1x / 2x / 5x / instant), scrubber, event counter, time indicator.
> - In-flight games during deploy: **mark as error**.
> - Shape: **single PR** covering 4.1–4.6.
> - Plan: **Vercel Pro** (300s function timeout = fits current games).

---

## 1. Where We Are Now

**What works (Phases 1–3 ✅):**
- TS monorepo: `@agora/{shared, llm, core, modes, web}` — clean layering, type-safe.
- Two playable modes: roundtable debate, werewolf (with 4 togglable advanced rules).
- Live token cost tracking via LiteLLM pricing.
- Frontend: mode-dispatched views, channel tabs, observability timeline.
- Vercel project created (`panpanmao/agora`), GitHub repo connected, Supabase + LLM env vars wired.

**What lives only in memory:**
- All `RoomState` (messages, events, agents, role assignments, current phase, gameState, status).
- The `EventBus`, `Room`, `StateMachineFlow`, `AIAgent.history`, and `TokenAccountant` instances per room.
- Source: `apps/web/app/lib/room-store.ts` keeps a `Map<roomId, RoomState>` on `globalThis`.

**What breaks on Vercel (pre-Phase-4):**
1. **Multi-instance state isolation.** Each function invocation can land on a different lambda. POST creates room on Lambda A; GET polls Lambda B → "room not found." Today's pattern only works in `next dev` because that's a single Node process.
2. **Background work after response dies.** The current code returns the roomId and runs `room.start(flow)` in the background. On Vercel the function ends when the response is sent → game halts mid-turn.
3. **Cold starts erase state.** Even within one warm instance, ~5 min idle kills the process.

---

## 2. Constraints From Future Phases

DB work isn't only "for replay" — every remaining phase needs it.

| Phase | What DB needs to provide |
|-------|--------------------------|
| **Replay** (next deliverable) | Full event log per room, queryable by index/timestamp |
| **Script Kill** (originally Phase 4) | pgvector for agent long-term memory + clue persistence + cross-room state |
| **TRPG** (originally Phase 5) | Persistent characters across sessions + GM world state |
| **Platform** (originally Phase 6) | 100+ concurrent rooms, custom mode definitions, agent marketplace, replay export |
| **Eventually**: auth | per-user room ownership, session-scoped reads |

PRD already mandates:
- Stateless API layer on Vercel (5.5)
- Supabase Postgres with Supavisor pooling (5.5)
- 10 concurrent rooms (Phase 4 PRD acceptance), scaling to 100+ (Phase 6)

So the real Phase 4 unblocks all four future phases — not just replay.

---

## 3. Architecture Decisions

### 3.1 DB as single source for external reads

**Clear split:**
- **In-memory** (per-lambda, ephemeral): `EventBus`, `Room`, `StateMachineFlow`, `AIAgent`, `TokenAccountant`. These are the live runtime objects — they can't serialize cleanly and only the lambda running the game needs them.
- **Postgres** (durable, shared): every event ever emitted, denormalized room snapshot, hot aggregates (total_cost, total_tokens, call_count, message_count).
- **External API reads** always query Postgres. No in-memory read cache. This eliminates cache coherence bugs and makes multi-instance hosting trivially correct.

**How sync works:**
A single EventBus listener persists every event to the `events` table as it happens. Hot aggregates on the `rooms` row get incremented via `UPDATE rooms SET ... WHERE id = ?` (idempotent through the primary-key + seq constraint on the event write). Per-agent / per-model rollups are computed from the `events` table on demand.

### 3.2 Game runtime stays in the API function

We use Vercel's `waitUntil()` to extend the lifetime of background work past the response. Acceptable bounds:
- **Hobby**: 60s function timeout — werewolf games will fail.
- **Pro**: 300s (5 min) — most games we ran completed in 3-5 min, right at the edge.
- **Enterprise**: 900s (15 min) — comfortable for everything we have.

For an MVP demo, **target Pro** and accept the cliff. If we hit it in practice, escalate to a worker tier (option C from prior discussion) — but don't pre-build it.

**Why not ticks-on-cron from the start?**
Each "tick = one function invocation" is the bulletproof scaling pattern but a heavy refactor of the state machine. Premature for the MVP.

### 3.3 Two database connections

Supabase gives us two URLs:
- `POSTGRES_URL` — pooled (Supavisor port 6543) — for Functions (short-lived).
- `POSTGRES_URL_NON_POOLING` — direct (port 5432) — for migrations.

Mixing these up causes connection storms. The db package will export both clients; routes use pooled, migrations use direct.

### 3.4 Drizzle for the ORM

Already discussed. TS-first, no codegen, matches our "thin abstractions" style.

### 3.5 Schema shape: events as the source

The `events` table is append-only and is the source of truth for:
- Messages (carried inside `message:created` events)
- Token usage (carried inside `token:recorded` events)
- Phase transitions (carried inside `phase:changed` events)
- Lifecycle (room:started, room:ended)

The `rooms` table holds the current state snapshot for fast reads — denormalized projection of the event log. Updated via write-through on each emit.

**Why not tables for each event type?**
1. Future-proof — new modes add new event types without schema migrations.
2. Replay is trivially "stream events back in order."
3. Matches the existing in-memory shape.

We'll add a `messages` view (or materialized view) later if message-only queries become hot. For v1, JSONB indexes are enough.

### 3.6 What goes in JSONB vs columns

- **Columns**: things we filter/sort by (`mode_id`, `status`, `created_at`, `ended_at`, `total_cost`, `total_tokens`).
- **JSONB**: things we read whole (`config`, `payload`).

This balances query perf with future flexibility.

---

## 4. Schema (concrete)

```sql
CREATE TABLE rooms (
  id              UUID PRIMARY KEY,
  mode_id         TEXT NOT NULL,                   -- 'roundtable' | 'werewolf'
  topic           TEXT,
  config          JSONB NOT NULL,                  -- agents, advancedRules, mode-specific
  status          TEXT NOT NULL,                   -- 'running' | 'completed' | 'error'
  current_phase   TEXT,
  current_round   INTEGER DEFAULT 1,
  agents          JSONB NOT NULL DEFAULT '[]',     -- AgentInfo[]
  role_assignments JSONB,                          -- werewolf only
  game_state      JSONB,                           -- werewolf gameState snapshot
  total_cost      DOUBLE PRECISION DEFAULT 0,
  total_tokens    INTEGER DEFAULT 0,
  call_count      INTEGER DEFAULT 0,
  message_count   INTEGER DEFAULT 0,
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ
);

CREATE INDEX rooms_status_created ON rooms(status, created_at DESC);
CREATE INDEX rooms_mode_id ON rooms(mode_id);

CREATE TABLE events (
  room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,                -- monotonic per room
  type            TEXT NOT NULL,
  payload         JSONB NOT NULL,
  occurred_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (room_id, seq)
);

CREATE INDEX events_room_seq ON events(room_id, seq);
CREATE INDEX events_room_type ON events(room_id, type);
```

Future:
- `agent_memory` (Phase 5, Script Kill) — pgvector embeddings
- `clues` (Phase 5) — clue distribution with visibility
- `characters` (Phase 6, TRPG) — persistent character sheets
- `users` + `room_owners` — when auth lands
- `mode_definitions` + `personas` (Phase 8, Platform marketplace)

Schema design choice: room-scoped `seq` (not global) keeps replay queries fast (`WHERE room_id = X ORDER BY seq`).

---

## 5. Phase Renumbering

Original numbering put Script Kill as Phase 4. That now needs to slide back because persistence is its prerequisite. Proposed:

| # | Name | Status | Notes |
|---|------|--------|-------|
| 1 | Roundtable MVP | ✅ | shipped |
| 2 | Werewolf (a + b) | ✅ | shipped |
| 3 | Frontend + Observability + Token Tracking | ✅ | shipped |
| **4** | **Persistence Foundation + Replay** | **NEW** | this plan |
| 5 | Script Kill (was P4) | bumped | needs pgvector from P4 |
| 6 | TRPG (was P5) | bumped | needs P4 + P5 patterns |
| 7 | Platform (was P6) | bumped | needs all of above |

Auth could land between 4 and 5 if needed for shared replay links — TBD.

---

## 6. Phase 4 Scope

Six work units, in dependency order:

### 4.1 — `packages/db` workspace
- New package with Drizzle + `pg` driver + `dotenv`
- Two clients: pooled (runtime), direct (migrations)
- Drizzle config + `drizzle-kit` for schema → migration
- `db.ts` exports — single point of import for everything else

### 4.2 — Schema + first migration
- `schema/rooms.ts`, `schema/events.ts` (Drizzle TS schema)
- `pnpm db:generate` → SQL migration committed to repo
- `pnpm db:migrate` → applies to Supabase
- Smoke test: connect, insert sample room, read it back

### 4.3 — DB-backed room-store
- `apps/web/app/lib/room-store.ts` splits into two modules:
  - `runtime-registry.ts` — `Map<roomId, { eventBus, room, flow, accountant }>` (ephemeral in-memory runtime only)
  - `room-store.ts` — all reads hit Postgres; `saveRoom`, `appendEvent`, `updateRoomSnapshot` for the runtime lambda to persist its state
- Single EventBus listener in the room-creation path writes every event to the `events` table and keeps `rooms` hot columns in sync
- On `room:ended`: runtime registry entry deleted, final snapshot saved to DB

### 4.4 — Vercel runtime fix
- API routes wrap `room.start(flow)` in `waitUntil()` from `@vercel/functions`
- Document the 5min timeout as a known limit
- Local dev keeps current behavior (single-process, fire-and-forget works)

### 4.5 — Replay routes
- `GET /api/rooms` — list of completed rooms (filter by mode, pagination)
- `GET /api/rooms/[id]` — single room snapshot from DB
- `/replays` page — grid of completed games with mode badge, agents, duration, cost, final result
- `/replay/[id]` page — **animated playback** with:
  - Play / pause button
  - Speed control: 0.5x / 1x / 2x / 5x / instant
  - Scrubber with progress bar (click to jump to position)
  - Event counter ("42 / 127") + clock ("02:34 / 05:12")
- Underlying mechanics:
  - Virtual clock that advances from the first event's timestamp to the current playback position
  - Events rendered when `eventTimestamp <= virtualClock`
  - `useReplayPlayback(events, speed)` hook returns `{ visibleEvents, progress, play, pause, seek, setSpeed }`
- Reuse `RoundtableView` / `WerewolfView` unchanged — they take `messages` + `snapshot` as props, replay page just computes these from the sliced event stream

### 4.6 — Validate + deploy
- Local: run debate + werewolf, restart `next dev`, verify rooms still readable
- Local: walk through `/replays` → `/replay/[id]` → playback works
- Push to GitHub → Vercel auto-deploys → smoke test on the preview URL
- Update README + docs/architecture.md §11-13 to reflect the new architecture

---

## 7. Tradeoffs Accepted

| Choice | Tradeoff |
|--------|----------|
| DB-only external reads (+ in-memory runtime) | ~5ms Supabase roundtrip per poll; no cache coherence bugs |
| `waitUntil` for game runtime | Bounded by 5min on Pro; bigger games need worker tier later |
| Events table as source of truth | JSONB queries less efficient than typed columns; fine at our scale |
| Drizzle (TS-first) | Smaller community than Prisma; matches our codebase style |
| Public-by-UUID replays | Anyone with URL can view; `created_by` column nullable now, NOT NULL when auth lands |
| Animated replay playback | +200 LOC for demo quality; impressive for blog material |
| Mark in-flight games as error on deploy | Simpler than resume logic; acceptable for MVP |

---

## 8. Sequencing

1. **Now**: 4.1 (db package) — ~150 LOC, pure infrastructure
2. **Then**: 4.2 (schema + migration) — ~100 LOC + 1 SQL migration
3. **Then**: 4.3 (write-through room-store) — ~250 LOC, the load-bearing change
4. **Then**: 4.4 (waitUntil) — ~30 LOC, copy-paste from Vercel docs
5. **Then**: 4.5 (replay routes + UI) — ~300-400 LOC
6. **Then**: 4.6 (validate + push) — config + docs

Each step is a clean commit. Validate locally before pushing. Vercel will auto-deploy the preview as soon as we push.

Estimated context budget: ~30-40% of remaining 63%, leaves ~20% headroom for replay UI iteration.

---

## 9. Starting Now

All decisions resolved. Beginning work on 4.1 (packages/db scaffold).
