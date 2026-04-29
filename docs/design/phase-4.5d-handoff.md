# Phase 4.5d — Handoff for next session

> **Date written**: 2026-04-29
> **Target**: Next Claude session starting fresh after `/clear`
> **Branch**: `main` — clean
> **Last commit**: `d6b1255` — `docs(4.5d-3): tick verification — Playwright harness landed`

---

## Quick Start

```bash
cd /Users/xingfanxia/projects/products/agora
git log --oneline -12                         # see this session's 9 commits
pnpm check-types                              # 6 packages green
pnpm --filter @agora/modes test               # 43/43 mode tests pass
pnpm --filter @agora/web e2e                  # Playwright smoke green (~5s cold)
```

Canonical plan: `docs/design/phase-4.5d-plan.md` (V2, audited via `/mtc`).
Parent plan: `docs/design/phase-4.5-plan.md` (reconciled this session).

---

## What's done in 4.5d

### 4.5d-1 — Presence + disconnection grace ✅ Backend complete

Commits `53abef2` … `c02f5d7` (previous session) + wrap commit `a45eb73` (this session).

- Migrations `0008_seat_presence_and_runtime.sql` + `0009_seat_presence_last_seen_idx.sql` **applied to Supabase 2026-04-29**. Schema verified via direct DDL query (PK on `(room_id, agent_id)`, FK CASCADE to `rooms.id`, CHECK constraint `runtime ∈ {http_chain, wdk}`, btree index on `last_seen_at`).
- Heartbeat endpoint `POST /api/rooms/[id]/heartbeat` — UUID-validated, agent-in-snapshot-checked, structured-logged, DB-layer rate-limited via `setWhere now() - 1s`.
- `lib/presence.ts` — `upsertPresence`, `getPresence`, `getRoomPresence`, `isOnline` (clock-injectable for tests). Postgres-truth, never reads Realtime.
- `useRoomLive` hook — Realtime subscription + visibility-aware 5s heartbeat ticker.
- Mode fallback policy registry — `packages/modes/src/fallback-registry.ts` covering all werewolf turns (day-vote / witch / seer / guard / hunter / last-words / sheriff election / sheriff transfer) + open-chat + roundtable. `assertNeverFallback` exhaustiveness helper. 14 unit tests.

### 4.5d-3 UI integration ✅ Shipped

Commits `ef08100` … `13542e6` (this session, 4 atomic).

- `GET /api/rooms/[id]/presence` — thin shim over `getRoomPresence`. No auth (matches `/messages` access model — room URL is the boundary).
- `usePresenceMap(roomId)` hook — polls `/presence` every 5s, visibility-aware, identity-preserving setState short-circuit (kills dead-tick re-renders on quiet rooms).
- `AgentData.isHuman?: boolean` exposed on the wire type. (Already flowed at runtime; only TS surface needed declaring.)
- `SeatPresenceIndicator` extended with `labels?: SeatPresenceLabels` prop bag for i18n. English defaults preserved for isolation testing.
- `AgentSeat` renders the indicator inline-left of the name when `isHuman && !eliminated`. Resolves labels via `useTranslations('room.presence')` + `useMemo`.
- `WerewolfView` + `RoundtableView` call `usePresenceMap` and feed `lastSeenAt` + `isHuman` per agent into `RoundTableAgent`.
- i18n keys `room.presence.{online,reconnecting,disconnected,neverSeen,aiSeat}` in en.json + zh.json.

### 4.5d-3 docs ✅ Shipped

Commits `2bb4e6a`, `518c0e7`, `3c2060d` (this session).

- `docs/architecture.md` — added `§7.1.x Phase 4.5d — Liveness + Runtime Flag`. Plus a status note at top of §7 acknowledging the schema below has drifted from production (canonical schema lives in `packages/db/drizzle/`).
- `docs/design/phase-4.5-plan.md` — reconciled with as-built reality (sub-phase status table, V1 task list reconciled, files-as-built section).

### 4.5d-3 verification harness ✅ Shipped

Commit `f6e14fd` (this session).

- `@playwright/test ^1.59.1` installed in `apps/web` + chromium browser binary.
- `apps/web/playwright.config.ts` — chromium-only, auto-spawns `pnpm dev` via `webServer` (120s timeout), reuses existing server outside CI.
- `apps/web/tests/e2e/smoke.spec.ts` — passing test (~675ms warm, ~5.3s cold) verifying home page renders.
- `pnpm e2e` + `pnpm e2e:ui` scripts wired.

---

## What's left in 4.5d

### 4.5d-3 verification body — needs LLM mocking decision

Not yet done; harness now exists.

- [ ] **2-human-7-AI werewolf E2E** (Playwright multi-context). Blocked on LLM mocking strategy — see "Open decisions" below.
- [ ] **Disconnection recovery test**. Use `BrowserContext.setOffline(true)` to kill one tab during day-vote; assert dot turns red within 30s; assert fallback fires; assert reconnect resumes.
- [ ] **Cross-runtime replay determinism**. BLOCKED on 4.5d-2 shipping — needs both `http_chain` and `wdk` rooms to compare event sequences.
- [ ] **Mobile-suspend tap-tooltip**. i18n strings shipped; the actual touch interaction (tap to show tooltip on a `title` attribute, which Mobile Safari doesn't surface) is its own UX scope.

### 4.5d-2 — Parallel fan-in via WDK ⏳ Not started

**Tier 4 architectural. Needs fresh `/big-task` invocation.** The handoff originally written said "parallel-worktree + spike GATE + durability contract appendix" — that ceremony still applies.

Plan in `phase-4.5d-plan.md` lines 80-150:

1. **4.5d-2.0 — WDK spike** (~0.5-1 day, GATE). Port one phase of open-chat to WDK. Determinism test (kill -9 the runtime mid-step; verify post-restart event sequence matches). Pricing model. Output: `docs/design/phase-4.5d-wdk-spike.md` with go/no-go recommendation. Hard exit conditions: spike >1 day, p99 cost >$0.50/room, divergent events on kill/restart, package incompatibility with Next.js 15.
2. **4.5d-2.1 — Durability contract** (~0.5 day, design only). Append to `docs/design/workflow-architecture.md` defining: idempotent step bodies, seq computed inside step (prevents WDK-retry seq collision), no Realtime reads in steps, `flow.onMessage` as single mutation point, no wallclock timers.
3. **4.5d-2.2 — Migrate modes** (~3-4 days). Order: roundtable → open-chat → werewolf day-vote (hybrid AI+human, no info-leak) → werewolf night actions.
4. **4.5d-2.3 — Test pyramid** (~1 day). Unit (mocked hooks) + integration (event injection, no real timers) + E2E (Playwright multi-context smoke — harness now exists). CI rule: no `setTimeout(..., ms>0)` in test files.

Per-room runtime flag (`rooms.runtime`): NEW rooms = `'wdk'` post-spike; OLD rooms = `'http_chain'` forever. No mid-game switching. `tick-all` cron only sweeps `http_chain`.

---

## Open decisions (need answers before continuing)

### LLM mocking strategy for E2E tests

Multi-context werewolf E2E needs deterministic agent responses. Options:

| Option | Pros | Cons |
|---|---|---|
| **MSW (Mock Service Worker)** intercepting OpenAI/Anthropic/Gemini REST calls | Works at network layer; no app-code changes; Vercel AI SDK calls go through fetch | Setup complexity; one mock per provider's response shape |
| **Inject mock LLM provider via env var** (e.g. `AGORA_LLM_PROVIDER=mock`) | Simplest; one code path | Couples app code to test concerns; production code carries a "mock" branch |
| **Record/replay** real LLM calls with a recording fixture | Realistic; deterministic on replay | First-record run is slow + costs $; fixture rot when prompts change |

Decide before writing the 2-human-7-AI test. Recommendation: **MSW** — it's the cleanest separation, app code stays untouched, and the mock fixtures become test data files that live with the test.

### Whether to make `usePresenceMap` poll cadence configurable per-mode

Currently hardcoded to 5s. Open-chat with 6 participants doesn't need 5s precision; werewolf day-vote during a 30s grace window does. Tunable via `usePresenceMap(roomId, { intervalMs })`. Probably defer until 4.5d-2 lands and we have real production traffic to tune against.

### Sidebar tagline — visible on home page or only in nav?

The smoke test originally tried to assert on `landing.tagline` (`"Where AI minds gather to debate, investigate, and play..."`). It's only rendered inside `Sidebar.tsx`, not on the home page. Either:
- Move tagline up to the home page hero block (changes design)
- Leave it sidebar-only (current state — smoke test asserts on `hero.subtitle` instead)

Defer — not blocking anything.

---

## Critical constraints (don't break)

1. **Don't unauthenticate `/heartbeat`.** It writes to `seat_presence` which influences WDK fallback decisions in 4.5d-2. The current shape — Bearer seat-token must match `(roomId, agentId)`, OR session-cookie owner — is load-bearing. Adding a new write endpoint to that auth shape needs the same checks.

2. **Don't read presence from Realtime in any step body or server-side decision path.** The whole point of the 4.5d-1 architecture is that `seat_presence.last_seen_at` (Postgres) is the source of truth so WDK steps stay deterministic. `useRoomLive`'s Realtime peers list is UI-only.

3. **Don't break the wire type AgentData.** `isHuman?: boolean` was added; consumers fall back to `false`. If you remove the optional and make it required, observability page + replay page + InvitePanel may need updates.

4. **Don't change `lib/presence.ts isOnline()` signature.** It takes `(presence, graceMs?, now?)` so tests can inject a fixed clock. WDK steps in 4.5d-2 will call it with a deterministic `now` derived from event time, NOT `Date.now()`.

5. **`rooms.runtime` is set at room creation only.** No mid-game switching. The CHECK constraint enforces values; the code paths assume the flag is immutable per room.

6. **Migrations 0008 + 0009 are applied; do not re-run.** Both are idempotent (`IF NOT EXISTS`), so re-running is safe but pointless. Don't include them in any "apply migrations" script as a fresh deploy.

---

## Suggested execution order for next session

If you have ~2-4 hours and want bounded value: **4.5d-2.0 spike**.

```bash
/clear
# then
/big-task 4.5d-2.0 — WDK spike to port open-chat
```

If you have ~1-2 hours and want to extend test coverage: **multi-context E2E**.

```bash
/clear
# answer the LLM mocking question first, then
/big-task 4.5d-3 multi-context werewolf E2E with MSW
```

If you have <1 hour and want a small win: **mark 4.5d-3 partial-complete in implementation-plan.md**, run `/neat-freak`, push.

---

## Useful one-liners

```bash
# Verify presence schema is intact
pnpm exec tsx <(cat <<'EOF'
import { config } from 'dotenv'
config({ path: '../../.env' })
const { getDirectDb } = await import('./packages/db/src/client.js')
const { sql } = getDirectDb()
console.log(await sql`SELECT * FROM seat_presence LIMIT 5`)
console.log(await sql`SELECT id, runtime FROM rooms LIMIT 5`)
await sql.end()
EOF
)

# Hit the new presence endpoint in dev
curl http://localhost:3000/api/rooms/<roomId>/presence | jq

# Run only the modes tests (fastest signal)
pnpm --filter @agora/modes test

# Find all places that consume usePresenceMap or AgentData.isHuman
grep -rn "usePresenceMap\|isHuman" apps/web/app --include="*.tsx" --include="*.ts" | grep -v node_modules
```

---

## What I learned that may help future-me

- The previous session's handoff said "wire SeatPresenceIndicator into AgentList via renderExtra in WerewolfView / RoundtableView / OpenChatView." This was wrong on three counts: AgentList isn't used by mode views (they use v2 RoundTable/AgentSeat), AgentData lacked `isHuman` on the wire type, and there's no OpenChatView (just Werewolf + Roundtable). The actual wire-in took ~280 LOC across 9 files. **Read the actual file structure before trusting handoff specifics.**
- `architecture.md` describes a V1 schema that doesn't match production. Don't trust it for current schema info — read `packages/db/drizzle/*.sql` instead. (Same applies to V1 plans; trust as-built status tables in V2 docs.)
- The poll endpoint already passes `isHuman` through at runtime — the DB stores it on `rooms.agents` JSONB and `getRoomSnapshot` returns it untouched. **The only fix needed was declaring it on the TS interface.** Next time something looks like it needs server-side plumbing, check if it's already flowing.

---

## Memory captured this session

- `~/.claude/projects/.../memory/feedback_autonomous_review.md` (carried from previous session): user expects code review on my own commits during /big-task autonomous runs; never ask user to review.
