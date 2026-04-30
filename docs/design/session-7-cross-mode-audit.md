# Session 7 — Cross-Mode Seat-ID Audit + Roundtable Humans Gap

> **Status:** 2026-04-30 (continuation of session 6). Audit complete; one new gap found.

## TL;DR

Session 6's hypothesis was that Roundtable + Open-chat would have the same seat-ID continuity bug as werewolf. **They don't.** Both go through `buildTeamSnapshot()`, which preserves `agent.id` end-to-end. The werewolf bug was specific to werewolf bypassing the helper.

But the audit surfaced a different correctness gap: **Roundtable silently drops `humanSeatIds` from the POST body**, and its workflow has no human-seat support at all. The rooms/new picker offers human seats for roundtable; the user picks one; the AI plays it. HumanPlayBar renders but never activates. This is a UX-correctness bug, not data corruption.

## Seat-ID Continuity — verified clean

The full chain for both modes:

1. **DB invariant.** `getMembers()` does `INNER JOIN agents ON agents.id = teamMembers.agentId`. Returned rows therefore have `m.agentId === m.agent.id`.
2. **`buildTeamSnapshot()` (`apps/web/app/lib/team-room.ts:171`)**: writes `id: agent.id` into `room.agents[i].id`. Same value as `m.agentId` by the JOIN.
3. **Roundtable POST (`apps/web/app/api/rooms/route.ts:116-152`)**: team-based path uses `buildTeamSnapshot()` → snapshot's `info.id` → `room.agents[i].id`. Ad-hoc path uses fresh UUIDs, but ad-hoc has no `rooms/new` seat token to preserve.
4. **Open-chat POST (`apps/web/app/api/rooms/open-chat/route.ts:74-99`)**: always team-based, always uses `buildTeamSnapshot()`.
5. **`rooms/new/page.tsx:166-173`**: writes `agora-seat-${roomId}.agentId = ownSeatId`, where `ownSeatId` is set from the team-member API's `m.agentId` field — same value.
6. **Invite flow.** `/api/rooms/[id]/invites` mints JWT from `seat.id` of `room.agents`. `/r/[roomId]/ClaimSeat.tsx` writes JWT-payload's `agentId` to localStorage.
7. **Polling.** `/room/[id]/hooks/useRoomPoll.ts` reads `localStorage[agora-seat-${roomId}].agentId`, sends as `?seat=`. Server validates against `room.agents`.

All values are the same `agent.id` from the persistent `agents` table. **No bug.**

## Roundtable Humans Gap — silent feature drop

### What's wrong

`apps/web/app/rooms/new/page.tsx:454-547` shows the human-seats picker (`由你（人类）来玩的座位`) unconditionally for all three modes. For roundtable:

- The body `{ teamId, topic, rounds, language, humanSeatIds }` is sent to `/api/rooms`.
- `apps/web/app/api/rooms/route.ts:50-60` `CreateRoomBody` does NOT declare `humanSeatIds`. The route silently drops the field.
- `apps/web/app/workflows/roundtable-workflow.ts:97-103` `RoundtableAgentSnapshot` has no `isHuman` field.
- The workflow's own header (line 38) explicitly states: `Rule 7 (mode-namespaced hook tokens) — N/A — roundtable has no human seats in V1.`

Result: the user clicks "I want to play seat X", clicks Start, drops into a roundtable where seat X is played by the AI. `HumanPlayBar` at the bottom of the room view renders (page-level), but `thinkingAgentId` never matches the human's id (the AI takes every turn), so the bar never activates.

### Mitigation (this session)

Apply the minimum: **disable the human-seats picker for roundtable mode** in `rooms/new/page.tsx`. One conditional. Prevents user confusion. Documents the gap as a known feature.

### Full fix (deferred — fits P2 ready-up gate phase)

When the next session does P2 (multi-human ready-up gate), it should also extend roundtable to support humans:
1. Add `humanSeatIds` to `CreateRoomBody` and process it like werewolf does (lines 109-121 of `apps/web/app/api/rooms/werewolf/route.ts`).
2. Add `isHuman?: boolean` to `RoundtableAgentSnapshot`.
3. Branch the per-turn loop: `if (agent.isHuman) { mark-waiting + resumeHook }` like open-chat does (lines 206+).
4. Update `toRoundtableAgentSnapshot` to read `info.isHuman`.
5. Add validation skip-for-humans (model-config not required for human seats).
6. Wire `runtime: 'wdk'` requirement (resumeHook is WDK-only, not http_chain) — though roundtable defaults to WDK as of 4.5d-2.11.

Estimated ~150-250 LOC across POST route + workflow + snapshot + tests. Smaller than open-chat's add (which was 4.5d-2.10b) because the cross-runtime equivalence test infrastructure already exists.

## Open-chat — confirmed working

Sanity check on the open-chat path (since the user's queue assumes it works):
- POST route reads `humanSeatIds` (lines 88-99) and flips `isHuman` on the snapshot.
- `OpenChatAgentSnapshot` has `isHuman?: boolean` (line 102).
- Workflow validates non-humans only require `model` (lines 176-184), branches on `isHuman` per turn (line 206).
- `toOpenChatAgentSnapshot` propagates `isHuman` (line 747).

Full pipeline works.

## What changed in this session

- This document.
- One-line picker conditional in `rooms/new/page.tsx`.

## Update — 2026-04-30 (later same session)

The "Roundtable Humans Gap" section above became actionable: P2 closed both gaps (silently-dropped `humanSeatIds` AND missing workflow `isHuman` branch). The picker stopgap added in this audit was reverted in P2's wave 4. See PR #1 (https://github.com/xingfanxia/agora/pull/1) and `docs/design/session-7-handoff.md` for the full P2 description.

## Resume order for next session

P1 + P2 already shipped. Next priority queue: P3 (human display name) → P4 (sidebar refactor) → P5 (localize private-channel werewolf messages). See `docs/design/session-7-handoff.md`.
