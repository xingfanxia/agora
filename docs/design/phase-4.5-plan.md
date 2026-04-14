# Phase 4.5 — Durable Runtime + Human-in-the-Loop (V2)

> **Date**: 2026-04-14
> **Status**: V2 — signed off after V1 self-critique
> **Triggers**:
> 1. 3 of 6 zh seed werewolf games orphaned at Vercel's 5-min function wall. Need durable runtime.
> 2. Long-term goal: rooms with N humans + N AI agents. Need agent abstraction + human input primitives.
>
> **V2 changes from V1**:
> - Cut scope: no generic `packages/workflow`. Bespoke ~500 LOC runtime inside `apps/web`.
> - Reorder: 4.5a (AI-only runtime) ships, then **Phase 5 UI overhaul ships before human-in-the-loop**. User sees beautiful UI 2 weeks earlier.
> - Seat tokens for human MVP, not Supabase Auth (magic-link email is unreliable for zh users; Auth arrives in 4.5d as a layer).
> - Add design-only phase 4.5b for human-play UX before writing any human-input code.
> - TDD for replay determinism. Observability budgeted.
> - Dispatcher latency addressed: inline self-invoke after each phase, pg_cron as safety net.

---

## 1. Resolved decisions (V2)

| # | Question | Answer |
|---|----------|--------|
| 1 | Runtime abstraction | **Bespoke, not generic.** ~500 LOC `advanceRoom(roomId)` helper inside `apps/web/app/lib/room-runtime.ts`. No `step.run` primitives, no `packages/workflow`. Event sourcing (existing `events` table) IS the step log. |
| 2 | Dispatcher | `/api/rooms/tick` invoked by pg_cron every 5s as safety net AND inline self-invoked after each phase transition for low AI-only latency. |
| 3 | Determinism | Refactor `createWerewolf` to accept pre-generated agent IDs + a seed for role assignment. Move `crypto.randomUUID()` and `shuffleArray` under a deterministic seed derived from roomId. |
| 4 | Realtime | Supabase Realtime on `events` table (by room_id). Replaces 1-2s polling for interactive views. Keep polling for replays. |
| 5 | Auth — MVP | **Seat tokens only.** Owner creates room → N invite URLs, each signed JWT bound to `(room_id, agent_seat_id)`. Friend opens link → localStorage → plays. No email, no OAuth, zero friction for zh audience. |
| 6 | Auth — later | Supabase Auth magic-link + OAuth in Phase 4.5d as a layer on top of seat tokens. Tokens remain as the invite mechanism; Auth adds persistent cross-room identity. |
| 7 | Human play UX | **Design-only phase 4.5b** (~2 days of mockups + copy) before any implementation. Low-fi but specific: vote radio grid, witch potion cards, seer target picker, speak textarea with pressure cues. Validate with user. |
| 8 | Scope phasing | 4.5a (runtime) → Phase 5 UI (unblocked) → 4.5b (human UX design) → 4.5c (human play implementation) → 4.5d (multi-human + Auth layer). |
| 9 | Timeout policy | Per-mode configurable. Default: indefinite for rooms with 1 human, per-turn bounded for multi-human. Fallback: mode-specific (witch no-save, vote abstain, AI takeover of unresponsive seat). |
| 10 | Observability | `/admin/rooms/:id` route showing room's state-over-time (phase transitions, events timeline, pending waiting_for). Minimal but non-negotiable. Budget: 0.5 day in 4.5a. |
| 11 | Tests | **TDD for runtime.** Write replay tests first: `expect(advanceTwice(room)).toEmitIdenticalEventSeq()`. Then implement. Non-negotiable for determinism safety. |
| 12 | Legacy replays | 6 shipped zh seed replays keep working. No breaking schema changes; only additions. |

---

## 2. Architecture

### 2.1 How we replace `waitUntil()` bundling

**Today**: `POST /api/rooms/werewolf` calls `room.start(flow)` inside `waitUntil()`. One Vercel function instance tries to finish the entire 40-80 LLM-call game within 5 min. Fails for werewolf.

**V2**: Same endpoint creates the room in DB and **kicks off a single `/api/rooms/tick` self-invocation**. That tick loads the room, runs ONE phase (e.g., `wolfDiscuss` round), persists events, inline-invokes the next tick for the same room, returns. Each tick is bounded to one phase (10-60s), well under the 5-min function limit. Chained ticks walk the game to completion.

```
┌──────────────────────────────────────────────────────────┐
│  POST /api/rooms/werewolf                                 │
│   ├─ INSERT rooms (status='running', agents, role...)    │
│   ├─ INSERT events (seq=0, type='room:created')          │
│   └─ fetch /api/rooms/tick?id=X  (fire and forget)       │
└──────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│  POST /api/rooms/tick?id=X  (each call ≤60s)              │
│   ├─ loadRoomState(X) — fold events into memory state    │
│   ├─ advanceRoom(X, state) — run ONE phase                │
│   │    ├─ invoke agent.reply() (or read pre-emitted hint)│
│   │    ├─ append events for new messages                 │
│   │    ├─ transition phase in gameState                  │
│   │    └─ update rooms.currentPhase, rooms.status         │
│   ├─ if status='running': fetch /api/rooms/tick?id=X     │
│   ├─ if status='waiting': DO NOT re-fire; wait for event │
│   └─ if status='completed': done                          │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  pg_cron every 5s → POST /api/rooms/tick-all             │
│   ├─ SELECT rooms WHERE status='running'                 │
│   │    AND updated_at < now() - interval '10 seconds'    │
│   └─ Re-fire /api/rooms/tick for each (safety net)       │
└──────────────────────────────────────────────────────────┘
```

**Why this works**:
- Each tick is one phase = one LLM call (werewolf wolves vote) or a few (wolf-discuss round with 2-4 wolves speaking). 10-60s typical.
- Inline self-invoke keeps AI-only latency low (~0.5-1s between ticks for HTTP overhead, NOT 5s).
- pg_cron catches rooms whose inline chain broke (network glitch, function killed mid-invoke).
- "Waiting" state cleanly represents "paused until human input" without a heavyweight workflow engine.

### 2.2 `advanceRoom` contract

```typescript
// apps/web/app/lib/room-runtime.ts (NEW)

export interface RoomState {
  room: RoomRow
  agents: AgentInfo[]
  gameState: Record<string, unknown>  // mode-specific (werewolf has roleMap, eliminatedIds, etc.)
  events: EventRow[]
  pendingEvents: PlatformEvent[]       // emitted during this advance, not yet persisted
}

export type AdvanceResult =
  | { kind: 'continue' }                                       // ready for next tick
  | { kind: 'wait'; eventName: string; predicate: Record<string, unknown>; timeoutAt?: Date }
  | { kind: 'complete'; result: 'village_wins' | 'wolves_win' | null }
  | { kind: 'error'; message: string }

export async function advanceRoom(roomId: string): Promise<AdvanceResult>
```

Internal steps:
1. Load room + events from DB
2. Fold events → `RoomState` (this helper already exists for replay; reuse)
3. Dispatch by `room.modeId` to mode-specific advance function
4. Mode function runs ONE phase, returns `AdvanceResult` + emits events
5. Transactionally: insert new events + update room columns (status, currentPhase, gameState, waitingFor)

Mode-specific advance lives in `packages/modes/<mode>/advance.ts` (NEW per mode). Each is pure-ish: takes current state, produces next events + updated state. Side effects limited to LLM calls which are the only non-deterministic ops.

### 2.3 Determinism contract

Refactor `createWerewolf`:

**Before** (non-deterministic):
```typescript
const agentId = crypto.randomUUID()
const shuffled = shuffleArray(roles)  // Math.random
```

**After** (deterministic per room):
```typescript
const seed = hashRoomId(roomId)
const agentIds = seedPregenerated(seed, agentConfigs.length)  // same seed → same IDs
const shuffled = seededShuffle(seed, roles)
```

This is the key refactor. All non-determinism moves to one place: LLM API calls, which get their outputs persisted as events. Everything else folds deterministically.

### 2.4 Side effect idempotency

Every event has a monotonic `seq` per room. Before inserting events from a tick, runtime checks `max(seq) in DB vs. seq of first new event`. If mismatch → another tick beat us → skip this batch (another tick already advanced the state).

Dedup cheap at tick level: `ON CONFLICT (room_id, seq) DO NOTHING`. Events are idempotent by construction.

### 2.5 "Waiting" state

Add columns to `rooms`:

```sql
ALTER TABLE rooms
  ADD COLUMN waiting_for JSONB,   -- { eventName, predicate } for resumption
  ADD COLUMN waiting_until TIMESTAMPTZ;
```

Update status CHECK constraint to include `'waiting'`.

When a mode's advance returns `{ kind: 'wait', ... }`:
- Runtime sets `status='waiting'`, `waiting_for=<predicate>`, `waiting_until=<timeout>`
- Does NOT fire next tick
- Waits for either (a) matching event insert to `/api/rooms/:id/human-input` OR (b) pg_cron catches timeout and transitions to fallback

No separate `workflow_events` table. Human input routes insert directly into the existing `events` table with a special event type, e.g., `'human:input'`. The next tick's folding picks it up like any other event.

---

## 3. Sub-phase plans

### 3.1 Phase 4.5a — AI-only durable runtime (~4 days)

**Goal**: 12-player AI-only werewolf games complete reliably via `/api/rooms/tick` chain. Phase 5 UI unblocked.

**Tasks**:
- [ ] Drizzle migration: add `rooms.waiting_for`, `rooms.waiting_until`, update status CHECK
- [ ] `apps/web/app/lib/room-runtime.ts`: `advanceRoom(roomId)`, `loadRoomState`, state folding helpers
- [ ] Deterministic refactor in `packages/modes/werewolf/`: seeded shuffle, pre-generated agent IDs
- [ ] `packages/modes/werewolf/advance.ts`: per-phase advance functions that return AdvanceResult
- [ ] `packages/modes/roundtable/advance.ts`: simpler, one round = one phase
- [ ] `apps/web/app/api/rooms/tick/route.ts`: dispatcher, inline self-invoke, idempotent
- [ ] pg_cron setup in Supabase dashboard (or via drizzle migration): every 5s → `/api/rooms/tick-all`
- [ ] `apps/web/app/api/rooms/tick-all/route.ts`: sweeps stale running rooms
- [ ] Rewire `/api/rooms` + `/api/rooms/werewolf` POST: create in DB, fire single tick, return 200. Remove `waitUntil()` game-loop bundling.
- [ ] **TDD**: test suite in `packages/modes/__tests__/werewolf-replay.test.ts` — assert `advanceTwice === advanceOnce` by event seq; test pause/resume at every phase boundary.
- [ ] `/admin/rooms/:id/page.tsx`: observability view — phase timeline, recent events, waiting state
- [ ] Deprecate `runtime-registry.ts` + `persist-runtime.ts` — still used by `scripts/run-*.ts` for standalone-Node local dev, but not in the Vercel request path.

**Files**:
- NEW `apps/web/app/lib/room-runtime.ts` (~300 LOC)
- NEW `apps/web/app/api/rooms/tick/route.ts` (~100 LOC)
- NEW `apps/web/app/api/rooms/tick-all/route.ts` (~50 LOC)
- NEW `packages/modes/src/werewolf/advance.ts` (~400 LOC — the bulk of the work)
- NEW `packages/modes/src/roundtable/advance.ts` (~100 LOC)
- NEW `packages/modes/__tests__/werewolf-replay.test.ts` (~300 LOC of tests)
- NEW `apps/web/app/admin/rooms/[id]/page.tsx` (~150 LOC)
- NEW `packages/db/drizzle/migrations/0002_waiting_state.sql`
- MOD `packages/modes/src/werewolf/index.ts` (accept seed + pre-gen IDs)
- MOD `apps/web/app/api/rooms/route.ts`, `apps/web/app/api/rooms/werewolf/route.ts`
- MOD `apps/web/app/api/rooms/[id]/messages/route.ts` (no changes to response shape)

**Budget**: 4 focused days including 0.5 day TDD + 0.5 day observability.

**Exit criterion**:
- 12-player AI-only werewolf completes cleanly (60+ events, winResult set) on Vercel prod
- Replay of any completed game produces identical event sequence to original run
- `/admin/rooms/:id` shows the room's state history

**Ship after 4.5a**: commit + deploy. Re-run zh werewolf seeds (the 3 that timed out before). Verify they complete.

### 3.2 Phase 5 — UI overhaul (~10-12 days, unblocked after 4.5a)

Proceeds per `docs/design/phase-5-plan.md`. No changes needed to that plan — the spectator-first UI still works. Human seats in Phase 5 look visually identical to AI seats; kind-aware affordances land in 4.5c.

### 3.3 Phase 4.5b — Human-play UX design spec (~2 days, design-only)

**Goal**: Before writing human-input code, lock the play experience. Mockups + copy in a doc.

**Deliverables**:
- `docs/design/phase-4.5b-human-ux.md` with:
  - Wireframe (ASCII or described) for each werewolf turn type: vote, witch-save, witch-poison, seer-check, speak, last-words
  - Wireframe for debate turn: human's round prompt + textarea
  - Info visibility matrix: for each role, what can they see at each phase?
  - Microcopy for every prompt, every timeout warning, every fallback message
  - Timeout defaults per mode
  - "My turn" indicator design (ambient? notification? banner? sound?)
  - Disconnection UX: what does a human see when their seat's about to time out?

**Process**:
- Claude drafts V1 wireframes + copy
- Self-critique: where are the holes? (e.g., what if two humans want to speak at the same time?)
- V2 after feedback
- V3 if needed
- Lock with user before 4.5c begins

**No code this phase.** Pure design.

### 3.4 Phase 4.5c — Seat tokens + human play (~4-5 days)

**Goal**: 1-human-8-AI werewolf completes end-to-end. Human plays the witch seat, takes decisions, game finishes.

**Tasks**:
- [ ] Seat token signing/verification: `apps/web/app/lib/seat-tokens.ts` — JWT with room_id + agent_seat_id, signed with `AGORA_SEAT_SECRET` env var
- [ ] `POST /api/rooms/:id/invites`: owner generates N invite URLs (one per human seat)
- [ ] `GET /r/:roomId?seat=X&token=Y`: landing page validates token, stores in localStorage, redirects to room
- [ ] `HumanAgent` in `packages/core/src/agent.ts`: implements `Agent` interface, `kind='human'`, `reply()` throws "waiting" signal that mode-advance recognizes
- [ ] Mode advance branches on agent.kind: if human, emit `'human:input-required'` event + set room waiting_for, return `{ kind: 'wait' }`
- [ ] `POST /api/rooms/:id/human-input`: validates seat token, inserts `'human:input'` event matching the waiting_for predicate, fires tick
- [ ] `useRoomLive.ts` hook: Supabase Realtime subscription on `events` WHERE `room_id=X`, falls back to polling
- [ ] `ViewerContext` provider: reads seat token from localStorage, resolves seat + role + visible channels
- [ ] Server-side channel filter in `/api/rooms/:id/messages`: looks up viewer seat from Authorization header or query param, returns only messages on channels the seat subscribes to
- [ ] `MyInputPanel` component: subscribes to waiting_for, renders appropriate input form from 4.5b specs
- [ ] `SchemaForm` helper: renders structured decision schemas (vote, witch-action, etc.)
- [ ] Per-mode timeout policies: werewolf 60s per turn default, debate 300s, configurable per room
- [ ] Fallback implementations: witch no-save on timeout, vote abstain, AI takeover for speak

**Files**:
- NEW `apps/web/app/lib/seat-tokens.ts` (~100 LOC)
- NEW `apps/web/app/api/rooms/[id]/invites/route.ts` (~80 LOC)
- NEW `apps/web/app/r/[roomId]/page.tsx` (token landing, ~60 LOC)
- NEW `apps/web/app/api/rooms/[id]/human-input/route.ts` (~80 LOC)
- NEW `apps/web/app/room/[id]/hooks/useRoomLive.ts` (~120 LOC)
- NEW `apps/web/app/room/[id]/components/ViewerContext.tsx` (~80 LOC)
- NEW `apps/web/app/room/[id]/components/MyInputPanel.tsx` (~200 LOC based on 4.5b spec)
- NEW `apps/web/app/room/[id]/components/SchemaForm.tsx` (~150 LOC)
- MOD `packages/core/src/agent.ts`: add `HumanAgent`, refactor `Agent` interface
- MOD `packages/modes/src/werewolf/advance.ts`: branch on agent.kind
- MOD `packages/modes/src/roundtable/advance.ts`: same
- MOD `apps/web/app/api/rooms/[id]/messages/route.ts`: viewer filter

**Budget**: 4-5 days.

**Exit criterion**: Owner creates 1-human-8-AI werewolf game, sends invite link to human friend (or second tab), friend plays witch seat through two nights, game completes with correct winner.

### 3.5 Phase 4.5d — Multi-human + Supabase Auth layer (~3-4 days)

**Goal**: 2-human-7-AI werewolf with parallel day-vote fan-in + persistent Supabase Auth identity.

**Tasks**:
- [ ] Supabase Auth setup (magic-link + Google OAuth from day 1 since zh users now have WeChat-using-friends who might prefer OAuth)
- [ ] `auth.users` integration: seat tokens become "attached" to users on first claim for authed users; anon users still work via token alone
- [ ] `room_memberships` table: `(room_id, user_id, agent_seat_id, role)` — persists identity across rooms for authed users
- [ ] Presence via Supabase Realtime presence channel per room
- [ ] Disconnection grace: 30s before timeout applies
- [ ] Fan-in primitive: `waitForAllInputs(agentIds, eventName, timeoutMs)` helper in room-runtime
- [ ] Day-vote refactor: wait for all living humans' votes + resolve AI votes in parallel, then tally
- [ ] Invite panel UI for owner (N seat links)
- [ ] RLS policies on events/memberships (authed users see their rooms, anon users see via token)

**Files**:
- NEW `apps/web/app/login/page.tsx`, `apps/web/app/auth/callback/route.ts`
- NEW `apps/web/app/lib/supabase-{server,client}.ts`
- NEW `apps/web/app/room/[id]/components/InvitePanel.tsx`, `PresenceIndicators.tsx`
- NEW `packages/db/drizzle/migrations/0003_memberships_and_auth.sql`
- MOD `apps/web/app/lib/room-runtime.ts`: add fan-in helper
- MOD `packages/modes/src/werewolf/advance.ts`: day-vote + night-vote fan-in

**Budget**: 3-4 days.

**Exit criterion**: 3 devices (or browser profiles), 2 human seats + 7 AI, werewolf game completes including day vote round with simultaneous human votes and one disconnection recovery.

---

## 4. Reordered sequencing

```
4.5a (4d)  ─┬─ commit + deploy + seed zh werewolf re-runs (verify)
5.2 (4d)   ─┼─ round-table components + avatar + bubbles + modal (can start day 5)
5.3 (2d)   ─┤  agent detail modal
5.4 (2d)   ─┤  chat sidebar
5.5 (2d)   ─┤  wire both modes — commit + deploy beautiful UI
5.6 (2d)   ─┼─ mobile/polish/deploy
4.5b (2d)  ─┼─ human-play UX design spec (no code)
4.5c (5d)  ─┼─ seat tokens + human play — commit + deploy 1-human werewolf
4.5d (4d)  ─┴─ multi-human + Auth — final deploy
```

**Total**: ~27 focused days, 5 ship-able milestones.

**Key win**: beautiful UI ships at day 16 instead of day 28. Human-in-the-loop lands at day 23. By day 27 you have 2-human werewolf with Auth.

---

## 5. Risks + mitigations (V2)

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Determinism bug in room-runtime replay | High | TDD from day 1. `expect(replayTwice).toEmitIdenticalEventSeq()`. Lint against `Math.random`, raw `Date.now()`, `crypto.randomUUID()` outside the deterministic seed helper. |
| pg_cron latency compounds | Medium | Inline self-invoke after each phase. pg_cron is safety net, not primary. Monitor tick-to-tick latency in /admin view. |
| Side-effect double-emission on tick race | Medium | Event seq uniqueness + `ON CONFLICT (room_id, seq) DO NOTHING`. Each tick's first action is to check current max seq. |
| `createWerewolf` refactor regresses rules | High | Preserve existing unit tests in `packages/modes`. Port them unchanged. Integration test: 12p base game runs 3× and produces 3 different winners (seed rotation) but each winner is deterministic per seed. |
| Seat tokens leak in chat/screenshots | Medium | Short JWT expiry (24 hr); rotation on request. Post-4.5d, tokens become auth-attached. |
| zh magic-link still flaky in 4.5d | Medium | OAuth (Google, GitHub, later WeChat) from day 1 of 4.5d. Magic-link is fallback only. |
| Phase 5 UI built before human UX spec exists | Low | Phase 5 is spectator-first; human seats render identical to AI seats in Phase 5. 4.5b/c add kind-aware affordances on top without breaking Phase 5. |
| `/admin` view leaks data in public prod | Low | Gate `/admin` behind `AGORA_ADMIN_SECRET` header check for pre-auth phase. After 4.5d, gate on user role. |

---

## 6. Validation

Each sub-phase ships with its own criterion (see sub-phase sections). End-state full-system check:

- [ ] `pnpm check-types` clean
- [ ] 12p AI-only werewolf completes on prod (4.5a)
- [ ] Phase 5 UI renders all completed replays including new zh seeds (Phase 5)
- [ ] 1-human werewolf completes (4.5c)
- [ ] 2-human werewolf completes with day-vote fan-in + disconnection recovery (4.5d)
- [ ] Replay reproducibility: any completed game, re-advanced from event 0, produces identical event seq
- [ ] /admin/rooms/:id shows clean state history for all room types
- [ ] All 6 zh demo replays from earlier session still render correctly
- [ ] CLI scripts (scripts/run-*.ts) still work for local dev

---

## 7. What was NOT in V1 that V2 adds

- Explicit determinism strategy (seeded IDs + shuffle)
- Side-effect idempotency via event seq
- TDD budget
- Observability budget
- Reordering Phase 5 UI before human work
- Seat tokens replacing Supabase Auth MVP
- Phase 4.5b as design-only sub-phase
- pg_cron latency mitigation via inline self-invoke
- Cost to remove `packages/workflow` overhead

## 8. What was in V1 that V2 removed

- `packages/workflow` package (too generic; bespoke is simpler)
- `workflow_runs`, `workflow_steps`, `workflow_events` tables (reuse `events`)
- Generic `step.run` / `step.waitForEvent` primitives (reuse event sourcing)
- Supabase Auth magic-link MVP (deferred to 4.5d layer)
- Interleaved UI + human work (UI ships first now)

---

## 9. Open questions (resolved during 4.5a, non-blocking)

1. **Seeded shuffle algorithm**: Fisher-Yates with seed from `hash(room_id + 'shuffle-v1')`? → yes, commits room to version so we can bump if needed.
2. **Tick function concurrency**: if inline invoke overlaps pg_cron, do we dedup? → yes: `SELECT FOR UPDATE SKIP LOCKED` on the room row at tick start.
3. **Fallback for unresponsive AI**: if an LLM call fails after 3 retries, does the mode abort or skip that agent's turn? → skip with a system-emitted "thinking…" timeout message. Mode-specific TBD in advance.ts.
4. **Event types for human inputs**: one `'human:input'` type with payload shape per turnId, or distinct types per decision? → one type, payload shape typed by turnId string.

---

## 10. Sequencing checkpoint (sign-off)

Before starting 4.5a code, confirm:
- ✅ Bespoke runtime approach (not generic workflow engine)
- ✅ Reorder: 4.5a → Phase 5 → 4.5b → 4.5c → 4.5d
- ✅ Seat tokens for MVP, Supabase Auth layer in 4.5d
- ✅ TDD for determinism
- ✅ 2 days of pure design in 4.5b before human-play code

Then: begin 4.5a, committing after TDD green + observability view, deploying to Vercel, re-running the 3 timed-out zh werewolf seeds to verify completion.
