# Phase 5 — Handoff for next session

> **Date written**: 2026-04-14
> **Target**: Next Claude session starting fresh after compact
> **Phase 4 status**: ✅ shipped, deployed at https://agora-panpanmao.vercel.app
>
> ⚠️ **IMPORTANT UPDATE (2026-04-14 late)**: Phase 4.5 was inserted and must ship **before** Phase 5.2-5.6. See `docs/design/phase-4.5-plan.md`. Phase 5.1 (i18n + agent-language) ✅ shipped. Phase 5.2-5.6 (round-table viz) now blocks on 4.5 completing, because the new UI must bake in `ViewerContext` + `HumanAgent` affordances from day 1 rather than retrofitting.

---

## Quick Start

```bash
cd /Users/xingfanxia/projects/products/agora
git log --oneline -10                       # see Phase 4 commits
pnpm check-types                            # everything green
pnpm dev                                    # localhost:3000
curl -s https://agora-p4jdsp1c7-panpanmao.vercel.app/api/rooms | jq  # prod DB has 2+ completed rooms
```

Read `docs/design/phase-5-plan.md` FIRST before writing code.

---

## What's done (Phases 1-4)

- **Phase 1**: Roundtable debate MVP
- **Phase 2a/2b**: Werewolf with 7 togglable roles, Chinese 狼人杀 standard rules
- **Phase 3**: Mode-dispatched UI, observability timeline, LiteLLM token tracking
- **Phase 4**: Postgres persistence, animated replay, Vercel deploy with Supabase

The current UI is functional but the user calls it "terrible" — message-list-based, no visualization of agent collaboration. Phase 5 fixes this.

---

## What you're building

Two big things bundled:

1. **i18n** (en + zh) via next-intl
2. **Round-table visualization** with bubbles above each agent + chat sidebar + click-to-view modal

Full plan with file paths, geometry, and component tree in `docs/design/phase-5-plan.md`.

---

## Resolved decisions (do NOT re-litigate)

| Topic | Decision |
|-------|----------|
| Bubble lifetime | Crossfade — persist until next message from same agent |
| Linear transcript | WeChat-style chat sidebar on the right (not bottom panel) |
| Avatar style | Gradient circle + first letter + provider logo badge |
| Both modes scope | Roundtable debate UI ALSO gets the round-table treatment |
| i18n strategy | Cookie-based locale, no URL prefix, translate UI chrome only (not agent dialogue) |
| Animations | CSS-only first; framer-motion only if mobile polish demands it |
| Phase numbering | This is Phase 5; Script Kill becomes Phase 6, TRPG Phase 7, Platform Phase 8 |

---

## Key constraints to remember

1. **Don't break replay.** `apps/web/app/replay/[id]/page.tsx` reconstructs `messages[]` + `snapshot` from events and feeds `RoundtableView` / `WerewolfView`. Both views must keep the same prop signatures. Add new components inside the views; don't change view interfaces.

2. **Don't touch the runtime persistence layer.** `room-store.ts`, `runtime-registry.ts`, `persist-runtime.ts` are load-bearing for Phase 4. Phase 5 is pure frontend.

3. **Don't translate agent dialogue.** Only UI chrome. Agents speak whatever language their persona dictates — that's content, not chrome.

4. **Mobile matters.** User wants this for blog/demo material. Test at 375px (iPhone SE), 768px (tablet), 1024px (desktop). Round-table layout will need a fallback strategy for ≤640px (consider: collapse to vertical list of cards, OR very tight circle with smaller avatars).

5. **Vercel Pro 5min function timeout still applies.** No runtime work in Phase 5; if a 12-player werewolf game would have timed out before, it still will. Don't try to "fix" this in Phase 5.

---

## Suggested execution order

Strict ordering (each unblocks the next):

1. **5.1 — i18n foundation** (~2-3 hours)
   - Install `next-intl`, wire middleware + provider, create locale switcher
   - Translate every existing UI string into en + zh
   - Validate: switch language, every label changes, agent messages don't
   - **Ship and push** — this is independently valuable

2. **5.2 — RoundTable + AgentSeat + Bubble + AgentAvatar + PhaseBadge** (~4-5 hours)
   - Build the core visualization in isolation (Storybook or scratch route)
   - Test with mock data (6, 9, 12 agent counts)
   - Get the geometry + bubble crossfade right BEFORE wiring to real data
   - Don't ship yet — 5.5 wires it in

3. **5.3 — AgentDetailModal** (~2 hours)
   - Click handler on AgentSeat opens modal
   - Pull stats from existing `tokenSummary.byAgent`
   - "View all from this agent" filters `messages[]` by `senderId`

4. **5.4 — ChatSidebar** (~2 hours)
   - Right-column scrolling timeline
   - Channel filter
   - Mobile: slide-in drawer

5. **5.5 — Wire both mode views** (~2 hours)
   - Replace the contents of `RoundtableView.tsx` + `WerewolfView.tsx` with the new components
   - Werewolf: role badges on AgentSeat, channel tabs above table
   - Both modes: chat sidebar pinned right
   - **Ship and push** — Vercel auto-deploys

6. **5.6 — Polish + deploy** (~1-2 hours)
   - Mobile breakpoints
   - Reduced-motion handling
   - Keyboard accessibility
   - Smoke test on production URL

---

## Architecture-critical details

### File locations
```
apps/web/app/
├── i18n/                                      ← NEW: next-intl config
├── messages/{en,zh}/*.json                    ← NEW: translations
├── components/LocaleSwitcher.tsx              ← NEW
├── room/[id]/components/
│   ├── v2/                                    ← NEW: round-table components
│   ├── legacy/                                ← MOVE current MessageList, AgentList here
│   └── (keep theme.ts, TokenCostPanel.tsx, Timeline.tsx in place)
├── room/[id]/modes/
│   ├── roundtable/RoundtableView.tsx          ← REWRITE (use v2 components)
│   └── werewolf/WerewolfView.tsx              ← REWRITE (use v2 + role badges)
├── replay/[id]/page.tsx                       ← UNCHANGED (feeds new views)
└── room/[id]/observability/page.tsx           ← UNCHANGED (uses Timeline directly)
```

### Round-table geometry hint

```typescript
function tablePosition(index: number, total: number, rx = 280, ry = 200) {
  const angle = (2 * Math.PI * index) / total - Math.PI / 2  // start at top
  return { x: rx * Math.cos(angle), y: ry * Math.sin(angle) }
}
```

Container `position: relative`; agents `position: absolute; transform: translate(...)`. Bubbles position ABOVE each agent (negative Y offset) with SVG triangle tail pointing down.

### Bubble state machine

```
idle ─(agent:thinking)→ thinking (dashed border)
thinking ─(message:created same agent)→ speaking (solid border)
speaking ─(any new message from same agent)→ fading-out (200ms)
                                         ↘ next bubble fades-in (200ms)
```

### What the bubble crossfade hooks into

The replay player has `messages` array filtered to "visible up to virtualClock". For each agent, find the *latest* message — that's what shows in their bubble. When `messages` updates and the latest message for an agent changes, the bubble crossfades.

For thinking state: subscribe to `agent:thinking` / `agent:done` events. In live mode these come via polling `snapshot.thinkingAgentId`. In replay mode they're in the event stream — render the thinking bubble when virtual clock hits an `agent:thinking` event for an agent.

---

## Things that might trip you up

1. **next-intl + Next 16 + App Router**: server/client component boundaries are subtle. Use `useTranslations` in client components, `getTranslations` in server components. Provider must wrap from `app/layout.tsx`.

2. **Polling vs replay state shape**: live mode gets `thinkingAgentId` from snapshot polling. Replay mode needs to derive it from events. Make the bubble component agnostic — accept `thinkingAgents: Set<string>` as a prop and let parent compute it.

3. **z-index for bubbles**: when adjacent agents both have bubbles, layering matters. Use `z-index` proportional to `index` so the most recently spoken bubble pops to front.

4. **Mobile geometry**: 12 agents at radius 280/200 will overlap on a 375px screen. Either scale `rx`/`ry` based on container width, or fall back to grid view below 640px breakpoint.

5. **Long bubble text**: clamp to 4 lines + "more" expander. Don't let one verbose agent's bubble cover the whole table.

6. **Werewolf role visibility**: in spectator mode (current default), all roles visible. When auth lands later, may need to gate this. For now: always show roles in the AgentSeat badges and detail modal.

---

## Validation checklist

When you think 5.6 is done, verify:

- [ ] `pnpm check-types` clean across all 6 packages
- [ ] Local `pnpm dev` — create debate, agents render around table, bubbles appear
- [ ] Local — create werewolf game, role badges visible, channel tabs work
- [ ] Local — click any agent → modal shows correct info, "view all" works
- [ ] Local — language toggle: switch to 中文, every label translates, agent messages stay as-is
- [ ] Local — visit `/replays`, click a completed game, verify animated replay still works in new layout
- [ ] Mobile — Chrome devtools at 375px, layout doesn't break
- [ ] Production — push to main, Vercel deploy succeeds, smoke test all paths

---

## Things explicitly NOT in Phase 5

- Auth (deferred — public-by-UUID stays)
- Real avatars / image uploads (gradient + initial is enough)
- Animations beyond bubble crossfade (no agent "walking", no card flips)
- Voice/audio (text only)
- Drag-to-rearrange agents at table
- Custom themes / dark mode beyond what's already supported
- Scripted Kill content (that's Phase 6 now)

---

## Final note

Phase 5 is mostly visual. Don't reach into the persistence layer, don't change the API shapes, don't refactor the runtime. New components in `v2/`, translations in `messages/`, and minimal changes to the two mode views to wire them up. The hardest part will be getting the round-table geometry to feel right — give it visual attention; user wants this for blog/demo material.

Estimated session count: **2-3 sessions** at the current pace.

When done: update `docs/implementation-plan.md` Phase 5 status, add commit summary to `memory/project_agora.md`, update `MEMORY.md` index.
