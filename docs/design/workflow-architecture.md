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
