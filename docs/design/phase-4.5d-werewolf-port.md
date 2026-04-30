# Phase 4.5d-2.12+ — Werewolf WDK Port

> Working design memo. Sequences the werewolf → WDK migration after roundtable + open-chat completed. As of 2026-04-29: not started, scaffolding only.

## Context

Roundtable and open-chat ship via the durable WDK runtime as of `a4e9045`. Werewolf is the last mode still bound entirely to the legacy `http_chain` tick path. Until ported, werewolf rooms cannot benefit from the durability contract (no terminal-error guard, no schema-level idempotency, no cross-runtime equivalence guarantees).

Werewolf is qualitatively harder than the previous two modes:

| Aspect | Roundtable / Open-chat | Werewolf |
|---|---|---|
| Speaker selection | Round-robin | Phase-driven state machine (8+ phases) |
| LLM output shape | Plain text | Structured (Zod-typed votes / actions) |
| Human pause | One seat at a time | Multiple humans vote in parallel |
| Timeouts | None — wait indefinitely | Grace window via `sleep(...)`, fall back on offline humans |
| Game state | Just turn counter | Roles, eliminations, witch potions, sheriff badge, guard last-protected, ... |
| Determinism boundary | LLM hash | LLM hash + seeded role assignment + `crypto.randomUUID` replacement |

## Existing utilities (good news — most of what we need already exists)

| What | Where | Status |
|---|---|---|
| Mode fallback registry | `packages/modes/src/fallback-policies.ts` | ✓ Complete. `getFallback('werewolf', 'day-vote')` returns `{ kind: 'abstain' }` |
| Seat presence (Postgres) | `apps/web/app/lib/presence.ts` | ✓ Complete. `getPresence` + `isOnline(presence, graceMs, now)` are pure helpers |
| Seeded role assignment | `packages/modes/src/werewolf/index.ts:assignRoles` | ✓ Deterministic (`createSeededPrng`) |
| Decision schemas (Zod) | `packages/modes/src/werewolf/types.ts` | ✓ Day-vote, wolf-vote, witch-action, seer-check, hunter-shoot, guard-protect, sheriff schemas |
| Vote tally helper | `packages/modes/src/werewolf/phases.ts:tallyVotes` | ✓ Reusable, mode-agnostic — just lift it out |
| WDK `sleep` primitive | `workflow/sleep.d.ts` | ✓ Three overloads (string duration / Date / ms) |
| WDK `createHook` | `workflow` | ✓ Used in open-chat already |
| `Promise.race` against sleep | — | ❓ Pattern is in the original 4.5d-2 plan sketch but never validated end-to-end. The 4.5d-2.0 spike validated `createHook` alone, NOT the race |

## Missing utilities

1. **Structured-output WDK step adapter** — equivalent of `generateAgentReply` but using `generateObjectFn` (Zod schema → typed decision). New step + new entry in `llm-factory.ts`.

2. **Structured-output mock for `WORKFLOW_TEST=1`** — `llm-factory.ts:createGenerateFn` returns deterministic mock TEXT for the LLM. There's no `createGenerateObjectFn` mock today. Need a deterministic mock that returns a Zod-valid object based on hashed inputs (e.g., for day-vote pick the first allowed target).

3. **Mode-fallback dispatch step** — adapts a `FallbackAction` (kind: 'abstain' / 'skip' / etc.) into a vote payload. Pure logic, ~30 lines, but should be a step so retries get the cached result.

4. **Game-state rehydration helper** — `apps/web/app/lib/room-runtime.ts:rehydrateWerewolfFromDb` currently rehydrates a `StateMachineFlow`. WDK doesn't use `StateMachineFlow` — its replay is automatic via step-result cache. But the workflow body still needs to load roles + eliminations + last-night state from events on cold start. New helper.

## Sub-phase ladder

> Numbering continues from `2.11` (last shipped). Each row is one PR / commit.

| Sub-phase | Scope | Risk | Est |
|---|---|---|---|
| **2.12** | Structured-output infrastructure: extend `llm-factory.ts` with `createGenerateObjectFn` (real + WORKFLOW_TEST=1 mock), add format-pinning unit tests | Low — mirrors `createGenerateFn` | ~2h |
| **2.13** | `generateAgentDecision` step + `applyFallback` step + tally helper, all in a new `apps/web/app/workflows/werewolf-day-vote-workflow.ts`. No persistence yet. | Low | ~2h |
| **2.14-spike** | Day-vote workflow standalone (NOT integrated into full werewolf game). Wires AI fan-in + human `createHook` + `sleep` race + fallback. Integration tests via @workflow/vitest: all-AI / mixed in-time / mixed timeout. **Validates the binding meta-invariant for werewolf: parallel-human-votes-with-grace-window can be expressed in WDK at all.** | **HIGH** — first time `Promise.race(hook, sleep)` is validated in this project | ~4h |
| **2.15** | Night phases — wolfDiscuss (chat) / wolfVote / witchAction / seerCheck / guardProtect. Sequential per-phase, easier than day-vote. | Medium | ~3h |
| **2.16** | Dawn computation phase + day-discuss chat + last-words. | Low — follows established patterns | ~2h |
| **2.17** | Hunter / sheriff / idiot mechanics. Triggered phases (hunter only fires on death). | Medium — conditional flow | ~3h |
| **2.18** | Full game integration — single workflow body that orchestrates all phases via TS switch on `currentPhase`. Replaces `advanceWerewolfRoom`. Migration 0010 already covers the events table. Werewolf API route gets `runtime: 'wdk'` branch. | Medium-high — integration risk | ~4h |
| **2.19** | Werewolf cross-runtime equivalence test. AI-only flow (skip humans). Mirrors the open-chat / roundtable allowlist. | Medium — werewolf has more event divergences | ~2h |
| **2.20** | Default flip to `runtime: 'wdk'` for werewolf. After soak. | Low | ~1h |

**Total estimate**: ~23 hours of focused work. Realistic calendar: 4-6 sessions.

## 2.14-spike: detailed design

This is the load-bearing sub-phase. If it doesn't work, the entire sequence stops. Worth designing in detail upfront.

### Workflow body shape

```ts
// apps/web/app/workflows/werewolf-day-vote-workflow.ts

import { createHook, sleep, FatalError } from 'workflow'
import { z } from 'zod'

interface DayVoteInput {
  readonly roomId: string
  readonly nightNumber: number  // for namespacing the hook tokens
  readonly aliveSeats: readonly Seat[]  // both AI and human
  readonly aliveTargetNames: readonly string[]
  readonly graceMs: number  // typically 60_000
}

interface DayVoteResult {
  readonly winnerId: string | null
  readonly tally: Record<string, number>
}

export async function dayVoteWorkflow(input: DayVoteInput): Promise<DayVoteResult> {
  'use workflow'

  const aiSeats = input.aliveSeats.filter(s => !s.isHuman)
  const humanSeats = input.aliveSeats.filter(s => s.isHuman)

  // (1) AI votes — parallel within the workflow body. Each is a step.
  // Parallelism is at the workflow level: the runtime can interleave step
  // execution. Step idempotency means each retry recomputes the same vote.
  const aiVotes: VoteRecord[] = await Promise.all(
    aiSeats.map(seat => generateDayVoteDecision({
      roomId: input.roomId,
      nightNumber: input.nightNumber,
      seatId: seat.id,
      systemPrompt: seat.systemPrompt,
      provider: seat.model.provider,
      modelId: seat.model.modelId,
      targets: input.aliveTargetNames,
    }))
  )

  // (2) Human votes — each gets a hook + sleep race.
  // The createHook is registered as a workflow primitive; the race uses
  // sleep() from 'workflow' (durable across workflow restarts).
  const humanResults: VoteRecord[] = await Promise.all(
    humanSeats.map(seat => collectHumanVote(
      input.roomId,
      input.nightNumber,
      seat,
      input.graceMs,
    ))
  )

  // (3) Persist all votes as message:created events
  // Each is a step so retries dedupe via deterministic message id
  // (`wd-${roomId}-n${nightNumber}-${seatId}`).
  for (const vote of [...aiVotes, ...humanResults]) {
    await persistVoteMessage({ roomId: input.roomId, nightNumber: input.nightNumber, vote })
  }

  // (4) Tally — pure helper, no I/O
  const result = tallyVotes([...aiVotes, ...humanResults])
  return result
}

async function collectHumanVote(
  roomId: string,
  nightNumber: number,
  seat: Seat,
  graceMs: number,
): Promise<VoteRecord> {
  // 'use workflow' is INHERITED — this is a workflow-body helper, NOT a
  // step. It uses createHook + sleep which are workflow primitives.

  using hook = createHook<HumanDayVotePayload>({
    token: dayVoteToken(roomId, nightNumber, seat.id),
  })

  const TIMEOUT = Symbol('timeout')
  const winner = await Promise.race([
    hook.then(p => p),
    sleep(graceMs).then(() => TIMEOUT as typeof TIMEOUT),
  ])

  if (winner === TIMEOUT) {
    // Fallback: read presence, apply mode policy
    return await applyHumanFallback({ roomId, nightNumber, seat })
  }

  return { seatId: seat.id, target: winner.target, reason: winner.reason, source: 'human' }
}
```

### Token format

```
agora/room/${roomId}/mode/werewolf-day-vote/night/${nightNumber}/seat/${seatId}
```

- `mode/werewolf-day-vote/` namespace prefix matches the convention from open-chat (`mode/open-chat/`)
- `night/${nightNumber}/seat/${seatId}` keys per (game-night, seat) so a single werewolf game has DISTINCT tokens for each day-vote across multiple nights
- Pin the format with a unit test (mirrors `humanTurnToken` pin)

### Message ID prefix

```
wd-${roomId}-n${nightNumber}-${seatId}
```

`wd-` prefix avoids collision with `rt-` (roundtable) and `oc-` (open-chat) on `events_message_id_uq`.

### `applyHumanFallback` step

```ts
async function applyHumanFallback(input: { roomId, nightNumber, seat }): Promise<VoteRecord> {
  'use step'
  const presence = await getPresence(input.roomId, input.seat.id)
  const online = isOnline(presence)
  const fallback = getFallback('werewolf', 'day-vote') // { kind: 'abstain' }

  // Even if technically online, if they didn't respond within the grace
  // window, apply the policy. The presence read is for observability /
  // logging, NOT to override the policy.
  console.log(`[day-vote fallback] seat=${input.seat.id} online=${online} action=${fallback?.kind}`)

  if (!fallback) throw new FatalError(...)

  switch (fallback.kind) {
    case 'abstain':
      return { seatId: input.seat.id, target: 'skip', reason: 'no response', source: 'fallback' }
    case 'skip':
      return { seatId: input.seat.id, target: 'skip', reason: 'no response', source: 'fallback' }
    // ...
  }
}
```

### Open questions to resolve in 2.14

1. **Does `Promise.race(hook, sleep)` actually work in WDK?** The plan sketch assumes yes; not validated. If WDK requires hook + sleep to be separate steps with explicit cancellation, the shape differs.

2. **Hook disposal on race-loss** — when `sleep` wins the race, the `using hook` block should still dispose the hook cleanly (TC39 explicit resource management). Verify the disposal happens BEFORE the workflow advances to the next step.

3. **Replay semantics** — if the workflow crashes during day-vote and replays, what happens to:
   - In-flight AI votes: cached (step result), no re-generation. ✓
   - Human hooks already resumed: cached event, replays without re-blocking. ✓ (per WDK docs)
   - Human hooks NOT yet resumed at crash time: re-registered, sleep restarts. ⚠ This means the grace window resets on crash. Is that acceptable? Probably yes — better to give offline-during-crash humans another chance than aggressively fall back.

4. **Test infrastructure** — the open-chat integration tests use a `waitForRoomStatus` polling helper. Day-vote doesn't transition the room to 'waiting' (multiple parallel hooks; no single status). Need a different test pattern: probably register all hooks (via in-process resumeHook calls) BEFORE start(), or check hook storage directly.

## What this memo does NOT cover

- Replay UI compatibility (events-log gap from 4.5d-2.4 still present)
- Realtime UX events (`agent:thinking`, etc.) — werewolf legacy emits these; WDK doesn't. Acceptable per the durability contract.
- Werewolf prod deployment / canary
- Database schema changes — none needed. Migration 0010 already covers the events table for all modes.

## Decision points needing user input before 2.14 starts

1. **Grace window default** — 60s in the plan sketch. Confirm or adjust.
2. **In-flight game migration** — what happens to legacy werewolf rooms when 2.20 flips the default? They stay on `runtime: 'http_chain'` per the per-room flag (4.5d-1). Confirm this is the policy (no mid-game migration).
3. **Spike branch vs main** — should 2.12-2.14 land on a spike branch first (like 4.5d-2.0 did) or directly on main? The day-vote workflow can stand alone without breaking production werewolf, so direct-to-main is viable.
