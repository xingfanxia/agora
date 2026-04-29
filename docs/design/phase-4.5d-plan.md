# Phase 4.5d — Multi-Human Runtime (WDK + presence + fan-in)

> **Status**: V2 — audited 2026-04-28 (architect review + self-critique cycle)
> **Predecessor**: `phase-4.5-plan.md` (original 4.5a-d design)
> **Architectural anchor**: `docs/design/workflow-architecture.md` § 2026-04-28 update (WDK migration decision)

## Goal

Take Agora from "1 human + N AI" to "N humans + M AI" with predictable disconnect behavior, parallel vote fan-in, and a durable runtime that scales to Phase 7's 24h-suspend GM scenarios.

## Pre-shipped (recap)

Already on main (commits `c858213`, `5b73b6d`, `c01119c`):
- Supabase Auth (magic-link) + `allowed_emails` allowlist gate (migration `0007`)
- JWT seat invites — `POST /api/rooms/[id]/invites`, multi-human picker UI
- Mid-phase replay bugfix routing through `flow.onMessage`

The pieces below complete the milestone.

---

## 4.5d-1 — Presence + disconnection grace (~2-3 days, Tier 3)

**Why first**: 4.5d-2 (WDK fan-in) needs to read presence from inside `step.run()` bodies. Realtime is a non-deterministic side effect that breaks WDK replay; presence must be queryable from Postgres. So 4.5d-1's job is "make liveness Postgres-readable" *before* the WDK substrate lands.

### Schema additions

```sql
-- New: presence is persistent, NOT runtime-only
CREATE TABLE seat_presence (
  room_id uuid NOT NULL,
  seat_id text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  connection_count int NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, seat_id)
);

-- New: per-room runtime flag (consumed by 4.5d-2; added here so the 4.5d-1
-- migration is the only schema change needed before WDK rollout)
ALTER TABLE rooms ADD COLUMN runtime text NOT NULL DEFAULT 'http_chain'
  CHECK (runtime IN ('http_chain', 'wdk'));
```

### Tasks

- [x] Migration: `0008_seat_presence_and_runtime.sql` — `seat_presence` table + `rooms.runtime` column (commit `53abef2`; **applied to Supabase 2026-04-29** via `pnpm --filter @agora/db db:migrate`; verified: PK `(room_id, agent_id)`, FK `seat_presence_room_id_rooms_id_fk` ON DELETE CASCADE, CHECK constraint `rooms_runtime_check` ∈ {http_chain, wdk}, default `'http_chain'`).
- [x] Migration: `0009_seat_presence_last_seen_idx.sql` — partial index on `last_seen_at` for cron sweep efficiency (added during implementation, not in original spec). Applied 2026-04-29 in the same migrate run; verified `seat_presence_last_seen_idx` btree present.
- [x] Heartbeat endpoint: `POST /api/rooms/[id]/heartbeat` — token-gated, debounced 5s on client, updates `seat_presence.last_seen_at` (UPSERT) (commit `4d5bd43`, hardened in `591652a`)
- [x] Supabase Realtime presence channel per room — used for UI fan-out only (peer awareness, typing indicators); NOT the source of truth (commit `1fd997a`, in `useRoomLive`)
- [x] `useRoomLive` hook: Realtime subscription + heartbeat ticker (visibility-aware; no polling fallback needed because the heartbeat itself runs on a 5s interval) (commit `1fd997a`)
- [~] UI heartbeat indicator component — **partial**: `SeatPresenceIndicator` atom shipped (commit `c02f5d7`) but **NOT wired into mode views**. Reclassified to **4.5d-3** — see "Deferred to 4.5d-3" note below.
- [x] Mode fallback policies (one per turn type) — see table below. Implemented as a registry: `packages/modes/src/fallback-registry.ts` with `assertNeverFallback` exhaustiveness helper (commit `a108267`, 14 unit tests, 43/43 modes pass).
- [x] Multi-tab semantics: presence keyed on `(room_id, agent_id)`. Multiple tabs of the same seat → connected if ANY tab heartbeated within grace. Implemented via `ON CONFLICT (room_id, agent_id) DO UPDATE` in `lib/presence.ts` (commit `4d5bd43`).
- [ ] Mobile suspend microcopy: "Reconnecting…" → "Disconnected — taking action with default" if grace expires — **deferred to 4.5d-3** (needs UI surface).
- [x] Determinism: `flow.onMessage` and any 4.5d-2 step that needs liveness reads `seat_presence.last_seen_at` from Postgres, NEVER from Realtime. Enforced by `lib/presence.ts isOnline()` taking a `SeatPresenceRow` (Postgres-typed); no Realtime imports in `lib/`.

### Deferred to 4.5d-3 — UI integration

Wire-in of `SeatPresenceIndicator` into the mode views was deferred during implementation when the previous handoff's wire-in plan ("via `AgentList` `renderExtra`") proved structurally incorrect:

- **`AgentList` is unused by mode views.** Both `WerewolfView.tsx` and `RoundtableView.tsx` render seats through the v2 `RoundTable` → `AgentSeat` component pair (ellipse layout). `AgentList` (horizontal pill strip) only appears in the older v1 components.
- **`AgentData` wire type carries no `isHuman`.** The DB seat row stores `isHuman` (e.g. open-chat marks seats human via `humanSeatIds`, room-runtime sets `agent.config.isHuman`), but the `PollResponse.agents` shape is just `{id, name, model, provider}` — `isHuman` is stripped before reaching the client. The indicator's "AI seats render muted dot" branch needs this flag to be exposed.
- **No client-side data path from `seat_presence.last_seen_at` to the UI.** `useRoomLive` exposes a Realtime `peers: PeerPresence[]` set (binary in-channel/not-in-channel signal), not the timestamp-based green/amber/red state the indicator was designed to render. A new `GET /api/rooms/[id]/presence` endpoint + a polling client hook (or extension of `useRoomLive`) is required.

These together represent ~100-150 LOC of plumbing across ≥5 files (`theme.ts`, `room-runtime.ts`, new presence-route, new hook, `RoundTable`/`AgentSeat`, both views) — squarely 4.5d-3 scope, not 4.5d-1 wrap. The 4.5d-1 *exit criteria* do not depend on the visible indicator: backend fallbacks fire from `lib/presence.ts isOnline()` reading Postgres, regardless of UI state.

### Mode fallback policies

| Mode · Turn type | Fallback when human's grace expires |
|---|---|
| Werewolf · day-vote | Vote not counted (abstain). Majority computed among non-abstainers. |
| Werewolf · witch | Skip action — no save, no poison |
| Werewolf · seer | Skip check — no result revealed to anyone |
| Werewolf · guard | Skip protection |
| Werewolf · hunter | Hunter shoots no one |
| Werewolf · last-words | Silent elimination (no speech) |
| Werewolf · sheriff election | Withdraw candidacy automatically |
| Werewolf · sheriff transfer | Sheriff badge dropped (no successor) |
| Open-chat | Skip the human's turn, advance to next seat |
| Roundtable | Skip the human's turn (same as open-chat) |

### Exit criteria

- Human disconnect during day-vote: fallback fires within 30s
- Reconnect within grace: seat resumes mid-turn
- Multi-tab same seat: no conflicts; all tabs show same UI state
- iOS Safari background → lock screen → unlock within 30s: seat keeps turn

---

## 4.5d-2 — Parallel fan-in via WDK (~5-7 days, Tier 4 architectural)

Split into 4 sub-phases with a hard spike gate at the front.

### 4.5d-2.0 — WDK spike ✅ COMPLETE (GO — 2026-04-29)

Purpose: validate WDK API surface + cost + determinism before committing to the migration.

**Status**: ✅ GO recommendation. All 4 hard-exit conditions cleared. Branch `spike/4.5d-2.0-wdk-port` (5 commits, pushed). Findings doc: `docs/design/phase-4.5d-wdk-spike.md`.

- [x] Install `workflow ^4.2.4` + `@workflow/{ai,next,vitest}` packages — peer dep `next: '>13'` clears Next.js 16 (we're on 16.2.4, not 15 as originally noted)
- [x] Port open-chat orchestration to WDK — `apps/web/app/workflows/open-chat-spike.ts` (210 LOC). Mocked LLM + in-memory store; ~140 LOC of structural code vs the ~190 LOC of `advanceOpenChatRoom` + `/api/rooms/tick` chain it replaces
- [x] Determinism test (workflow-level): test #3 in `apps/web/tests/integration/open-chat-spike.integration.test.ts` validates OUR contract (no Math.random / Date.now in workflow body). WDK's step-result-caching contract trusted from substrate's own test suite (see spike doc §"Validated claims" #3 for the honest split)
- [x] Pricing analysis: ~1 invocation/turn either way. Worst-case envelope <$0.05/room compute; LLM dominates by 10-100×. Detailed in spike doc
- [x] Output: `docs/design/phase-4.5d-wdk-spike.md` — GO recommendation with risk register + durability-contract preview seeding 4.5d-2.1

**Hard-exit conditions** (all cleared):
- ✅ Open-chat port took ~3h focused work, well under 1 day
- ✅ Pricing envelope far under $0.50/room threshold
- ✅ Determinism property as stated holds (with honest scope split — see spike doc)
- ✅ WDK + Next.js 16 + Turborepo: type-check green across all 6 packages with WDK installed

### 4.5d-2.1 — Durability contract ✅ COMPLETE (2026-04-29)

**Status**: Appendix published in `docs/design/workflow-architecture.md` § "2026-04-29 — Durability Contract for WDK substrate". 8 rules covering idempotency, seq computation, no-realtime, no-wallclock-timers, single-mutation-entrypoint, scalar step inputs, mode-namespaced hook tokens, and module-state isolation. Cross-runtime equivalence is the binding meta-invariant. CI rules + per-rule tests specified.

Original 6 bullets expanded to 8 in the appendix — added Rules 6 (scalar step inputs) and 8 (module-state isolation) based on findings from the 4.5d-2.0 spike. Rule 7 (hook tokens) was also lifted from spike findings into the contract.

### 4.5d-2.2 — Migrate modes (~3-4 days, in this order)

**Order rationale**: simplest substrate first, fan-in last. Each mode validates a property the next depends on.

1. **Roundtable** (~0.5 day) — single-phase, no fan-in, currently on legacy `waitUntil`. Migrating to WDK simultaneously fixes the 4.5c "Roundtable still on legacy path" debt. Substrate sanity check #1. **🟡 Workflow scaffold landed 2026-04-29** (`apps/web/app/workflows/roundtable-workflow.ts`, build + types green). Compile-clean, real `createGenerateFn` + `appendEvent` integration, durability-contract-compliant. **Remaining**: API route integration (branch in `POST /api/rooms` on `runtime` flag), runtime flag wiring on new rooms, integration test against test DB.
2. **Open-chat** (~0.5 day, formalize from spike) — multi-turn round-robin, no fan-in. Substrate sanity check #2.
3. **Werewolf day-vote** (~1.5 days) — the actual feature. Hybrid AI+human fan-in. Pseudocode below.
4. **Werewolf night actions** (~0.5 day) — witch / seer / guard / hunter. Mostly sequential; opens hooks one seat at a time, not parallel. Easier than day-vote.

### 4.5d-2.3 — Test pyramid (~1 day)

Three layers, **no real timers anywhere**:

- **Unit (`tests/runtime/`)**: fan-in helper with mocked WDK hooks. Inject hook resolutions and timeout signal at controlled points. Test all combinations: all-humans-vote, all-timeout, mixed, AI-only, etc.
- **Integration (`tests/integration/`)**: insert synthetic `human:input` events into the events table at controlled `created_at` timestamps; run advanceRoom; verify state. No `setTimeout`, no real `sleep()`. Use Drizzle test transactions for isolation.
- **E2E (`tests/e2e/playwright/`)**: one Playwright multi-context test (two browser contexts = two humans). Smoke only — verifies the wiring is connected, NOT timing properties. Mark with `@smoke`.

Exit checklist additions:
- [ ] No `setTimeout(..., ms)` with `ms > 0` in test files (grep-checked in CI)
- [ ] No `await new Promise(r => setTimeout(r, X))` in test files
- [ ] Determinism test (kill WDK mid-step) passes 10 consecutive runs

### Per-room runtime flag mechanics

- New rooms created post-deploy: `runtime = 'wdk'` (config flag in room-creation API; can be toggled per-environment)
- Old rooms (created before deploy): `runtime = 'http_chain'` (default), stay there forever
- `advanceRoom(roomId)` top-level branch: load room → check `room.runtime` → dispatch to legacy or WDK orchestrator
- No mid-game switching. A room's runtime is fixed at creation.
- Cron sweep `tick-all` continues firing for `runtime = 'http_chain'` rooms only (WDK has its own retry semantics — running cron over WDK rooms would double-fire steps)

### 4.5d-2 exit criteria

- 2+ humans vote in parallel during werewolf day-phase on a `runtime=wdk` room
- Timer-only fallback fires correctly when a human goes offline mid-vote
- AI seats produce votes silently (no information leak to humans before tally)
- `runtime=http_chain` rooms still play and replay correctly (no regression)
- Cross-runtime determinism test green

### Worked code sketch — werewolf day-vote under WDK

> **Note**: this is a draft. The exact WDK API names (`step.run`, `createHook`, `sleep`) match Vercel's docs as of 2026-04-28 GA, but signatures may shift. Validate during the 4.5d-2.0 spike.

```ts
// apps/web/app/lib/wdk/werewolf-flow.ts
import { step, createHook, sleep } from 'workflow'
import { flowOnMessage } from '@/lib/room-runtime'
import { getModeFallback } from '@/lib/mode-fallbacks'
import { db } from '@agora/db'

export async function dayVoteStep(roomId: string, alivePlayers: Seat[]) {
  return await step.run('day-vote', async () => {
    const aiSeats = alivePlayers.filter(s => s.kind === 'ai')
    const humanSeats = alivePlayers.filter(s => s.kind === 'human')

    // (1) AI votes inline. Synchronous within the step, deterministic per seed.
    //     Critically: collected silently — NOT broadcast until tally. Preserves
    //     game-balance property of simultaneous-secret day-vote.
    const aiVotes = await Promise.all(
      aiSeats.map(seat => generateVote(seat, gameState))
    )

    // (2) Open one hook per human seat. Each waits for a `human:input` event
    //     keyed on (roomId, seatId). The hook is a WDK durable suspend point —
    //     surviving deploys, function restarts, etc.
    const humanHooks = humanSeats.map(seat =>
      createHook<Vote>(`vote-${roomId}-${seat.id}`)
    )

    // (3) Race human hooks against 60s timer. WDK's sleep() is durable
    //     (survives function lifecycle); setTimeout would not.
    const timeoutSentinel = Symbol('timeout')
    const result = await Promise.race([
      Promise.all(humanHooks.map(h => h.read())),
      sleep('60s').then(() => timeoutSentinel)
    ])

    // (4) For each human seat: if their hook fired, use vote; otherwise
    //     read presence from Postgres and apply fallback.
    const humanVotes = await Promise.all(humanSeats.map(async (seat, i) => {
      if (result !== timeoutSentinel && result[i]) return result[i]

      // Presence read — Postgres, NOT Realtime (deterministic)
      const presence = await db.query.seatPresence.findFirst({
        where: (p, { and, eq }) => and(
          eq(p.roomId, roomId),
          eq(p.seatId, seat.id)
        )
      })
      const isOnline = presence && (Date.now() - presence.lastSeenAt.getTime() < 30_000)

      // Apply mode fallback (no preference / abstain for werewolf day-vote)
      return getModeFallback('werewolf', 'day-vote', { seat, online: isOnline })
    }))

    // (5) Persist votes via flow.onMessage. seq is computed INSIDE this call
    //     against fresh DB state — WDK retry produces no-op on conflict.
    const allVotes = [...aiVotes, ...humanVotes]
    for (const vote of allVotes) {
      await flowOnMessage(roomId, { type: 'vote', ...vote })
    }

    return tallyVotes(allVotes)
  })
}
```

**Properties preserved by this shape:**
- AI votes do not leak to humans before tally (collected silently in step body)
- Determinism: hook resolution order doesn't affect outcome (votes commute via tally)
- Idempotency: replayed step recomputes votes deterministically (AI seeded, humans from hook log) and re-`flow.onMessage` is a no-op
- Disconnect detection: read from Postgres `seat_presence`, not Realtime
- Cross-runtime replay: events table reflects the same vote sequence whether run on http_chain or WDK

---

## 4.5d-3 — Multi-human exit verification + cross-runtime determinism + UI integration (~2-3 days, Tier 3)

**Note (2026-04-28)**: estimate revised from 1-2 days → 2-3 days to absorb the SeatPresenceIndicator wire-in that turned out to be infeasible inside 4.5d-1's scope (see "Deferred to 4.5d-3" note in 4.5d-1 section above for the architectural reason — handoff incorrectly assumed `AgentList`/`renderExtra` integration but mode views use `RoundTable`/`AgentSeat` instead).

### UI integration (carried from 4.5d-1) ✅ Shipped 2026-04-29

Commits `ef08100` … `13542e6` (4 atomic commits). Tier 3 review complete (code-reviewer agent: APPROVE; two SUGGESTIONs applied — `useMemo` on labels bag, identity-preserving `setPresence`). Typecheck green across all 6 packages; 43/43 modes tests pass.

- [x] Expose `isHuman` on `AgentData` wire type (`apps/web/app/room/[id]/components/theme.ts`) — `room-store AgentInfo.isHuman` already flowed through the messages route untouched at runtime; only the TS surface needed declaring (commit `ef08100`)
- [x] Update `/api/rooms/[id]/messages` poll response to pass `isHuman` through — verified no-op: route already returns `snapshot.agents` directly via `getRoomSnapshot`
- [x] New `GET /api/rooms/[id]/presence` endpoint — thin shim over `getRoomPresence`; access model matches `/messages` (no auth — room URL is the boundary; documented inline) (commit `ef08100`)
- [x] New `usePresenceMap(roomId)` client hook — polls 5s, visibility-aware, identity-preserving setState short-circuit. Deliberately separate from `useRoomLive` (write-as-seat vs read-all-seats lifecycles) (commit `bab04e6`)
- [x] Add `lastSeenAt?: string | null` and `isHuman?: boolean` to `AgentSeatProps`. `RoundTableAgent extends Omit<AgentSeatProps, 'onClick'>` so the props propagate to `RoundTable` automatically (commit `c17fe7c`)
- [x] Render `<SeatPresenceIndicator>` in `AgentSeat` inline-left of the name. Hidden for AI seats and eliminated seats — strikethrough already communicates "out of game"; a status dot would be misleading (commit `c17fe7c`)
- [x] Plumb `presenceMap` through `WerewolfView` + `RoundtableView` → `tableAgents` memo → `RoundTable` → `AgentSeat` (commit `13542e6`)
- [x] i18n strings — `room.presence.{online,reconnecting,disconnected,neverSeen,aiSeat}` in en.json + zh.json. `SeatPresenceIndicator` accepts a `labels` prop bag; `AgentSeat` resolves via `useTranslations('room.presence')` once and memoizes (commit `c17fe7c`)
- [~] Mobile-suspend microcopy — i18n strings shipped (above). Mobile-specific tooltip toggling (e.g. show on tap/long-press) deferred — touch interactions on `title` attribute are platform-dependent; a dedicated tooltip component is its own scope.

### Verification (original 4.5d-3 scope)

- [x] **Playwright E2E test harness** — `@playwright/test ^1.59.1` + chromium binary installed in apps/web; `playwright.config.ts` with auto-spawn `webServer` (uses `pnpm dev`); `pnpm e2e` + `pnpm e2e:ui` scripts wired; one passing `tests/e2e/smoke.spec.ts` proving the harness works (commit `f6e14fd`). Unblocks the multi-context tests below.
- [ ] **2-human-7-AI werewolf E2E** on `runtime=wdk` room: full game, manual playthrough + Playwright multi-context smoke (harness exists; needs LLM mocking strategy + room-creation flow before this can be written)
- [ ] **Disconnection recovery**: kill one human's tab during day-vote → fallback fires → reconnect within grace → seat resumes mid-game (or correctly applies default if grace expired). `BrowserContext.setOffline(true)` is the toggle; presence indicator turn red within 30s is the assertion.
- [ ] **Cross-runtime replay determinism test**: take one HTTP-chain-era completed game (any from prod) + one WDK-era completed game; replay both; assert identical event sequences (BLOCKED on 4.5d-2 shipping)

### Docs

- [x] Update `docs/design/phase-4.5-plan.md` with as-built notes — added "As-built note" pointing to phase-4.5d-plan.md as canonical V2; sub-phase status table; V1 task list reconciled against shipped reality (some items shipped, some deprecated, some deferred to 4.5d-2 WDK substrate); files-as-built section.
- [x] Update `docs/architecture.md` — added §7.1.x "Phase 4.5d — Liveness + Runtime Flag" covering seat_presence + rooms.runtime + multi-tab semantics + Postgres-truth-not-Realtime reasoning + mode fallback registry. Also added a status note at top of §7 acknowledging schema drift (canonical schema lives in `packages/db/drizzle/`). The original "waitUntil section" item didn't apply — architecture.md never mentioned `waitUntil()`; the runtime evolution is captured in the new subsection instead.
- [ ] Mark 4.5d ✅ DONE in `docs/implementation-plan.md` (after 4.5d-2 + remaining 4.5d-3 verification items complete)

### Exit (whole 4.5d milestone)

The original 4.5d exit criterion stands: **2-human-7-AI werewolf completes including day-vote fan-in + disconnection recovery**. V2 adds: cross-runtime replay determinism test green; both `runtime` values supported indefinitely.

---

## Effort summary (revised vs V1)

| Sub-phase | V1 estimate | V2 estimate | Delta reason |
|---|---|---|---|
| 4.5d-1 | 2 days | 2-3 days (shipped) | + multi-tab/mobile spec, + seat_presence schema; UI indicator wire-in reclassified to 4.5d-3 mid-flight |
| 4.5d-2 | 3 days | 5-7 days | + spike gate, + durability contract, + per-room flag, + 4 modes vs 1, + test pyramid |
| 4.5d-3 | 1-2 days | 2-3 days | + UI indicator wire-in (`AgentData.isHuman` exposure, GET `/presence` endpoint, polling hook, RoundTable/AgentSeat plumbing) inherited from 4.5d-1 |
| **Total remaining (after 4.5d-1)** | **5-6 days** | **7-10 days** | More realistic for tier-4 architectural migration |

---

## Open verification items (carried from workflow-architecture.md 2026-04-28 update)

These are answered by the spike, NOT deferred:

- [ ] WDK pricing model for 10-human room — answered in 4.5d-2.0
- [ ] WDK GA telemetry concerns — answered by determinism test in 4.5d-2.0
- [ ] `step.run()` semantics around deterministic agent-ID seeding — validated in 4.5d-2.0 spike test

---

## Audit trail

- **V1**: committed `8291f97` 2026-04-28 — initial sub-phase split, sound structure, gaps in durability + hybrid + tests
- **V2**: this doc, 2026-04-28 — addresses 10 architect findings + 6 self-critique findings via durability contract, per-room flag, worked pseudocode, spike gate, test pyramid, mode fallback enumeration

Critique cycles ran via `/mtc` (architect agent independent review + project-context self-critique → synthesis).
