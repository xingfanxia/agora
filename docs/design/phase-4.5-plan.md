# Phase 4.5 — Durable Workflows + Human-in-the-Loop Foundation

> **Date**: 2026-04-14
> **Status**: Drafting (pending sign-off)
> **Triggers**:
> 1. 3 of 6 zh seed werewolf games orphaned at Vercel's 5-min function wall (run-count 35-42 / of ~60-80 needed). `waitUntil()` bundled the whole game loop into a single request.
> 2. Long-term goal: mixed rooms with N humans + N agents. Requires pausing indefinitely while waiting on human input, cleanly resuming from DB state, per-seat visibility.
>
> Phase 5 (round-table viz) is **blocked on this** — Phase 5 UI must bake in viewer-context + human-seat affordances from day 1.

---

## 1. Resolved decisions

| # | Question | Answer |
|---|----------|--------|
| 1 | Workflow engine | **Self-host on Supabase Postgres + pg_cron.** Preserves one-vendor architecture (Postgres = state + realtime + auth). ~1500-2000 LOC. Full control, no vendor lock-in, data stays on Supabase. Inngest alternative rejected to keep architecture coherent. |
| 2 | Realtime | Supabase Realtime — subscribe to `events` table WHERE `room_id = X`. Replace 1-2s polling for interactive views. Keep polling for spectator/replay. |
| 3 | Auth | Supabase Auth, **magic link MVP**. Email delivery — accept reliability risk for zh users; fall back to OAuth (Google/GitHub) when we hit friction. |
| 4 | Identity model | `auth.users` → `room_memberships (room_id, user_id, agent_seat_id, role)`. Role ∈ {owner, player, spectator}. |
| 5 | Spectator from day 1 | Yes — public rooms support anonymous spectate; **playing** requires auth + seat claim. Today's replay URLs stay anonymous-accessible. |
| 6 | Timeout policy | Per-mode configurable. Default: **indefinite** if only one human in the room, **per-turn bounded** for multi-human. On timeout: mode-specific fallback (werewolf witch → no save; werewolf vote → abstain; debate speak → AI-persona takeover). |
| 7 | Scope phasing | 4 sub-phases (4.5a workflow, 4.5b auth, 4.5c human input, 4.5d multi-human). Each ships independently with its own deploy + validation. |
| 8 | Workflow determinism | Workflows use replay-based execution (Inngest/Temporal pattern). Every wake-up re-runs handler from top; `step.run` calls short-circuit when their output is already persisted. Implication: **workflow bodies must be deterministic** — no `Math.random`, no `Date.now` outside `step.run`. |
| 9 | Existing replays | 6 shipped zh seed replays + any future ones before this phase stay readable. No schema-breaking changes; only additions. |
| 10 | Python vs TS SDK for pg_cron | pg_cron invokes HTTPS webhook on Vercel → no additional runtime needed. |

---

## 2. Problem decomposition

**What's broken today**:
- Game loop runs inside one Vercel function via `waitUntil()`. Bounded by 5-min function lifetime.
- Runtime (Room, EventBus, Flow, agents) held in `globalThis.__agora_runtime__` registry. Dies with the function instance.
- Agent abstraction is `AIAgent`-only. No primitive for pausing until human input.
- `/api/rooms/:id/messages` returns everything; no per-seat visibility filtering.
- No auth → can't identify who's who, can't enforce channel visibility.

**What we need for human-in-the-loop**:
- Pause indefinitely (hours, days) waiting for human input.
- Resume exactly where we left off when human submits.
- Multiple humans possible; might submit in parallel (day vote) or serially (speak-order).
- Per-viewer DB-level visibility (wolves can't see seer's private channel, enforced at backend).
- Timeout + fallback when human unresponsive.

---

## 3. Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (Next.js client)                                        │
│  ├─ Supabase Realtime WS subscribe to events(room_id=X)         │
│  ├─ ViewerContext: { userId, seatAgentId?, role, visibleChannels } │
│  ├─ RoundTable / ChatSidebar / MyInputPanel (Phase 5)           │
│  └─ POST /api/rooms/:id/human-input  (on turn submission)       │
└──────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│  Vercel Functions (Next.js App Router)                          │
│  ├─ /api/rooms        — creates room + workflow_run, returns 200│
│  ├─ /api/rooms/:id/messages — filters by viewer's seat         │
│  ├─ /api/rooms/:id/human-input — inserts workflow_event        │
│  ├─ /api/workflows/tick — dispatcher (invoked by pg_cron)       │
│  └─ /api/auth/* — Supabase Auth callbacks (magic link)          │
└──────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│  Supabase Postgres                                               │
│  ├─ rooms (existing)                                            │
│  ├─ events (existing)                                           │
│  ├─ workflow_runs (NEW)                                         │
│  ├─ workflow_steps (NEW, append-only step log for replay)       │
│  ├─ workflow_events (NEW, for step.waitForEvent)                │
│  ├─ room_memberships (NEW, user ↔ seat binding)                 │
│  ├─ auth.users (Supabase-managed)                               │
│  └─ RLS policies on events/messages/memberships                  │
│                                                                  │
│  pg_cron: every 5s → POST /api/workflows/tick                   │
│  Supabase Realtime: broadcasts events row changes               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Schema additions

### 4.1 Workflow tables (in `packages/db`)

```sql
-- A workflow run = one game playthrough
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL,                  -- 'werewolf-v1' | 'roundtable-v1'
  status TEXT NOT NULL DEFAULT 'queued',      -- queued|running|waiting|sleeping|completed|failed
  input JSONB NOT NULL,                       -- initial workflow input
  -- Wait state (only populated when status='waiting')
  waiting_event_name TEXT,
  waiting_predicate JSONB,                    -- match filter for resumption
  waiting_timeout_at TIMESTAMPTZ,
  -- Sleep state
  sleeping_until TIMESTAMPTZ,
  -- Result
  output JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX workflow_runs_dispatcher_idx
  ON workflow_runs (status, waiting_timeout_at, sleeping_until);
CREATE INDEX workflow_runs_room_idx ON workflow_runs (room_id);

-- Step log — enables replay-based resumption (each step's output persisted once)
CREATE TABLE workflow_steps (
  run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  step_id TEXT NOT NULL,                      -- stable user-provided identifier
  kind TEXT NOT NULL,                         -- run|waitForEvent|sleep
  input JSONB,
  output JSONB,                               -- set on completion
  status TEXT NOT NULL,                       -- pending|running|completed|failed
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, seq),
  UNIQUE (run_id, step_id)                    -- dedup by stable id
);

-- External signals that wake waiting workflows (e.g., human input submissions)
CREATE TABLE workflow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  payload JSONB NOT NULL,                     -- includes fields for predicate matching
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_by_run_id UUID REFERENCES workflow_runs(id),
  consumed_at TIMESTAMPTZ
);

CREATE INDEX workflow_events_unconsumed_idx
  ON workflow_events (event_name) WHERE consumed_at IS NULL;
```

### 4.2 Memberships + auth coupling

```sql
CREATE TABLE room_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_seat_id UUID,                         -- which agent seat (nullable for spectators)
  role TEXT NOT NULL,                         -- owner|player|spectator
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);
CREATE UNIQUE INDEX room_memberships_seat_unique
  ON room_memberships (room_id, agent_seat_id)
  WHERE agent_seat_id IS NOT NULL;

-- Extend the agents JSONB in rooms: add `kind: 'ai' | 'human'` per seat.
-- No schema change needed; just new field conventions. Existing rooms default to 'ai'.

-- Tighten rooms.created_by to NOT NULL (only new rows; backfill existing as NULL → owner=null is OK since room becomes owned on first claim)
-- Deferred: left nullable for now; auth phase will backfill a special "system" user for legacy rooms.
```

### 4.3 RLS policies (enabled after auth wires in 4.5b)

```sql
-- rooms: public rooms are readable by anyone
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY rooms_public_read ON rooms FOR SELECT USING (true);
CREATE POLICY rooms_owner_write ON rooms FOR ALL USING (created_by = auth.uid());

-- events: visible if
--   (a) spectator-safe (all-AI room, no humans present), OR
--   (b) viewer is a member AND the event's channel is visible to their seat
-- We compute visibility in the API layer initially. RLS policies added in 4.5b once
-- channel-subscription info is queryable.

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
-- Permissive for now; tighten in 4.5b
CREATE POLICY events_read_all ON events FOR SELECT USING (true);

-- room_memberships: user sees their own memberships + room owner sees all
ALTER TABLE room_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY memberships_self ON room_memberships FOR SELECT
  USING (user_id = auth.uid()
         OR EXISTS (SELECT 1 FROM rooms WHERE rooms.id = room_memberships.room_id AND rooms.created_by = auth.uid()));
CREATE POLICY memberships_write_self ON room_memberships FOR INSERT
  WITH CHECK (user_id = auth.uid());
```

---

## 5. Core abstractions

### 5.1 `packages/workflow` (NEW)

```typescript
// packages/workflow/src/index.ts

export interface WorkflowDefinition<Input = unknown, Output = unknown> {
  id: string
  version: number
  handler: (input: Input, ctx: WorkflowContext) => Promise<Output>
}

export interface WorkflowContext {
  runId: string
  roomId: string
  step: {
    run<T>(stepId: string, fn: () => Promise<T>, opts?: StepRunOpts): Promise<T>
    waitForEvent<T = unknown>(eventName: string, opts: WaitForEventOpts): Promise<T>
    sleep(stepId: string, ms: number): Promise<void>
  }
}

export interface StepRunOpts {
  retries?: number                    // default 3
  retryBackoffMs?: number             // default 5000
}

export interface WaitForEventOpts {
  stepId: string
  predicate?: Record<string, unknown> // JSON-equal subset of event.payload
  timeoutMs?: number                  // default: no timeout (wait forever)
}

// Sentinel errors thrown to suspend execution
export class WaitForEventSuspension { /* ... */ }
export class SleepSuspension { /* ... */ }

// Public API
export function defineWorkflow<I, O>(def: WorkflowDefinition<I, O>): WorkflowDefinition<I, O>
export async function startWorkflow<I>(id: string, input: I, roomId: string): Promise<string>  // returns runId
export async function publishEvent(eventName: string, payload: Record<string, unknown>): Promise<void>
export async function tickDispatcher(limit?: number): Promise<TickResult>  // called by /api/workflows/tick
```

Implementation strategy — **replay-based execution**:
- On dispatcher tick, for each `queued` or newly-woken `waiting`/`sleeping` run:
  1. Load run + all its persisted `workflow_steps`.
  2. Re-invoke `handler(input, ctx)` from the top.
  3. Each `ctx.step.run(id, fn)` checks persisted steps: if completed, return cached output; otherwise execute fn, persist, return.
  4. `ctx.step.waitForEvent` first checks persisted match; if found, return; else check `workflow_events` for unconsumed match; if found, consume and return; else throw `WaitForEventSuspension` — dispatcher catches and marks run `waiting`.
  5. `ctx.step.sleep` — if persisted completion, return; else throw `SleepSuspension` with `wakeAt`.
  6. Handler returns normally → run marked `completed`.

Determinism contract:
- Workflow handler body must be deterministic given same (input, step outputs). Non-deterministic ops (LLM calls, random, DB reads, current time) must live inside `step.run`.
- Helpers: `ctx.step.run('now', () => Date.now())` for timestamps that need to persist consistently.

### 5.2 `packages/core/src/agent.ts` — refactor

```typescript
export type AgentKind = 'ai' | 'human'

export interface Agent {
  readonly id: string
  readonly name: string
  readonly kind: AgentKind
  readonly config: AgentConfig
  observe(msg: Message): void | Promise<void>
  // reply/decide defined by subclasses; runtime introspects .kind
}

export class AIAgent implements Agent {
  readonly kind = 'ai' as const
  // existing implementation, unchanged signature
  async reply(...): Promise<{ content: string; usage: TokenUsage; ... }>
  async decide<T>(ctx, schema): Promise<T>
}

export class HumanAgent implements Agent {
  readonly kind = 'human' as const
  // No reply(); runtime checks kind and uses workflow.waitForEvent instead
}
```

### 5.3 Mode workflows

Each mode gets a `workflow.ts` exporting a `WorkflowDefinition`:

```typescript
// packages/modes/src/werewolf/workflow.ts

export const werewolfWorkflow = defineWorkflow({
  id: 'werewolf-v1',
  version: 1,
  async handler({ roomId, agentConfigs, advancedRules }, ctx) {
    // Initialize game state
    await ctx.step.run('init', async () => {
      await seedWerewolfChannels(roomId, advancedRules)
      await seedInitialGameState(roomId, agentConfigs, advancedRules)
    })
    
    while (true) {
      const state = await ctx.step.run('load-state', () => loadGameState(roomId))
      if (state.winResult) break
      
      // Execute current phase as a single step bundling its turn sequence
      await executePhase(state.currentPhase, roomId, ctx)
      
      await ctx.step.run(`transition-after-${state.currentPhase}`, () => 
        advancePhase(roomId)
      )
    }
  }
})

async function executePhase(phase: WerewolfPhase, roomId: string, ctx: WorkflowContext) {
  switch (phase) {
    case 'wolfDiscuss': return wolfDiscussPhase(roomId, ctx)
    case 'wolfVote': return wolfVotePhase(roomId, ctx)
    case 'witchAction': return witchActionPhase(roomId, ctx)
    // ... one function per phase
  }
}

async function witchActionPhase(roomId: string, ctx: WorkflowContext) {
  const witch = await ctx.step.run('load-witch', () => findAgentByRole(roomId, 'witch'))
  if (!witch || isEliminated(witch)) return
  
  const decision = await requestDecision(witch, WitchNightSchema, 'witch-night', ctx)
  await ctx.step.run('apply-witch', () => applyWitchDecision(roomId, decision))
}

// Generic helper — AI vs human branching
async function requestDecision<T>(
  agent: Agent, 
  schema: ZodSchema<T>, 
  turnId: string, 
  ctx: WorkflowContext
): Promise<T> {
  if (agent.kind === 'ai') {
    return await ctx.step.run(`ai-decide-${turnId}-${agent.id}`, async () => {
      return (agent as AIAgent).decide(buildContext(ctx.roomId), schema)
    })
  }
  // Human: emit input request event, wait for response
  await ctx.step.run(`emit-input-req-${turnId}-${agent.id}`, () => 
    emitInputRequest(ctx.roomId, agent.id, turnId, schemaToUI(schema))
  )
  const input = await ctx.step.waitForEvent<{ decision: T }>('room/human-input', {
    stepId: `wait-${turnId}-${agent.id}`,
    predicate: { roomId: ctx.roomId, agentId: agent.id, turnId },
    timeoutMs: await getTimeoutMs(ctx.roomId, turnId)
  })
  return input.decision
}
```

The mode workflow is declarative — AI vs human is handled by one helper.

---

## 6. Sub-phase plans

### 6.1 Phase 4.5a — Workflow runtime + mode migration (~4 days)

**Goal**: AI-only werewolf games complete reliably under the new runtime.

**Tasks**:
- [ ] Create `packages/workflow` with defineWorkflow / startWorkflow / step.run / step.waitForEvent / step.sleep
- [ ] Drizzle migration: workflow_runs, workflow_steps, workflow_events
- [ ] pg_cron extension enabled on Supabase; cron entry invokes POST /api/workflows/tick every 5s with shared secret
- [ ] `/api/workflows/tick` route: picks up runs, runs handlers, handles suspension, retries
- [ ] Refactor `packages/core/src/agent.ts` — `Agent` interface, `AIAgent` implements it, `HumanAgent` stub
- [ ] Port werewolf from StateMachineFlow.start() → `werewolfWorkflow` definition
- [ ] Port roundtable from Room.start() → `roundtableWorkflow` definition
- [ ] Modify `/api/rooms` + `/api/rooms/werewolf`: create room in DB, then `startWorkflow()`, return 200. No more `waitUntil`.
- [ ] Deprecate `runtime-registry.ts` + `persist-runtime.ts` (still used by scripts/run-*.ts; migrate those too OR keep standalone in-process path for CLI scripts)
- [ ] Unit tests for workflow runtime (step.run dedup, waitForEvent resume, timeout, retries)
- [ ] Integration test: 12-player werewolf completes end-to-end via workflow
- [ ] Validation: seed 12-player zh game, verify completion

**Files**:
- NEW `packages/workflow/{package.json, src/{index,runtime,storage,context,types}.ts}`
- NEW `packages/db/drizzle/migrations/0002_workflow_tables.sql`
- NEW `packages/db/src/workflow-schema.ts`
- NEW `apps/web/app/api/workflows/tick/route.ts`
- MOD `packages/core/src/agent.ts`
- NEW `packages/modes/src/werewolf/workflow.ts`
- NEW `packages/modes/src/roundtable/workflow.ts`
- MOD `apps/web/app/api/rooms/route.ts`
- MOD `apps/web/app/api/rooms/werewolf/route.ts`
- MOD `scripts/run-werewolf.ts`, `scripts/run-debate.ts`

**Deploy**: commit after integration test passes. Vercel auto-deploy. Smoke-test 12p game on prod. 

**Exit criterion**: 12-player werewolf game completes cleanly (60+ messages, winResult set).

### 6.2 Phase 4.5b — Auth + memberships + seat claims (~3 days)

**Goal**: Users can sign up, rooms have owners + members, seats can be claimed.

**Tasks**:
- [ ] Enable Supabase Auth in project dashboard (magic-link only for MVP)
- [ ] `@supabase/ssr` and client setup in `apps/web`
- [ ] Drizzle migration: room_memberships table + RLS policies for rooms/memberships/events
- [ ] `/api/auth/callback` + login/logout pages (simple email input → magic link sent → verify)
- [ ] On room creation: insert owner membership automatically
- [ ] Seat claim flow: `POST /api/rooms/:id/claim-seat { seat_agent_id }` — requires auth, inserts membership with role='player'
- [ ] Room page: show "Claim this seat" buttons next to unclaimed HumanAgent slots when logged in
- [ ] Invite URL generation: `https://agora.app/room/:id?invite=TOKEN` — signed invite token valid for room
- [ ] Spectator fallback: unauthed users still see /replays + /replay/[id] as before

**Files**:
- NEW `apps/web/app/login/page.tsx`, `apps/web/app/auth/callback/route.ts`
- NEW `apps/web/app/lib/supabase-{server,client}.ts`
- NEW `apps/web/app/api/rooms/[id]/claim-seat/route.ts`
- NEW `apps/web/app/room/[id]/components/ClaimSeatButton.tsx`
- NEW `packages/db/drizzle/migrations/0003_memberships_and_rls.sql`
- MOD `apps/web/app/api/rooms/route.ts` (insert owner membership on create)
- MOD `apps/web/app/api/rooms/werewolf/route.ts` (same)

**Deploy**: after auth flow verified on prod + seat claim works.

**Exit criterion**: Two devices → two users sign in, create room, claim different seats, see memberships in DB.

### 6.3 Phase 4.5c — Human input + player view + realtime (~3 days)

**Goal**: A 1-human-8-AI werewolf game plays end-to-end. Human witch saves someone; game continues.

**Tasks**:
- [ ] `HumanAgent` full implementation
- [ ] `POST /api/rooms/:id/human-input { agentId, turnId, decision }` — validates user owns seat, inserts workflow_event
- [ ] Supabase Realtime subscription in `useRoomPoll` (or new `useRoomLive`) hook
- [ ] `ViewerContext` provider: resolve viewer's seat, role, visibleChannels
- [ ] Server-side channel filter in `/api/rooms/:id/messages` based on auth header
- [ ] `MyInputPanel` component: renders form for pending input requests
- [ ] Schema-to-form renderer: handle text, enum/radio (vote for player), optional target selector
- [ ] Per-mode timeout policies + fallback handlers
- [ ] Disconnection grace: Supabase Realtime presence → 30s grace → timeout path

**Files**:
- MOD `packages/core/src/agent.ts` (HumanAgent implementation)
- NEW `apps/web/app/api/rooms/[id]/human-input/route.ts`
- NEW `apps/web/app/room/[id]/hooks/useRoomLive.ts`
- NEW `apps/web/app/room/[id]/components/ViewerContext.tsx`
- NEW `apps/web/app/room/[id]/components/MyInputPanel.tsx`
- NEW `apps/web/app/room/[id]/components/SchemaForm.tsx`
- MOD `apps/web/app/api/rooms/[id]/messages/route.ts` (viewer filter)
- MOD `packages/modes/src/werewolf/workflow.ts` (timeout handling)
- MOD `packages/modes/src/roundtable/workflow.ts` (same)

**Deploy**: after 1-human werewolf completes on prod.

**Exit criterion**: Log in on two devices (or two profiles) → create werewolf game → one human claims "witch" seat → game progresses; when night falls, human gets prompt, submits save decision, game continues to day.

### 6.4 Phase 4.5d — Multi-human coordination (~2 days)

**Goal**: 2-human-7-AI werewolf game completes with parallel day-vote fan-in and at least one disconnection recovery.

**Tasks**:
- [ ] Update workflow helper: parallel `waitForEvent` for fan-in scenarios (e.g., day vote with 3 humans + 4 AI)
- [ ] Presence detection via Supabase Realtime: track which humans are online
- [ ] Grace period for disconnected humans before applying fallback
- [ ] Multi-human invite flow: owner creates room → generates N invite links (one per human seat)
- [ ] Tests: disconnect one human mid-turn, verify timeout + fallback
- [ ] Tests: two humans submit simultaneously, both accepted

**Files**:
- NEW `apps/web/app/room/[id]/components/InvitePanel.tsx`
- MOD `packages/workflow/src/runtime.ts` (fan-in primitive: `Promise.allSettled` semantics)
- MOD `packages/modes/src/werewolf/workflow.ts` (day-vote fan-in)

**Deploy**: final Phase 4.5 deploy.

**Exit criterion**: Three devices play a werewolf game with 2 humans + 7 AI; game completes including a day vote round with both humans voting, and a simulated disconnection recovery.

---

## 7. Migration + backward compatibility

- Existing 6 shipped zh replays continue working: old rooms stored with status='completed', events intact, no schema-breaking changes.
- `/replays` and `/replay/[id]` continue as anonymous-spectator routes (RLS permissive on rooms/events read, until 4.5b tightens for humans-present rooms).
- CLI scripts (`scripts/run-werewolf.ts`, `scripts/run-debate.ts`) migrated to invoke workflows via localhost API OR keep a standalone in-process path for local dev. Decision: **keep standalone in-process path** (no Vercel timeout applies locally; dev iteration stays fast). These scripts run the game loop directly against packages/modes without going through the workflow runtime.
- Seed script `scripts/seed-zh-demos.ts` stays as HTTP client; works against the new /api/rooms endpoints.
- Token tracking, observability endpoints, Timeline component — all continue reading from `events`, unchanged.

---

## 8. Risks + mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Replay-based workflow determinism bugs (e.g., `Math.random` outside step.run) | High | Lint rule + code review; unit tests that replay a workflow twice and assert identical step outputs |
| pg_cron 5s dispatcher latency → AI-only games feel slower | Medium | Fire dispatcher from /api/rooms immediately after insert; pg_cron is backup. Also consider Supabase pg_net for inline triggers. |
| Supabase magic-link email delivery flaky for zh users | Medium | Accept for MVP; bolt on OAuth (Google/WeChat) when friction hits |
| RLS policies too permissive → data leak | High | Explicit test suite: each role tries to read each table, assert deny/allow matrix |
| Werewolf rule regression during rewrite | High | Preserve existing rule tests; port them; add 12-player integration test |
| workflow_steps table bloat (append-only, 100s of rows per game) | Low | Periodic archival job (defer to Phase 8); ~100 KB per 100-step game, negligible at current scale |
| Mode workflows become rigid (every change requires v bump) | Medium | Version field on workflow definitions; old runs continue with old version; new runs use new. Migration story in 4.5a docs. |
| Timeout fallback policy surprises players | Medium | Expose fallback outcomes in transcript: "Witch failed to act (timeout)" |

---

## 9. Validation (end-of-phase)

Full end-state verification checklist:

- [ ] `pnpm check-types` clean across all packages
- [ ] 12p AI-only werewolf: completes cleanly, events persisted, winResult set
- [ ] 1-human-8-AI werewolf: human claims witch, saves someone, game completes
- [ ] 2-human-7-AI werewolf: day vote fan-in works, disconnection + timeout tested
- [ ] 1-human-2-AI debate: human submits 3 rounds, debate completes
- [ ] /replays still loads for anonymous users; shows all 6 zh seeds + new human games
- [ ] RLS matrix: viewer without seat can't see seer channel events; verified via direct DB query with auth context
- [ ] Legacy scripts/run-werewolf.ts still runs locally (standalone path)
- [ ] Workflow resume: kill dispatcher mid-game, start it again → game picks up exactly where it left off

---

## 10. Sequencing + milestones

```
4.5a (4d) ─┬─ commit ─ deploy ─ smoke prod ─ start 4.5b
4.5b (3d) ─┼─ commit ─ deploy ─ smoke prod ─ start 4.5c
4.5c (3d) ─┼─ commit ─ deploy ─ smoke prod ─ start 4.5d
4.5d (2d) ─┴─ commit ─ deploy ─ smoke prod ─ Phase 4.5 complete
```

**Total**: ~12 focused days. **Ship quality**: each sub-phase independently valuable and verifiable.

After 4.5d: begin **Phase 5 UI overhaul** — now builds on top of ViewerContext + HumanAgent; round table natively shows human seats with input panels, not just spectator view.

---

## 11. Open questions (to resolve during 4.5a)

1. **Workflow definition location**: `packages/modes/*/workflow.ts` (per mode, local) or `packages/workflow/workflows/*` (centralized registry)? → local keeps mode self-contained; prefer local.
2. **Retry policy default**: 3 attempts w/ 5s backoff reasonable? → yes for LLM calls; zero retries for deterministic logic (it won't help).
3. **Dispatcher concurrency**: how many runs to process per tick? → limit 20 per tick initially; tune on prod load.
4. **Does a CLI script still make sense after workflow migration**? → Yes for local-dev iteration; keeps dev velocity. But skip "orchestration" and just run the game loop straight in a Node process.
5. **pg_cron cost**: Supabase free tier allows cron; at 5s interval = 17,280 invocations/day. Vercel function invocation cost modest. → OK.

---

## 12. Appendix: Glossary

- **Workflow**: a durable, resumable game loop persisted in workflow_runs + workflow_steps tables.
- **Step**: atomic unit within a workflow; each step's output is memoized by stable step_id.
- **Replay**: workflow handler is re-executed from the top on each wake-up; steps short-circuit to cached outputs.
- **Suspension**: thrown sentinel (`WaitForEventSuspension`, `SleepSuspension`) that the dispatcher catches to park the run.
- **Event** (workflow_events): an external signal that resumes a waiting workflow. Not the same as `events` table (which stores game events for replay).
- **Seat**: a slot in a room that an Agent (AI or human) occupies. Identified by agent_id in rooms.agents JSONB.
- **Membership**: a user's claim on a seat or spectator role in a room.
- **ViewerContext**: frontend state about who's viewing the room right now — determines visibility + input affordances.

---

**Next**: tasks created in TaskList (4.5a → 4.5d); `docs/implementation-plan.md` and `memory/project_agora.md` updated. After user signs off on this doc, begin 4.5a.
