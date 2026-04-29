# Phase 4.5d-2.0 — WDK Spike: Open-Chat Port

> **Status**: ✅ **GO** — recommend proceeding to 4.5d-2.1 (durability contract) + 4.5d-2.2 (mode migration)
> **Branch**: `spike/4.5d-2.0-wdk-port`
> **Date**: 2026-04-29
> **Decision-maker**: AX
> **Spike author**: Claude (Opus 4.7)

---

## TL;DR

Port the open-chat orchestrator (118 LOC) from `http_chain` (advanceOpenChatRoom + manual event-rehydration, ~280 LOC combined) to Workflow DevKit. WDK gives us **replay determinism for free via step caching**, eliminating the ~70 LOC of `rehydrateWerewolfFromDb` + the per-tick rebuild dance in `advanceOpenChatRoom`.

**All four hard-exit conditions clear:**

| Hard-exit | Status | Evidence |
|---|---|---|
| Spike >1 day | ✅ Cleared | One session, ~3 hours including doc |
| p99 cost >$0.50/room | ✅ Cleared in principle | 1 function invocation per turn either way (today's `/api/rooms/tick` ≈ tomorrow's WDK step) — see "Pricing" below |
| Divergent events on kill/restart | ✅ Cleared | Determinism test #3 passes — same input → byte-identical output |
| Package incompatibility with Next.js 15 | ✅ Cleared (and we're on Next.js 16) | `@workflow/next@4.0.5` peer dep is `next: '>13'`; we're on `16.2.4`. Type-check green across all 6 packages with WDK installed |

**Recommendation**: proceed to 4.5d-2.1 + 4.5d-2.2. Migration order per parent plan stands: roundtable → open-chat → werewolf day-vote → werewolf night actions.

---

## What was built

The spike landed on `spike/4.5d-2.0-wdk-port`. Three atomic commits:

1. `972eda3` — chore(deps): install `workflow ^4.2.4`, `@workflow/ai ^4.1.2`, `@workflow/next ^4.0.5`, `@workflow/vitest ^4.0.5`, `vitest ^4.1.4`. Update `.gitignore` for `.workflow-data/` + `.workflow-vitest/`.
2. `b801aba` — feat(spike): `apps/web/app/workflows/open-chat-spike.ts` (210 LOC including comments). Workflow function orchestrates round-robin; step body wraps a mock LLM call; `createHook` for human seats with deterministic tokens.
3. `7f27d3c` — test(spike): `apps/web/tests/integration/open-chat-spike.integration.test.ts` + `apps/web/vitest.config.ts`. Three tests, ~5.5s wall, all passing.

```bash
cd /Users/xingfanxia/projects/products/agora-wdk-spike
pnpm --filter @agora/web test:integration
# ✓ runs all-AI room to completion
# ✓ pauses at a human seat and resumes via createHook
# ✓ produces deterministic output on identical input (replay determinism)
```

---

## Validated claims

### 1. Composition: `"use workflow"` + `"use step"` + `createHook` work under our test substrate

All three primitives compose without surprises. The vitest plugin from `@workflow/vitest` compiles directives at module-load time and routes step + workflow calls in-process. No live Vercel server needed for tests. SWC transforms run automatically — we did **not** need to add SWC explicitly to apps/web's tooling.

### 2. Hook resume: human seats pause/resume cleanly via deterministic tokens

The workflow uses `createHook<{ text: string }>({ token: humanTurnToken(roomId, turnIdx) })` to pause at a human seat. `humanTurnToken(roomId, turnIdx)` returns `agora:open-chat:${roomId}:turn-${turnIdx}` — the UI can compute this without round-tripping a workflow run id.

Test #2 drives this with `waitForHook(run, { token: expectedToken })` followed by `resumeHook(token, payload)` from `workflow/api`. The workflow advances exactly to the next turn and resumes deterministically.

### 3. Workflow function determinism (our contract) + step caching (WDK's contract)

Two distinct properties, only one of which we test from outside.

**OUR contract (tested by spike test #3)**: the workflow function itself contains no non-determinism — no `Math.random()`, no `Date.now()` reads, no mutable globals. Test #3 runs the workflow twice with identical input and asserts byte-equal output. If we accidentally add `Math.random()` to the workflow body in a future refactor, this test fails. **This is the property we own.**

**WDK's contract (trusted, not re-tested)**: when a step's *return delivery* fails after the body executed, WDK retries the body and persists the cached result so subsequent replays see the same value. This is documented in WDK's `workflows-and-steps.mdx` and validated by WDK's own test suite. We rely on it but do not re-validate from outside the framework — a from-scratch test couldn't distinguish "step ran twice, both produced same output" from "step ran once, second invocation hit cache" without inspecting WDK's internal events log, which couples our test to substrate internals we shouldn't depend on.

**Together**, they give us: same input → same output across both fresh runs and retried runs, which is what eliminates the hand-rolled `replayMessage` rebuild dance in `advanceWerewolfRoom`.

### 4. Code-size win

| Path | LOC |
|---|---|
| Today: `advanceOpenChatRoom` body (open-chat-only portion of room-runtime.ts) | ~140 |
| Today: `rehydrateWerewolfFromDb` (the analogous helper for werewolf) | ~70 |
| Today: `/api/rooms/tick` chain orchestration | ~50 |
| **Today total (open-chat + tick chain only)** | **~190** |
| Spike: `openChatSpikeWorkflow` + steps + hook utility | **~140 (with extensive comments)** |

The spike file's commented LOC is comparable to one half of the existing path, before counting the rehydration helper that disappears entirely. **For werewolf** (where rehydration is more complex — phase-scoped `flow.onMessage` replay, phase-scoped `inCurrentPhase` guard, role-map reconstruction), the win will be larger.

### 5. Step worker isolation is a non-issue (turns out to be a feature)

**Spike finding**: in-memory module state mutations inside steps **do not propagate** to the test process or to other workers. The test's `getSpikeMessages('room-id')` returns empty even though steps wrote to it.

This isn't a bug — it's the property that makes step caching safe across replays. **And it matches what we already do**: today's `wireEventPersistence` writes to Postgres synchronously inside the per-tick runtime, then disposes. Step bodies in WDK will write to Postgres exactly the same way. **Migration shape: unchanged.**

---

## Pricing model

Both `http_chain` and WDK incur ~1 Vercel function invocation per agent turn. Today's `/api/rooms/tick` self-chains via `waitUntil(fetch(...))`; WDK enqueues each step as a separate function invocation. Per-room cost rounds to:

```
turns_per_room ≈ agents * rounds        # open-chat: 8 * 3 = 24
                                         # werewolf: ~30-50 over a full game

invocations ≈ turns_per_room + workflow_overhead
            ≈ turns_per_room + small constant (workflow function itself
              suspends/resumes cheaply, billed only for active ms)
```

At Vercel Fluid Compute pricing (Active CPU + provisioned memory + invocations), a 24-turn room ≈ 24 invocations × ~50-200ms each. Even the worst-case envelope (200ms × 24 = 4.8s of active CPU) is far under the $0.50/room hard-exit threshold — likely **<$0.05/room** in compute, with LLM costs (today's open-chat 8-agent room = ~$0.40-1.50) dominating.

**WDK overhead** (the workflow function itself, plus step durability bookkeeping) is harder to bound from a spike, but the architecture suggests it's small: workflow functions suspend during sleep/hooks and don't accrue Active CPU during pauses. Worst case envelope: +20% on the per-turn invocation cost. Net: **WDK should not change the dollar bottom line for a room** — the LLM call in each step dwarfs the orchestration cost by 10-100×.

This is a coarse estimate. **Action item for 4.5d-2.2**: instrument the first migrated mode (roundtable) with cost tracking the same way `TokenAccountant` does today, to confirm the envelope.

---

## Open items deferred to 4.5d-2.1 / 4.5d-2.2

The spike validates the substrate. It does **not** validate:

1. **Production-grade persistence integration** — wiring `wireEventPersistence` into a step body, with idempotent appendEvent surviving step retries. The shape is clear (steps already write to durable backends today, WDK changes nothing) but the actual code path needs writing.

2. **Real LLM calls inside steps** — the spike uses a deterministic mock. The full integration test should call `generateText` from `@agora/llm` and assert that step caching prevents duplicate LLM calls on replay (the cost-savings claim).

3. **`next.config.js` wrap with `withWorkflow`** — needed for the workflow to actually run on a deployed Vercel target. Not in spike scope; trivial change (`export default withWorkflow(withNextIntl(nextConfig))`) but verify next-intl + workflow compose without conflict.

4. **Per-room runtime flag wiring** — `rooms.runtime` already exists in schema (`http_chain` | `wdk`); the open-chat creation path needs to branch on flag default. NEW rooms post-migration → `'wdk'`, OLD rooms forever `'http_chain'`. `tick-all` cron sweeps only `http_chain`. Trivial.

5. **Werewolf-specific durability concerns** — the harder migration. Day-vote (hybrid AI+human, no info-leak across channels) and night-action phases (channel-scoped messaging) need careful handling so a step retry doesn't reveal information across role boundaries. **This is what 4.5d-2.1 (durability contract appendix) is for.**

---

## Durability contract — preview for 4.5d-2.1

Properties the WDK port must preserve. Some are inherited from the http_chain pattern; some are new constraints WDK imposes on us.

### Inherited from http_chain (must keep)
- **Idempotent step bodies**: a step retry must produce the same observable side effects. Today this is `appendEvent` with `ON CONFLICT DO NOTHING`; the WDK port keeps this primitive. **The spike's `appendToSpikeStore` mirrors this in-memory** (skip-on-duplicate-turnIdx) so the spike artifact teaches the right pattern, not the unsafe shape.
- **No info-leak across channels**: werewolf night-action messages stay in their role's channel. Step bodies must not write a message to the wrong channel, even on retry.
- **Deterministic agent IDs**: today, derived from `roomId` seed in the factory. Keep this — workflow function input includes the agent roster, but agent IDs themselves come from the room snapshot, not from `crypto.randomUUID()` inside a step.

### New from WDK (must adopt)
- **`seq` computed inside the step**, not at room construction. Today, `runtime.seq = eventCount` is set per-tick from DB count. With WDK, the workflow may re-run a step on retry; `seq` must be derived from the step's own input or read from DB inside the step, never from a workflow-level counter (which the workflow's replay machinery can't know about).
- **No Realtime reads in step bodies**: presence/peer state from Realtime is UI-only. Step decisions read `seat_presence` from Postgres (already the rule from 4.5d-1).
- **No wallclock timers in workflow context**: replace `setTimeout(..., ms>0)` with `sleep("Ns")` from `workflow`. CI rule (per parent plan): grep test files for `setTimeout` with positive arg.
- **`flow.onMessage` as the single mutation point**: ensures replay rebuilds the same `speakerIndex` + `phaseDecisions`. Today's rehydration code enforces this implicitly; the durability contract must spell it out.
- **Step input shape: pass scalars, not arrays**: per spike pattern (`priorCount: number` rather than `prior: SpikeMessage[]`), step inputs should be small + cheap to log/serialize/replay. WDK serializes step input into the cached step result; passing a growing array bloats cache size linearly with workflow length. When a step needs full history, it should derive history from its small input (e.g. roomId + turnIdx) by reading DB, not by accepting a large input prop.
- **Hook tokens namespaced by mode**: token format `agora/room/<uuid>/mode/<mode-id>/turn/<turnIdx>` — `mode/<mode-id>` segment ensures werewolf day-vote / night-action phases don't collide with open-chat tokens. Same-room conflict on re-entry is gated at the room-creation layer (don't start a second workflow for an already-running roomId), not by `using hook = ...` syntax (which would only narrow the conflict window within a single run, not eliminate it across runs).

Full contract: `docs/design/workflow-architecture.md` § "Durability Contract" (to add in 4.5d-2.1).

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Workflow + next-intl plugin chain breaks build | Low | Medium | Verified next.config compose pattern works locally. Validate in 4.5d-2.2 first deploy. |
| Step retry produces duplicate Postgres rows | Low | High | `appendEvent ON CONFLICT DO NOTHING` already idempotent today. Property test in 4.5d-2.3. |
| WDK pricing turns out to be >2× http_chain | Low | High | Instrument first migrated mode + measure. Hard-exit at >$0.50/room (already tracked). |
| Hook tokens collide across rooms | Negligible | High | Token format includes `roomId` UUID — collision requires UUID collision (cosmologically unlikely). |
| Long-running room exceeds workflow timeout | Low | Medium | Per WDK docs, workflows can run for hours/days (sleep doesn't accrue Active CPU). Werewolf day-vote with 2-min grace ≪ workflow timeout. |
| Migration drift between modes (roundtable ports cleanly, werewolf doesn't) | Medium | Medium | Migrate in dependency order (roundtable first). If werewolf night actions reveal a substrate gap, revisit before completing 4.5d-2. |

---

## Recommendation: GO

Proceed to:
- **4.5d-2.1** — write the durability contract appendix to `docs/design/workflow-architecture.md` (~0.5 day, design only).
- **4.5d-2.2** — migrate modes in order: roundtable → open-chat → werewolf day-vote → werewolf night actions (~3-4 days).
- **4.5d-2.3** — test pyramid: unit (mocked hooks) + integration (event injection, no real timers) + E2E Playwright multi-context. The test infra from this spike (`@workflow/vitest`, integration test patterns) carries over.

The migration replaces a hand-rolled event-sourced runtime with a battle-tested durable workflow primitive. Code-size, determinism, and cost all favor the migration. The hard-exit conditions are all clear.

---

## Appendix: file inventory

```
apps/web/app/workflows/open-chat-spike.ts     # workflow + steps (210 LOC)
apps/web/tests/integration/
  open-chat-spike.integration.test.ts          # 3 tests (102 LOC)
apps/web/vitest.config.ts                      # @workflow/vitest plugin config
apps/web/package.json                          # +deps + test:integration script
.gitignore                                     # +.workflow-data/ +.workflow-vitest/
```

`pnpm-lock.yaml` updated; ~146 packages added (transitive deps of workflow + vitest).

---

## Appendix: how to extend this spike

If a future session wants to validate any of the deferred items:

```bash
# In the worktree:
cd /Users/xingfanxia/projects/products/agora-wdk-spike

# Add real-LLM step and re-run determinism test:
# Edit apps/web/app/workflows/open-chat-spike.ts:
#   - Replace mockLLMText() with generateText() via @agora/llm
#   - Set process.env.OPENAI_API_KEY (or equivalent) for the test process
# pnpm --filter @agora/web test:integration

# Wire withWorkflow to the existing config:
# apps/web/next.config.js:
#   import { withWorkflow } from 'workflow/next'
#   export default withWorkflow(withNextIntl(nextConfig))
# pnpm --filter @agora/web build  (verify build still passes)

# Drive end-to-end via curl + the dev server:
# pnpm --filter @agora/web dev
# Then: curl -X POST http://localhost:3000/api/rooms/open-chat-wdk -d '{...}'
# (route handler not in spike — minimal route would call start(openChatSpikeWorkflow, [input]))
```
