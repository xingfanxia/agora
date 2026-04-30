# Phase 4.5d-2.12+ — Werewolf WDK Port

> Working design memo. Sequences werewolf → WDK migration. As of 2026-04-29: not started, scaffolding only.
>
> **Operating context (2026-04-29):** Agora has zero users. Validation = play actual games end-to-end in dev. Once a WDK path works for a mode, the legacy http_chain path for that mode is **deleted**, not preserved as opt-out. No soak windows, no canary rollouts, no cross-runtime equivalence tests for new modes. Integration tests stay valuable as fast feedback but they are not gating.

## Context

Roundtable and open-chat ship via the durable WDK runtime as of `a4e9045`. Werewolf is the last mode still bound entirely to the legacy `http_chain` tick path. Once werewolf's WDK port works, the entire `http_chain` infrastructure (the `runtime` column on `rooms`, `room-runtime.ts:advanceWerewolfRoom` / `advanceOpenChatRoom`, the cron tick sweeper for non-WDK rooms, `room-store-memory.ts` + cross-runtime equivalence tests, the `body.runtime` opt-out parameter on creation routes) becomes deletable.

Werewolf is qualitatively harder than the previous two modes:

| Aspect | Roundtable / Open-chat | Werewolf |
|---|---|---|
| Speaker selection | Round-robin | Phase-driven state machine (8+ phases) |
| LLM output shape | Plain text | Structured (Zod-typed votes / actions) |
| Human pause | One seat at a time | Multiple humans vote in parallel during day-vote |
| Timeouts | None — wait indefinitely | Grace window via `sleep(...)`, fall back on offline humans |
| Game state | Just turn counter | Roles, eliminations, witch potions, sheriff badge, guard last-protected, ... |

## Existing utilities (most of what we need already exists)

| What | Where | Status |
|---|---|---|
| Mode fallback registry | `packages/modes/src/fallback-policies.ts` | ✓ Complete. `getFallback('werewolf', 'day-vote')` returns `{ kind: 'abstain' }` |
| Seat presence (Postgres) | `apps/web/app/lib/presence.ts` | ✓ Complete. `getPresence` + `isOnline(presence, graceMs, now)` are pure helpers |
| Seeded role assignment | `packages/modes/src/werewolf/index.ts:assignRoles` | ✓ Deterministic |
| Decision schemas (Zod) | `packages/modes/src/werewolf/types.ts` | ✓ Day-vote, wolf-vote, witch-action, seer-check, hunter-shoot, guard-protect, sheriff schemas |
| Vote tally helper | `packages/modes/src/werewolf/phases.ts:tallyVotes` | ✓ Lift to a shared helper module |
| Real `createGenerateObjectFn` | `packages/llm/src/generate.ts:173` | ✓ Vercel AI SDK `generateObject` wrapper |
| WDK `sleep` primitive | `workflow/sleep.d.ts` | ✓ Three overloads (string / Date / ms) |
| WDK `createHook` | `workflow` | ✓ Used in open-chat already |

## Missing utilities

1. **Structured-output LLM factory wrapper** — `apps/web/app/lib/llm-factory.ts` already wraps `createGenerateFn` with the WORKFLOW_TEST mock seam. Add `createGenerateObjectFnFromFactory` that wraps `@agora/llm`'s `createGenerateObjectFn`. **No mock needed for the new factory** — validation is real games, not equivalence tests. If WORKFLOW_TEST=1 fires for some other test path, the factory can throw a clear error rather than silently mocking.

2. **`generateAgentDecision` step** — workflow step that takes (provider, model, systemPrompt, history, schema, instruction) and returns the structured object via `generateObjectFn`. New step in `apps/web/app/workflows/werewolf-workflow.ts`.

3. **Mode-fallback dispatch helper** — adapts a `FallbackAction` (kind: 'abstain' / 'skip' / etc.) into a vote payload appropriate to the phase. Pure logic, no I/O. Step or inline helper.

4. **Game-state derivation helper** — pure helper that takes the events log (since reset) and reconstructs the werewolf state (roles, eliminations, witch potions, etc.). Replaces `rehydrateWerewolfFromDb` from `room-runtime.ts`. WDK doesn't need rehydration — its replay is automatic — but the workflow body needs to compute the state to drive phase transitions. Read DB once at the start of each phase rather than threading state through every step.

## Sub-phase ladder

> Numbering continues from `2.11` (last shipped). Each row is one PR / commit.

| Sub-phase | Scope |
|---|---|
| **2.12** | Structured-output factory: `createGenerateObjectFnFromFactory` in `llm-factory.ts`. No mock. ~50 lines + smoke test. |
| **2.13** | `apps/web/app/workflows/werewolf-workflow.ts` skeleton: workflow body with phase-loop dispatch (`switch (currentPhase)`), `generateAgentDecision` step, `applyFallback` helper, vote-tally helper lifted from `packages/modes/src/werewolf/phases.ts`. No phase logic yet. |
| **2.14** | All NIGHT phases: `wolfDiscuss` (chat), `wolfVote` (structured), `witchAction` (structured), `seerCheck` (structured), `guardProtect` (structured). Sequential per-phase — easier than day-vote. Includes `dawn` computation phase (no speakers, just resolves wolf-kill + witch-poison + guard-saves and emits announcements). |
| **2.15** | DAY phases: `daySpeak` (round-robin chat), `dayVote` (the parallel hybrid AI+human vote with `Promise.race(hook, sleep)` for grace window), `lastWords` (chat for eliminated). Day-vote is the load-bearing piece; if `Promise.race(hook, sleep)` doesn't work in WDK as expected, this is where we find out. |
| **2.16** | Triggered phases: `hunterShoot` (fires on hunter death), `sheriffElection` (day 1), `sheriffTransfer` (sheriff death), idiot reveal mechanics. |
| **2.17** | API integration: `apps/web/app/api/rooms/werewolf/route.ts` constructs the WDK snapshot and calls `start(werewolfWorkflow, [...])`. **Default to wdk; no `body.runtime` opt-out.** |
| **2.18** | **Delete legacy** — remove `room-runtime.ts:advanceWerewolfRoom`, `room-runtime.ts:advanceOpenChatRoom`, `room-runtime.ts:rehydrateWerewolfFromDb`, the http_chain branches in `apps/web/app/api/rooms/route.ts` + `apps/web/app/api/rooms/open-chat/route.ts`, the `body.runtime` parameter, the `cron tick-all` sweeper for non-WDK rooms, and the `runtime` column on rooms (drizzle migration 0011: drop column). Plus drop `room-store-memory.ts` + cross-runtime equivalence tests + `WORKFLOW_TEST` env mock paths if no longer needed for any active test. |

After 2.18 lands: WDK is the only runtime. The phrase "http_chain" is gone from the codebase.

## 2.15 day-vote — detailed design (the load-bearing piece)

### Workflow body shape

```ts
// apps/web/app/workflows/werewolf-workflow.ts (excerpt)

import { createHook, sleep, FatalError } from 'workflow'

const DAY_VOTE_GRACE_MS = 45_000  // 45s per human seat

interface DayVoteInput {
  readonly roomId: string
  readonly nightNumber: number  // for hook-token namespacing
  readonly aliveSeats: readonly Seat[]
  readonly aliveTargetNames: readonly string[]
}

async function runDayVote(input: DayVoteInput): Promise<DayVoteResult> {
  // (called from the workflow body — inherits 'use workflow' context)
  const aiSeats = input.aliveSeats.filter(s => !s.isHuman)
  const humanSeats = input.aliveSeats.filter(s => s.isHuman)

  // (1) AI votes — workflow-level Promise.all over step calls. Each retry
  // recomputes deterministically (LLM hash mock in tests, real LLM at
  // runtime — but real LLM is fine, replay won't re-call it because step
  // result is cached).
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
  const humanVotes: VoteRecord[] = await Promise.all(
    humanSeats.map(seat => collectHumanDayVote(
      input.roomId,
      input.nightNumber,
      seat,
    ))
  )

  // (3) Persist all votes — each is a step with deterministic message id
  // (`wd-${roomId}-n${nightNumber}-${seatId}`) so retries dedupe at
  // events_message_id_uq.
  for (const vote of [...aiVotes, ...humanVotes]) {
    await persistVoteMessage({
      roomId: input.roomId,
      nightNumber: input.nightNumber,
      vote,
    })
  }

  return tallyVotes([...aiVotes, ...humanVotes], aliveSeats)
}

async function collectHumanDayVote(
  roomId: string,
  nightNumber: number,
  seat: Seat,
): Promise<VoteRecord> {
  // Workflow-body helper. createHook + sleep are workflow primitives.
  using hook = createHook<HumanDayVotePayload>({
    token: dayVoteToken(roomId, nightNumber, seat.id),
  })

  const TIMEOUT = Symbol('timeout')
  const result = await Promise.race([
    hook,
    sleep(DAY_VOTE_GRACE_MS).then(() => TIMEOUT as typeof TIMEOUT),
  ])

  if (result === TIMEOUT) {
    return await applyDayVoteFallback({ roomId, nightNumber, seat })
  }

  return {
    seatId: seat.id,
    target: result.target,
    reason: result.reason ?? '',
    source: 'human',
  }
}
```

### Token format
```
agora/room/${roomId}/mode/werewolf-day-vote/night/${nightNumber}/seat/${seatId}
```

### Message ID prefix
```
wd-${roomId}-n${nightNumber}-${seatId}
```
`wd-` namespace prevents collision with `rt-` (roundtable) and `oc-` (open-chat) on `events_message_id_uq`.

### Open question this validates
**Does `Promise.race([hook, sleep])` actually work in WDK?** The pattern is in WDK docs but never exercised in this codebase. If the `using hook = createHook(...)` resource-management semantics interact badly with the race (e.g., hook gets disposed while still pending and the race never resolves), we'll find out here. If it doesn't work, fall back to: register hook → start sleep step → if sleep returns first, manually dispose hook + apply fallback. More verbose but explicit.

## Validation plan (no equivalence tests)

After 2.17 lands, **play actual games**. Suggested matrix:

| Scenario | What to check |
|---|---|
| 4 AI vs 1 human, basic 7-role | Night flow correct, day-vote with 1 human votes, win condition fires |
| 9 AI no human | Pure AI playthrough; sheriff election, hunter trigger, idiot reveal all hit at least once |
| 2 humans + 7 AI, 1 human goes AFK day 1 | Grace window expires, fallback votes abstain, game continues |
| Two humans vote simultaneously | Both register; tally is correct |
| Human disconnects mid-night | Workflow doesn't pause for them at night phases (only day-vote and last-words have human-input) |

Each playthrough is the test. Bugs go in a follow-up commit, not a separate phase. After all five scenarios pass at least once, **2.18 starts** (legacy deletion).

## What's intentionally NOT in this plan

- Cross-runtime equivalence tests (no legacy to compare against once 2.18 lands)
- `WORKFLOW_TEST=1` mock for `generateObjectFn` (validation = real games)
- Soak windows / canary rollouts / `body.runtime` opt-out
- `git revert` rollback paths in commit messages
- `/schedule` agents to "monitor prod for incidents"

## Decisions made

- **Grace window** = 45s (between werewolf-client norms of 30-60s)
- **Spike branch** = no, direct to main. The new workflow file doesn't break anything until the API route opts in, and the API route only opts in once the workflow works.
- **In-flight game migration** = nothing to migrate (no users)
