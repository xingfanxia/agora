# Session 7 — Handoff (audit + P1 + P2)

> **Status:** 2026-04-30, end of session 7. Three pieces of work shipped. Audit + P1 are merged on `main`; P2 is opened as PR #1 awaiting real-game playthrough validation.

## TL;DR

Session 6's queue listed an audit + four UX phases (P1 → P5) carried over from real-game validation findings. Session 7 took that queue and:

1. **Audit** — verified roundtable + open-chat have NO seat-id continuity bug (the helper `buildTeamSnapshot()` preserves `agent.id` end-to-end via SQL JOIN invariant; werewolf was the outlier because it bypassed the helper). Surfaced a different gap: roundtable silently dropped `humanSeatIds`. Stopgapped via picker hide.
2. **P1** — `WorkflowWarmupBanner` shipped across all three modes. Shows when `status === 'running' && latestByAgent.size === 0`. zh + en. Multipass review applied.
3. **P2** — multi-human lobby gate + roundtable humans (the gap surfaced in the audit). 6 commits on a feature branch, ~1100 LOC across 22 files. Multipass review applied. PR opened.

This doc is the bridge: where each piece lives, what's pending, and how to pick up next.

---

## What's on `main`

Three commits past session 6's last:

| Commit | What | Notes |
|---|---|---|
| `b4d6583` | docs: cross-mode seat-id audit + roundtable humans picker stopgap | `docs/design/session-7-cross-mode-audit.md` + 1-line picker conditional in `rooms/new/page.tsx` (later reverted in P2 wave 4) |
| `b5eba45` | feat(room): warmup banner across all modes — P1 | New `WorkflowWarmupBanner.tsx`; wired into WerewolfView + RoundtableView; zh/en `room.warmup` keys |
| `129416f` | fix(room): warmup banner — apply code-reviewer findings | Drop redundant `?? null` coalesce; add doc-comment explaining the warmup-only invariant; align "30-90s" → "30-60s" |

**Pending real-game validation on main:** the warmup banner only shows for 30-60s after clicking 开始 in any of the three modes. The user's next playthrough confirms it appears + disappears at the right moment. Pure visual; no code path the user could break.

---

## What's on `feat/p2-lobby-gate-roundtable-humans` (PR #1)

PR: https://github.com/xingfanxia/agora/pull/1

Six commits, one new architectural seam (lobby gate), one feature complete (roundtable humans), ~1100 LOC.

### What it ships

**Lobby gate (cross-mode infrastructure):**
- `RoomStatus` adds `'lobby'` (TS-only — column is plain text, no DDL migration).
- `markSeatReady(roomId, agentId)` — atomic JSONB merge of `gameState.seatReady[agentId] = true` via single `jsonb_set` UPDATE guarded by `WHERE status = 'lobby'`. Atomicity is SQL-level; two humans clicking ready concurrently can't lose updates.
- `flipLobbyToRunning(roomId)` — CAS via `UPDATE ... WHERE status='lobby' RETURNING`. First caller wins; the rest get `false`. Naturally idempotent.
- `apps/web/app/lib/lobby.ts:resolveLobby` — reads room, checks all-humans-ready (or skips for `force=true`), tries the CAS flip, on win calls `dispatchWorkflowStart` + strips `seatReady` cruft from gameState. On workflow start failure: marks room 'error'.
- `dispatchWorkflowStart` reconstructs the workflow input from persisted state (`agents`, `roleAssignments`, `modeConfig`). Each mode pulls what it needs:
  - Roundtable + open-chat: `AgentInfo.systemPrompt` (already baked by `buildTeamSnapshot`).
  - Werewolf: also `AgentInfo.systemPrompt` (now persisted at create time so dispatch doesn't re-run `buildRoleSystemPrompt`).
- New endpoints: `POST /api/rooms/[id]/seats/[agentId]/ready` (Bearer seat-token OR owner) + `POST /api/rooms/[id]/start` (owner force-start).
- `LobbyView.tsx` — cross-mode UI shown when `status === 'lobby'`. Per-seat ready badges, "I'm ready" button for the viewer's own seat, "Force start" button for the owner.

**Roundtable humans (closes audit-surfaced gap):**
- `RoundtableAgentSnapshot.isHuman?: boolean`.
- `roundtableHumanTurnToken(roomId, turnIdx)` export.
- Per-turn loop branches on `isHuman`: `createHook` + `markWaitingForRoundtableHuman` + `await hook` + `persistRoundtableHumanMessage` + `markRoundtableRunningAgain`. Mirrors open-chat's pattern (3 step helpers duplicated, not factored — only 2 modes today).
- Roundtable branch added to `/api/rooms/[id]/human-input/route.ts` between the open-chat and werewolf branches.
- The `b4d6583` picker stopgap is reverted; `rooms/new` shows the human-seats picker for all three modes again.

### Multipass review applied

Code-reviewer agent ran on the diff. Findings + fixes (commit `4bdae67`):
- HIGH: `memCreateRoom` was hardcoded to `status='running'` instead of `args.initialStatus ?? 'running'`. Cross-runtime equivalence tests under `WORKFLOW_TEST=1` couldn't exercise the lobby gate. Fixed.
- MEDIUM: `useRoomPoll` didn't poll fast in `'lobby'` (defaulted to 5s). Added to fast branch (1s).
- MEDIUM: `StatusPill` in both view files accepted `'lobby'` in the type union but the chained ternary mapped it to red error styling (latent landmine if a future refactor of `page.tsx` slips the lobby branch). Narrowed StatusPill input type to exclude `'lobby'`; call sites cast `status === 'lobby' ? 'running' : status` with documenting comment.
- MEDIUM: `replay/[id]/page.tsx` reconstructed `status` with narrow union — added comment explaining why `'lobby'` / `'waiting'` are intentionally excluded for replays.
- LOW: `seatReady` cruft cleanup added at the single post-flip call site.
- NIT: dropped `✓` glyph in LobbyView (kept the text label only).
- NIT: extracted `WEREWOLF_AGENT_PERSONA` constant — both create-time + lobby-resolve paths reference one source.

Skipped per pre-users discipline: contract tests, integration tests for the new endpoints. Validation = real-game playthroughs (pre-users feedback rule).

### Pending real-game validation (the actual quality gate)

Before merge, exercise these 5 flows:

1. Roundtable, 1 human + 4 AI. Pick a seat in `/rooms/new` → land at lobby UI → click ready → workflow starts → human's turn arrives → submit text → next agents respond.
2. Werewolf, 1 human + 5 AI. Same shape; day-vote panel should activate after night phase (existing flow, lobby gate sits before it).
3. Open-chat, 2 humans (owner + invitee via invite URL). Owner readies → invitee opens URL → readies → workflow starts.
4. Owner force-start on a half-ready room.
5. Pure-AI room (no humans). No lobby UI; behavior identical to pre-P2.

If any flow surfaces a bug, file in this session and patches land on the same branch.

---

## What's queued (post-P2-merge)

From the original session-6 + session-7 audit queues:

### P3 — Human display name (medium, ~150-200 LOC)

User: "as a human player I am still 林溪 the agent seat I replaced". Want: human picks own name (or default to user's auth display name) so messages render as the human's identity.

Sketch:
- Add `humanDisplayName?: string` to `AgentInfo`.
- `ClaimSeat.tsx` prompts for name on claim.
- Owner-as-player: name field in `rooms/new` next to the human-seats picker.
- Workflows' persistence steps read `humanDisplayName ?? agent.name` for the chat message's senderName.

Applies to all 3 modes.

### P4 — Sidebar layout refactor (large, ~300+ LOC)

User: "for round info and actiontimeline, player info, i think sidebar makes more sense". Currently chat-mode views have all info inline; table-mode has a sidebar but for chat (not state).

Sketch:
- Right sidebar in chat mode: phase indicator (DayNightBadge for werewolf), round counter, action timeline (Timeline.tsx exists, not wired into werewolf), player roster with role-aware status.
- Collapsible. Shared chrome across all 3 modes; each mode supplies its own contents.

### P5 — Localize private-channel werewolf messages (small)

Witch's "Saves / Uses POISON / Pass", Seer's "Investigation: X is/is not a werewolf", Guard's "Protects X tonight: …", wolf-vote tally announcement. Visible only to the seat with that role (and spectator). Phase functions already accept `language`; mechanical work to thread `werewolfStrings(language)` calls into the remaining emit sites.

---

## Decisions made — DO NOT re-litigate

From the audit:
- Roundtable + open-chat have NO seat-id continuity bug. The session 6 hypothesis was based on incorrect read of the code. `buildTeamSnapshot()` preserves `agent.id` end-to-end via SQL JOIN invariant.

From P1:
- Warmup banner uses `latestByAgent.size === 0` as the predicate. Monotonic — once any agent has spoken, banner stays hidden for the rest of the run. Genuinely warmup-only.

From P2:
- Ready state lives in `gameState.seatReady` JSONB. Pre-users rule: don't add a column when JSONB suffices.
- Atomicity is SQL-level CAS, not application-level transactions. Cleaner; no Drizzle transaction API needed.
- Roundtable's human-turn primitives are duplicated from open-chat's, not factored. Extract on a 3rd consumer.
- `LobbyView` is cross-mode (one component for all 3 modes). Mode-specific content lives in the mode views downstream of lobby resolution.
- `isOwner` lifted from werewolf-only branch into the universal messages-endpoint response. Server-derived; client flag can't bypass.
- `WEREWOLF_AGENT_PERSONA` constant exported from `werewolf-workflow.ts`; both create-time + lobby-resolve paths reference one source.

---

## State at session end

- Branch state on `origin`:
  - `main` ends at `129416f` (P1 review fixes).
  - `feat/p2-lobby-gate-roundtable-humans` ends at `4bdae67` (P2 review fixes).
- Working tree: clean against `feat/p2-lobby-gate-roundtable-humans` head. Two pre-existing untracked files (`docs/applications/agent-platform-application.md`, `packages/db/src/scripts/check-0010.ts`) carried over from before session 7 — not part of any P-series work.
- Tests: 63 unit tests still passing on main (no new tests added per pre-users rule).
- TypeScript: clean on both branches.
- Dev server: not running at session end.

---

## How to resume next session

1. Read this doc first.
2. Check PR #1 status (https://github.com/xingfanxia/agora/pull/1):
   - CI green?
   - `@claude` review posted?
   - Any new comments / unresolved threads?
3. Run the 5 P2 validation flows (see above) against either `main` (with the branch checked out) or a Vercel preview.
4. If real-game finds bugs: patch on the same branch, push, re-request review.
5. If clean: merge PR #1 to main.
6. Continue with P3 → P4 → P5 in order (each its own `/big-task` invocation).

For deep context, the load-bearing memory files in priority order:
- `project_session_7_p2.md` — most recent, P2 architectural decisions
- `project_session_7_audit_p1.md` — audit findings + P1 details
- `project_werewolf_ux_session_6.md` — original session-6 11-bug breakdown + cross-mode queue
- `project_wdk_phase_4_5d_2.md` — full WDK phase ledger (4.5d-2.0 through 2.17 + UX commit chain)

For PR-specific context, the PR description in #1 has the test plan + autonomous decisions log.
