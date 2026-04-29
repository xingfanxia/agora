# Workflow Architecture — Decision Record

> **Date**: 2026-04-15
> **Status**: Locked for Phase 6. Re-evaluate at Phase 4.5d or Phase 7.
> **Decision maker**: Project owner + session (conversational review)

## TL;DR

Agora runs long-running multi-agent rooms on Vercel. We considered three
workflow primitives and chose **hand-rolled HTTP chaining + Postgres
checkpoints** (what Phase 4.5a already ships). We stay there through
Phase 6. We migrate to Vercel Queues or Vercel Workflow DevKit the
moment the workload shape demands fan-out/fan-in or long suspensions.

## Context

A room in Agora is a state machine. Each "phase" is one step:
- **Werewolf**: `night_wolves → witch_action → seer_check → day_discuss → day_vote → ...` (~6-30 phases per game)
- **Open-chat**: single `discussion` phase, one speaker per tick, N agents × M rounds
- **Roundtable**: N agents × M rounds of debate

Each phase runs several seconds to ~60s of LLM calls. Vercel Functions
have a 300s max duration on Pro. A game takes minutes to tens of minutes
of wall clock.

## Current architecture (shipped in Phase 4.5a, f770ac3)

```
POST /api/rooms/{mode}
  ├─ create DB row with snapshot
  └─ waitUntil(fetch('/api/rooms/tick?id=X'))   ── async first tick
                                                        │
                                                        ▼
  POST /api/rooms/tick?id=X  (max 300s)
    ├─ advanceRoom(id) — load DB → rebuild runtime → replay events
    ├─ run ONE phase to boundary (or one turn for open-chat)
    ├─ persist events + gameState + currentPhase + currentRound
    └─ if { kind: 'continue' }
          └─ waitUntil(fetch('/api/rooms/tick?id=X'))   ── self-invoke next tick

  Vercel Cron: /api/rooms/tick-all (every 1 min)
    └─ for each stuck room (updated_at > 30s ago, status ∈ {running,waiting})
         → fire tick
```

**Durability sources**:
1. Each `advanceRoom` re-loads from DB — no in-memory state survives across ticks.
2. Events table is append-only. `INSERT ... ON CONFLICT (room_id, seq) DO NOTHING` — duplicate ticks cost nothing.
3. Rehydration deterministic: `createWerewolf(..., seed=roomId)` produces identical agentIds + role shuffle; open-chat fast-forwards `RoundRobinFlow` by message count.
4. `tick-all` cron + 30s stall window is the backstop if an inline self-invoke drops.

## The two alternatives we evaluated

### Option 2 — Vercel Queues

Replace `waitUntil(fetch(tick-url))` with `queue.enqueue({roomId})`. A
queue consumer picks it up and runs the next step. At-least-once delivery
+ explicit dead-letter + queue-depth observability.

### Option 3 — Vercel Workflow DevKit (WDK)

Rewrite the advance loop as a workflow function with `step.run()`
boundaries. WDK checkpoints between steps automatically across Fluid
invocations. Closer to Temporal UX without the cluster ops.

```ts
workflow('werewolf-game', async (step, { roomId }) => {
  let phase = 'night_wolves'
  while (phase !== 'ended') {
    phase = await step.run(`phase-${phase}`, () => runOnePhase(roomId, phase))
  }
})
```

## Why we're staying on HTTP chaining

### Shape mismatch

Queues and WDK earn their weight on **fan-out + fan-in + long suspension**
workloads. Agora's room loop is **sequential**:

```
  phase1 → phase2 → phase3 → ... → end
```

No parallelism between phases. No external-event suspension. The
chained HTTP model is the minimum viable wrapper for exactly this shape.

### Migration cost vs. value

| | Cost | Value today | Value at 4.5d | Value at Phase 7 |
|---|---|---|---|---|
| Stay | 0 | System runs | Hacky for multi-human voting | Can't express long pauses |
| → Queues | ~1 eng-week | ~0 | Decent (fan-in with timeout) | Doesn't solve long pauses |
| → WDK | ~1-2 eng-weeks | ~0 | Decent | **Purpose-built for this** |

Today's value from either is near zero because the workload doesn't
have the shape they optimize for.

### WDK API maturity

WDK was public beta / early GA as of 2026. For core infrastructure we'd
rather wait for settled API surface.

### Sunk-cost is illusory

Phase boundaries in our state machine are already the conceptual
workflow steps. Future migration is mostly **syntactic**
(`await advanceRoom(id)` → `await step.run('phase', ...)`), not an
architectural rewrite.

## Re-evaluation triggers

**Revisit when any of these become near-term**:

1. **Phase 4.5d — Multi-human fan-in.** Rooms with ≥2 humans voting
   simultaneously need "wait for any of {human₁, human₂, ..., 60s timer}"
   semantics. HTTP chaining forces polling + hand-coded state. Queues
   and WDK both handle this well; WDK's `step.run()` with a timeout
   primitive would be cleanest.

2. **Phase 7 — TRPG durable pauses.** GM says "休息 24 小时,明日再议"
   and the game suspends. Our lambda-per-tick model can't express
   "suspend for 24h then resume". WDK is purpose-built for this.

3. **Fan-out within a single phase.** If any mode ever needs N agents
   to act *truly in parallel* (not round-robin), we'd need Queues or
   WDK. Not foreseen in the current roadmap.

4. **External service dependency with retries.** If a phase depends on
   an external API that can flake (not an LLM call — we handle LLM
   retries inline), formal retry semantics from Queues/WDK would help.

## Decision

**Phase 6 V1 ships on HTTP chaining.** Ratified.

**Phase 4.5d and beyond**: Evaluate WDK stability at that time. If GA
and settled, migrate directly to WDK. If still beta, use Vercel Queues
as a stepping stone (the fan-in-with-timeout use case fits Queues well).

## Related references

- `apps/web/app/lib/room-runtime.ts` — `advanceRoom` + werewolf/open-chat advance
- `apps/web/app/api/rooms/tick/route.ts` — tick dispatcher
- `apps/web/app/api/rooms/tick-all/route.ts` — stuck-room sweeper
- `apps/web/vercel.json` — cron config
- `docs/design/phase-4.5-plan.md` — where durable runtime originated
- `docs/design/phase-4.5-plan.md` §Phase-4.5b-d — future human-in-loop work

## Notes from the conversation

Another agent proposed Queues/WDK for an **evaluation workflow** with
11 SMEs in parallel + synthesis + quality gate. That project's shape is
a DAG — Queues absolutely earn their weight there. Agora's shape is a
sequential loop. Same tools, wrong fit.

---

## 2026-04-28 update — re-evaluation gate fired

**Trigger**: Phase 4.5d planning surfaced the multi-human day-vote fan-in
work named in §Re-evaluation triggers item 1. Doing the 2026-04-28 status
check produced the inversion below.

### What changed since 2026-04-15

- **Vercel WDK reached GA on 2026-04-16** (one day after this doc was
  written). The "wait for settled API surface" condition stated above
  is now met.
- WDK ships as the open-source `workflow` package (MIT). The runtime
  can execute outside Vercel, defanging the lock-in concern that pushed
  us toward HTTP chaining as the conservative default.
- WDK's primitive set is exactly what we deferred building:
  `createHook<T>()` for external-event suspend (one per human seat),
  `Promise.race` against `sleep('60s')` for the fan-in timer, and
  `step.run()` boundaries that the existing per-phase boundaries
  already line up with.
- Vercel Queues remains in **public beta**. Even if it were GA, we'd
  still hand-roll the vote counter on top of it — Queues is the lower
  primitive; WDK is the higher one we actually want.

### Revised decision

**Phase 4.5d-2 (parallel fan-in) migrates directly to WDK. Skip Queues
as a stepping stone.**

Implementation contract (preserves the existing replay model):

- WDK runs as the orchestrator: phases become `step.run()` boundaries.
- WDK **calls** `flow.onMessage` from inside steps — does not replace
  the events table replay path. The events table stays the source of
  truth (this is what commit `c01119c` fixed and we don't want to
  re-break it). WDK's internal step log is a coexisting durability
  layer, not a replacement for our event sourcing.
- Feature-flag the WDK code path. Keep the HTTP-chain path live for one
  week post-deploy as rollback. Retire HTTP-chain only after the
  2-human-7-AI exit-criteria game runs cleanly through WDK.
- Roundtable still on legacy `waitUntil` (per 4.5c notes) folds into
  4.5d-3 once the WDK runtime is in place.

### What to verify before committing

- [ ] WDK pricing model (Events + Data Written + Data Retained) for a
  10-human room. Pull numbers from the docs page.
- [ ] WDK GA telemetry from the broader community — 12 days post-GA is
  fresh. Mitigation: feature flag + one-week dual-path window.
- [ ] Re-confirm `step.run()` semantics around our deterministic
  agent-ID seeding (our `createWerewolf(seed=roomId)` should compose
  cleanly with WDK replay, but verify with a determinism test).

### Open trigger reset

Trigger 2 (Phase 7 long-pauses) is now also covered: WDK's
`sleep('24h')` is the documented path. Phase 7 will not need a second
architectural review on this axis — it inherits 4.5d-2's substrate.

### Related sources (2026-04-28)

- https://vercel.com/docs/workflows
- https://vercel.com/blog/a-new-programming-model-for-durable-execution (GA, 2026-04-16)
- https://vercel.com/docs/queues
- https://vercel.com/changelog/vercel-queues-now-in-public-beta (2026-02-27)

---

## 2026-04-29 — Durability Contract for WDK substrate (Phase 4.5d-2.1)

> **Status**: Contract finalized. 4.5d-2.0 spike validated the substrate (`spike/4.5d-2.0-wdk-port`, GO recommendation in `docs/design/phase-4.5d-wdk-spike.md`). This section is the production-ready spec that 4.5d-2.2 mode migration must build against.

### Purpose

The WDK port replaces the hand-rolled http_chain advance loop (`advanceRoom` → `advanceOpenChatRoom` / `advanceWerewolfRoom` + `rehydrateWerewolfFromDb`) with `"use workflow"` orchestration plus `"use step"` bodies. The substrate is more powerful — workflow-level pause/resume via `createHook`, automatic step result caching, durable execution across function timeouts — but the power is conditional on every step body obeying a small set of invariants. This contract spells them out.

The cross-runtime invariant is the one the contract exists to protect: a `runtime='http_chain'` room and a `runtime='wdk'` room with identical inputs must produce identical event sequences. This is what makes `tick-all` cron + per-room runtime flag safe — old rooms continue on http_chain, new rooms start on wdk, replay/observability/audit code paths are runtime-agnostic.

### The contract

Every WDK step body in `apps/web/app/workflows/` must satisfy all eight rules. Violations are caught at three layers: (1) review of the step body, (2) the test in `tests/durability/`, (3) a CI grep rule. Specific test names noted per rule.

#### Rule 1 — Idempotent step bodies

A step body executed N times for the same input must produce identical observable side effects (DB rows, external API calls, log lines that another system reads). This is non-negotiable: WDK retries the body when the *return value delivery* fails, so a body that completed successfully but failed to deliver its return will re-execute end-to-end.

The lever is **always** an idempotency key on the side-effect target:
- DB writes: `INSERT … ON CONFLICT (room_id, seq) DO NOTHING`. Existing in `appendEvent`. Continue.
- External LLM calls: not idempotent at the provider, so wrap them in a step with cached return value. Step caching makes the second invocation a no-op even though the LLM call would otherwise re-charge. **This is the cost-savings claim the migration depends on.**
- Logging: structured logs are idempotent if downstream is keyed on `(roomId, seq)`. Don't log `Date.now()` — it differs across retries and noise-pollutes log queries.

**Test**: `tests/durability/idempotent-step-retry.integration.test.ts` — drive a single workflow with `@workflow/vitest`, force a step retry by killing the in-process worker mid-step, assert post-retry DB state has no duplicate rows for `(roomId, seq)`.

#### Rule 2 — `seq` computed inside the step, never passed in

Today's `runtime.seq = eventCount` (room-runtime.ts:202) sets the next-event sequence number from the DB count at the start of a tick. This works because each tick is a single function invocation that owns its sequence range.

WDK breaks this: a workflow function may suspend for a hook + resume hours later, by which time other workflows may have written events for the same room (humans joining, external triggers, repair scripts). The `seq` value at workflow entry is stale by the time a step needing it actually runs.

**The rule**: every step that writes an event must compute `seq` inside the step body using `(SELECT COALESCE(MAX(seq), -1) + 1 FROM events WHERE room_id = $1)`, evaluated against current DB state. Never pass `seq` into the step from the workflow function. Combined with Rule 1's idempotency key, retried writes become safe no-ops.

**Test**: `tests/durability/seq-recomputed-on-retry.integration.test.ts` — inject a manual event between a step's first run and its retry, assert the retry's recomputed seq doesn't collide.

#### Rule 3 — No Realtime reads inside step bodies

`seat_presence.last_seen_at` (Postgres) is the source of truth for liveness in any step's decision logic. The Realtime channel's peer list is a UI-only convenience.

The reason: Realtime presence is non-deterministic from the workflow's perspective — a step that reads it on first run vs. retry can see different peer sets, breaking replay. `seat_presence.last_seen_at` is updated synchronously by the heartbeat endpoint and is queryable as Postgres truth.

This rule was already adopted in 4.5d-1 (`lib/presence.ts` takes a `SeatPresenceRow` Postgres row, never a Realtime payload). 4.5d-2 inherits.

**Test**: grep step bodies for `supabase.channel(` or `getRoomLive` — none should appear in `apps/web/app/workflows/`. Lint rule via ESLint's `no-restricted-imports` on `@/lib/realtime` from `app/workflows/`.

#### Rule 4 — No wallclock timers inside workflow context

`setTimeout(fn, ms)` with `ms > 0` and `setInterval` are forbidden in workflow function bodies. Step bodies CAN use them for sub-step throttling (the step's overall semantics remain idempotent), but the workflow body must use `sleep("Ns")` from the `workflow` package — a durable suspension primitive that doesn't accrue Active CPU and survives function-instance recycling.

**Why**: a workflow function that uses `setTimeout(..., 5000)` to wait 5 seconds keeps the function instance alive (or, worse, returns and loses the in-flight timer). `sleep` is the WDK primitive that "wait without spending."

**CI rule**: grep test files + `apps/web/app/workflows/` for `setTimeout(` with positive numeric arg — fail CI on match. Allowed: `setTimeout(fn, 0)` for microtask scheduling (rare), `setTimeout` inside step bodies for retry backoff.

**Test**: `tests/durability/workflow-no-setTimeout.test.ts` — AST-walk every file in `app/workflows/`, fail on any `setTimeout(_, n)` where `n > 0`.

#### Rule 5 — `flow.onMessage` is the single mutation entrypoint for game state

Today's invariant from commit `c01119c` (Phase 4.5a): every message that mutates game state goes through `flow.onMessage()`. The reason was symmetry between live runs (where `room.runOneTurn` calls `flow.onMessage` synchronously) and rehydration (where `rehydrateWerewolfFromDb` re-applies events through `flow.onMessage`). Without this single entrypoint, rebuilt state diverged from live state.

WDK eliminates the rehydration helper (step caching gives us replay for free), but the rule still applies for a different reason: when a step processes a message, the resulting state mutation must be deterministic and confined to `flow`'s controlled state machine. Steps must NOT directly mutate the game-state JSONB column or any other shared state outside `flow`. Doing so would split state authority and reintroduce the rehydration divergence.

**Test**: `tests/durability/flow-onMessage-single-entrypoint.test.ts` — semgrep / AST rule that any step writing to `roomState`, `gameState`, or `eventBus.emit({ type: ...mutation })` directly is flagged. The legal pattern is `await flow.onMessage(roomId, event)`, period.

#### Rule 6 — Step inputs are scalars, not growing arrays

Pass `priorCount: number`, not `prior: Message[]`. WDK serializes step inputs into the cached step result; passing a growing array bloats the cache linearly with workflow length. A 50-turn werewolf game with `prior: Message[]` would pay quadratic cache cost.

When a step needs full history, it derives history inside the step body by reading DB given the small input (e.g. `roomId + maxSeq`), not by accepting a large input prop.

**Test**: not enforceable mechanically; review during 4.5d-2.2 mode migration. Add to per-mode PR checklist.

#### Rule 7 — Hook tokens namespaced by mode + room

Format: `agora/room/<uuid>/mode/<mode-id>/turn/<turnIdx>` (or analogous slot — `phase/<phase>/decision/<n>` for werewolf). Slash-separated, mode-segmented, room-scoped. This:
- Prevents collision between modes (open-chat turn-3 ≠ werewolf-day-vote phase-decision-3).
- Allows external resumers (UIs, repair scripts) to compute tokens deterministically without round-tripping a workflow run id.
- Keeps logs greppable.

Same-room conflict on workflow re-entry is gated at the room-creation layer (don't start a second workflow for an already-running roomId), NOT by `using hook = ...` syntax. `using` only narrows the conflict window within a single run; it does nothing for cross-run collision.

**Test**: room-creation API route (open-chat, werewolf, etc.) checks `rooms.status` before starting a new workflow; rejects with 409 if status is `running` or `waiting`.

#### Rule 8 — Module-level state in step files is process-local; persist via shared backing store

Spike finding (`docs/design/phase-4.5d-wdk-spike.md` § "Step worker isolation"): WDK runs steps in isolated worker contexts. A `Map` mutation inside a step does not propagate to other workers, the workflow runtime, or the test process. This is the property that makes step result caching safe.

**The rule**: any state that must be visible across step invocations or to consumers outside the step's worker MUST live in shared backing state (Postgres, Vercel KV, etc.). In-memory caches inside step modules are acceptable only as per-invocation scratch (e.g., in-step memoization within a single function call), never as cross-invocation memory.

**Test**: structurally enforced by Rules 1 + 2 — step bodies that need persistence already write to Postgres via `appendEvent`. This rule formalizes the "why don't we just use a Map" question that will come up during 4.5d-2.2.

### Cross-runtime equivalence

This is the binding meta-invariant: a room with `runtime='http_chain'` and a room with `runtime='wdk'` running on identical input (same agents, same topic, same human-input timing) must produce identical event sequences in the `events` table.

**Test**: `apps/web/tests/durability/cross-runtime-equivalence.integration.test.ts`. Status: **PASSING as of 4.5d-2.8 (commit `b64cbb9`)**. The test drives the SAME `{topic, agents, rounds}` scenario through both legacy `Room.start(flow)` and WDK `start(roundtableWorkflow, ...)`, persisting events through an in-memory adapter (`apps/web/app/lib/room-store-memory.ts`, gated by `WORKFLOW_TEST=1`), then diffs `message:created` events on `senderId / senderName / content / channelId`.

**Allowlisted divergences** (excluded from the diff):
- `message.id`: random UUID (legacy) vs. deterministic `rt-${roomId}-t${turnIdx}-${agentId}` (WDK, 4.5d-2.6).
- `message.timestamp`: `Date.now()` at write time -- back-to-back runs land at different ms.
- `message.metadata` shape: legacy populates `{ tokenUsage, provider, modelId }`; WDK populates `{ turnIdx }`. Both readers go through the events log, so live UI is consistent.
- Event-type asymmetries: legacy emits `agent:thinking` / `agent:done` / `round:changed` / `room:created` / `agent:joined` (realtime UX events); WDK does not. The diff is filtered to `message:created`.
- `token:recorded` count: under the test's `TokenAccountant` stub, legacy emits 0; WDK emits one per turn. Wire the real accountant if asserting on token events.

This test is the ultimate gate. The 4.5d-2.0 spike's GO recommendation is now **fully validated** -- the next operational step is applying migration 0010 to dev, then flipping the POST /api/rooms default from `http_chain` to `wdk` (single-line at `apps/web/app/api/rooms/route.ts:204`).

**Test infrastructure**:
- `apps/web/vitest.integration.config.ts` loads the `@workflow/vitest` plugin so test bodies can drive workflows in-process via `createLocalWorld` + direct handlers. The unit-level config (`vitest.config.ts`) excludes `*.integration.test.ts` to keep fast tests hermetic.
- The integration script runs with `NODE_OPTIONS='--import tsx/esm'` so Node's native ESM loader can read `.ts` workspace packages when the WDK runtime imports them (the bundle externalizes them per `@workflow/builders`'s `externalizeNonSteps: true`).
- Workspace packages aligned to `"type": "module"` + `.js` extensions on internal re-exports during 4.5d-2.8 (`@agora/llm`, `@agora/core`, `@agora/modes` were the outliers).
- The in-memory adapter's state is on `globalThis` (NOT module-level) because `@workflow/vitest`'s esbuild bundler INLINES local files into `steps.mjs`, so without globalThis the test process and the bundled-step runtime would each have separate Map instances.

### CI rules

```yaml
# .github/workflows/ci.yml — add to existing test job
- name: Forbid setTimeout in workflow bodies
  run: |
    if grep -rn "setTimeout(.*[1-9]" apps/web/app/workflows/ --include="*.ts" --include="*.tsx"; then
      echo "::error::setTimeout with positive timeout found in workflow body. Use sleep() from 'workflow'."
      exit 1
    fi

- name: Forbid Realtime imports in workflow bodies
  run: |
    if grep -rln "@/lib/realtime\|supabase.channel" apps/web/app/workflows/ --include="*.ts" --include="*.tsx"; then
      echo "::error::Realtime import in workflow body. Read presence from Postgres via lib/presence.ts."
      exit 1
    fi
```

Both rules are bypassable for the rare legitimate case (e.g., a step body using `setTimeout(..., 0)` for microtask scheduling) by inline `// ci-allow-setTimeout: <reason>` comment.

### Open questions deferred to 4.5d-2.2

1. **Per-mode workflow file split**: one file per mode (`open-chat-workflow.ts`, `werewolf-workflow.ts`) or shared module with mode-keyed dispatch? **Resolved (4.5d-2.2)**: one file per mode -- `apps/web/app/workflows/roundtable-workflow.ts`. Open-chat and werewolf will follow the same shape.
2. **`next.config.js` integration**: spike did not wrap `withWorkflow`. **Resolved (4.5d-2.2, commit `b8e9ab5`)**: `withWorkflow` is the OUTERMOST wrapper in `next.config.js` -- composes cleanly with `withNextIntl`.
3. **`.workflow-data/` storage in production**: spike used local filesystem. Still open for first production WDK deploy. Consult `node_modules/workflow/docs/deploying/world/vercel-world.mdx` when flipping the POST /api/rooms default to `wdk` in dev (already running locally) or before promoting to prod.

### Cross-references

- Decision record (this document, top): why we chose WDK over Queues
- Spike findings: `docs/design/phase-4.5d-wdk-spike.md`
- Phase plan: `docs/design/phase-4.5d-plan.md` § 4.5d-2.1, § 4.5d-2.2
- Spike branch: `origin/spike/4.5d-2.0-wdk-port` (5 commits, GO recommendation)
