# Session 6 — Werewolf Real-Game Validation

> **Status:** 2026-04-30. Werewolf is now playable end-to-end on the WDK runtime; 8 bugs fixed in this session, 4 remain queued for the next.

## TL;DR

Phase 4.5d-2.17 (werewolf API integration on the WDK runtime) shipped clean code-review and unit tests at the end of session 5. Session 6 was real-game validation — and surfaced one P0 (workflow wedge) plus a chain of UX correctness bugs that vacuous green tests had hidden. All 8 critical/correctness bugs are now fixed on `main`; 4 polish items (loading indicator, ready-up gate, human display name, sidebar) plus the same UX work for Roundtable + Open-chat modes are queued.

This doc is the bridge: what got fixed, why, what's still open, and how to pick it up.

## Architectural lessons (load-bearing for next session)

### 1. Vitest never crosses the WDK queue boundary

Bug: `generateAgentDecision` step accepted `schema: ZodSchema` as input. Zod schemas contain functions and closures; WDK's `devalue`-based step-arg serializer can't encode them. In Vitest the `'use step'` boundary is in-process, so closures survive — all 63 unit tests passed every session. Real workflow runs serialize step args for the queue; the FIRST call wedged identically every retry (attempt 42 in dev server logs).

Fix: Replace `schema: ZodSchema` with `decision: WerewolfDecisionSpec` — a discriminated union of POJOs (`{ kind: 'wolfVote' | 'dayVote' | …, targets, … }`). Schema is reconstructed inside the step body via `buildDecisionSchema(decision)`.

**Rule:** Any new WDK step input MUST be a pure POJO. Factories with closures live INSIDE the step body, never at the call site as inputs. This is the actionable form of durability-contract Rule 6 ("scalar step inputs").

### 2. Channel visibility is a SERVER concern

`/api/rooms/[id]/messages` originally returned every event in the room, with no role-based gate. The client built channel tabs from received messages — non-wolves got the `werewolf` channel in their dropdown and could read the wolves' chat.

Fix: server filters messages by viewer role:
- **Public channels:** `main`, `system`. (NOT `day-vote` — see #3.)
- **Role-private channels:**
  - `werewolf`, `wolf-vote` → wolves only
  - `seer-result` → seer only
  - `witch-action` → witch only
  - `guard-action` → guard only
- **Spectator** (room owner via auth match) → all channels
- **Strict observer** (no seat token, not owner) → public only

The client passes `?seat=<agentId>` from `localStorage[agora-seat-${roomId}]`. The server validates the seat exists in the room before honoring the role claim (so a typo can't accidentally upgrade visibility).

### 3. Closed-eyes voting

In standard 狼人杀, day votes are anonymous until the tally announcement. Our `runDayVote` wrote each voter's vote to `channelId: 'day-vote'` immediately, and the messages endpoint exposed `day-vote` to everyone. Result: the chat showed votes streaming in real-time as each AI's LLM call resolved.

Fix: removed `day-vote` from `PUBLIC_CHANNELS`. Spectators / replay still see individual votes (via the spectator carve-out); players see only the tally on `main` (which `runDayVote` already emits via `emitPhaseAnnouncement` after `Promise.all` of all votes).

### 4. roleAssignments need the same filter as messages

Even with channel filter, `WerewolfView`'s round-table mode rendered role badges from `roleAssignments` — server was sending the full map. Result: any viewer could read every seat's role from the table view.

Fix: server filters `roleAssignments` per viewer:
- Spectator / `status === 'completed'` → full reveal
- Werewolf player → own role + other wolves (faction coordination)
- Other players → only own role
- Strict observer → empty `{}`

### 5. Seat ID continuity contract

`rooms/new/page.tsx` writes `agora-seat-${roomId}` to localStorage with the **team member's `agentId`**. The werewolf POST route, however, generated **fresh UUIDs** for room agents — every downstream lookup keyed off the wrong id:
- `HumanPlayBar` showed "你的座位: You" (myAgent lookup returned undefined)
- `?seat=…` query was for a non-existent agent → server treated caller as strict observer → role banner never appeared
- Day-vote hook never resumed for the human's claimed id → grace timeout fired → auto-skip recorded

Fix: when `teamId` is set, use `m.agentId` as the room agent id. Ad-hoc path keeps `crypto.randomUUID()`. The `ResolvedPlayer` shape now carries `agentId` decided at resolution time.

**This same contract applies to Roundtable and Open-chat.** Both modes support human seats via the InvitePanel flow. Their POST routes need an audit. If they generate fresh UUIDs unconditionally, they have the same bug.

### 6. System message localization

The workflow's emitted strings ("Dawn breaks", "Vote: …. X eliminated. They were a villager.", "Votes for X: reason") were hardcoded English. The agents' LLM output language was controlled by `languageDirective` baked into systemPrompt — but that's the AI's output, not the workflow's UI prose.

Fix: `WerewolfWorkflowInput.language: 'en' | 'zh'`, plumbed through to `werewolfStrings(language)` helper at the top of each phase function. zh translates dawn / vote / role-label / abstain / timeout strings.

**Same pattern needed for Roundtable + Open-chat.** Audit their workflows for hardcoded English announcements.

## Bugs found (full table)

| # | Issue | Severity | Status | Commit |
|---|---|---|---|---|
| 1 | Zod-schema-as-step-input wedged the workflow at `wolfVote` (attempt 42 retry) | P0 | ✅ FIXED | `a7685ac` |
| 2 | Wolf-channel chat visible to non-wolves | P0 | ✅ FIXED | `9e3d72a` |
| 3 | Phase indicator hidden (`gameState.currentPhase` not surfaced) | UX block | ✅ FIXED | `9e3d72a` |
| 4 | Human player saw no role banner | UX block | ✅ FIXED | `9e3d72a` |
| 5 | "Playing as / 扮演" UI implied human had to perform agent persona | UX | ✅ FIXED | `9dc3dec`, `e8e51d6` |
| 6 | localStorage seat agentId ≠ room agent agentId | P0 | ✅ FIXED | `8b1de54` |
| 7 | Round-table view leaked every seat's role | P0 | ✅ FIXED | `8b1de54` |
| 8 | Day-vote individual votes broadcast in real-time (not closed-eyes) | Correctness | ✅ FIXED | `8b1de54` |
| 9 | System messages mixed zh/en | UX | ✅ FIXED | `0eacd26` |
| 10 | Loading-state silence during workflow warmup (~30-90s) | UX | ❌ QUEUED | next session |
| 11 | Multi-human selection starts game before all humans joined | Correctness/UX | ❌ QUEUED | next session |

## Queue for next session (priority order)

### P1. Loading-state indicator (small)

After `start()` is called, the workflow takes ~30-90s before the first non-system chat message lands (`initializeGameState` writes + first phase's first LLM call). Add a banner in `WerewolfView` when `status === 'running'` AND no agent messages yet: "正在初始化…" / "AI 玩家思考中…". If `thinkingAgentId` is set, "X 正在思考". Apply to Roundtable + Open-chat.

### P2. Multi-human ready-up gate (medium-large)

User selects 2 humans, room is created, workflow starts immediately, second human auto-skips because they haven't joined yet. Standard 狼人杀 has a lobby — owner clicks 开始 only when all seats ready.

Sketch:
- New room status: `'lobby'` (initial state when room has any human seats)
- Per-seat `ready: boolean` in `gameState` or new column
- API: `POST /api/rooms/[id]/seats/[agentId]/ready`
- UI: "ready" button in `/r/[roomId]` claim flow + on `/room/[id]` for owner-as-player
- Owner override: "force start" (when at least 1 human ready)
- Auto-start: when all human seats `ready=true`
- Workflow `start()` moves from room-create time to lobby-resolve time

Build as shared infrastructure — applies to all 3 modes.

### P3. Human display name (medium)

User: "as a human player I am still 林溪 the agent seat I replaced". Want: human picks own name (or default to user's auth display name) so messages render as the human's identity, not the seat's.

Sketch:
- Add `humanDisplayName?: string` to `AgentInfo` in room-store
- `ClaimSeat.tsx` prompts for name on claim
- Owner-as-player: name field in `rooms/new` next to the human-seats picker
- Workflow's `persistAgentMessage` reads `humanDisplayName ?? agent.name` for the chat message's senderName

Applies to all 3 modes.

### P4. Sidebar layout refactor (large)

User: "for round info and actiontimeline, player info, i think sidebar makes more sense". Currently chat-mode WerewolfView has all info inline in the header; table-mode has a sidebar but for chat (not state).

Sketch:
- Right sidebar in chat mode containing: phase indicator (DayNightBadge), round counter, action timeline (Timeline.tsx exists but isn't wired into werewolf), player roster with role-aware status (alive/dead, role for self/wolves only)
- Collapsible
- Shared chrome across all 3 modes; each mode supplies its own contents

### P5. Localize private-channel messages (small, deferred)

Witch's "Saves / Uses POISON / Pass", Seer's "Investigation: X is/is not a werewolf", Guard's "Protects X tonight: …", wolf-vote tally announcement. Visible only to the seat with that role (and spectator). Lower priority but the phase functions already accept `language`, so this is mechanical when paired with P2/P3.

## Cross-mode audit (Roundtable 圆桌 + Open-chat 当皇帝)

User explicitly flagged these for the same UX work. Apply the pattern set:

| Pattern | Where to verify | Priority |
|---|---|---|
| Seat ID continuity | `apps/web/app/api/rooms/route.ts` (Roundtable), `apps/web/app/api/rooms/open-chat/route.ts` (Open-chat) — search for `crypto.randomUUID()` in agent-id generation. If the team-based path uses fresh UUIDs, it has the same bug as werewolf had. | HIGH (correctness — humans can't play if broken) |
| HumanPlayBar reframe | Already done across all modes (it's a shared component). | DONE |
| Loading-state indicator | RoundtableView + Open-chat ChatView | with P1 |
| Ready-up gate | shared infra from P2 | with P2 |
| Human display name | shared infra from P3 | with P3 |
| Sidebar refactor | RoundtableView + ChatView | with P4 |
| System message localization | check `apps/web/app/workflows/roundtable-workflow.ts` + `open-chat-workflow.ts` for hardcoded English emit strings | with P5 |

## Decisions made — DO NOT re-litigate

- **Channel visibility:** server-enforced; `day-vote` is private — players see only the tally on `main`
- **Role visibility:** own role + faction-mates (wolves see wolves) + post-game full reveal + spectator full reveal
- **Seat ID continuity:** team-member-agentId = room-agent-id when `teamId` is set
- **Localization:** `language` plumbed via WerewolfWorkflowInput, used at phase-step boundary
- **Vote anonymity:** non-negotiable for closed-eyes 狼人杀

## State at session end

- Branch: `main`, all commits pushed to `origin/main`
- Latest commit: `0eacd26 fix(werewolf): localize system messages (dawn / vote announcements)`
- Werewolf is functionally playable; polish items remain
- 63 unit tests passing, typecheck clean, lint at 23-warning baseline
- Stuck rooms in DB: `8e5573c8...` (the original Zod-schema wedge) was manually marked `status='error'`

## How to resume

1. Read this doc + `.claude/.../memory/project_werewolf_ux_session_6.md` for full context.
2. Verify `git log` matches the commit chain in the memory file.
3. Restart dev server (was running at port 3005).
4. Start with P1 (loading indicator) — small + high-impact + applies across all 3 modes in one pass.
5. Then audit Roundtable + Open-chat POST routes for seat-ID continuity (HIGH-priority correctness bug).
6. Then P2 (ready-up gate) as shared infrastructure.
7. P3, P4, P5 in order.
