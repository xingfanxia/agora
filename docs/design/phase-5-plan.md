# Phase 5 — UI Overhaul: i18n + Round Table + Chat Sidebar

> **Date**: 2026-04-14
> **Status**: APPROVED — user signed off all three open decisions
> **Triggered by**: current message-list UI is "terrible"; user wants Accio Work-style polish, agents around a round table with bubbles, click-to-view agent details, plus en/zh i18n
> **Pushes**: Script Kill from P5 → P6, TRPG P6 → P7, Platform P7 → P8

---

## 1. Resolved Decisions

| # | Question | Answer |
|---|----------|--------|
| 1 | Bubble lifetime | **(b) crossfade.** Bubbles persist until next message from that agent, then crossfade out. Click agent → modal includes button "view all messages from this agent". |
| 2 | Linear transcript | **Both.** Round-table is primary visualization. Add a **WeChat-style chat sidebar** on the right showing all messages chronologically. Per-agent history lives in the click-to-view modal. |
| 3 | Avatar style | **(a) gradient circle + first letter** with provider logo as a corner badge. |
| 4 | Both modes | Roundtable debate UI ALSO gets the new layout. Same `RoundTable` + `ChatSidebar` components serve both modes. |

---

## 2. Layout

### Desktop (≥1024px)

```
┌──────────────────────────────────────────────┬────────────────┐
│ Header: topic · phase badge · status · 中文 │  💬 Chat       │
│ Token cost panel (collapsible)               │  ──────────    │
├──────────────────────────────────────────────┤  Yuki 14:32    │
│                                              │  "I'm Seer..."  │
│            ROUND TABLE                       │                 │
│         (agents in circle,                   │  Marcus 14:33   │
│          bubbles above each)                 │  "Convenient..."│
│                                              │                 │
│                                              │  ⏬ Live        │
│                                              │  scroll         │
├──────────────────────────────────────────────┤                 │
│ Channels (werewolf): Day · Wolves · Seer    │  [collapse →]   │
└──────────────────────────────────────────────┴────────────────┘
```

### Mobile (<1024px)

- Round table fills viewport
- Floating action button bottom-right toggles chat sidebar (slides in from right, full-height)
- Channels become a horizontal scroll strip pinned bottom
- Bubbles auto-shrink with truncation; tap bubble to expand inline

### Click any agent → Modal (desktop centered, mobile full-screen)

```
[Avatar 80px gradient]
Yuki  (Seer 🔮)
─────────────────────────────────────
Model: Gemini 3.1 Pro · google
Channels: main, seer-result
─────────────────────────────────────
Persona
  "A thoughtful 17-year-old creator..."
─────────────────────────────────────
System prompt   [▸ show]
─────────────────────────────────────
Stats
  Calls: 6      Cost: $0.04
  Tokens: 14.5k Avg latency: 2.1s
─────────────────────────────────────
[ View all messages from Yuki → ]
```

The "view all messages" button opens an inline list (or new sub-view) showing every message + decision this agent has emitted across the room.

---

## 3. Architecture

### 3.1 i18n stack: `next-intl`

- Cookie-based locale (no URL prefix — keeps share links clean)
- Default `en`, alternative `zh`
- Toggle in header (中文 / EN)
- Translate **UI chrome only** — agent dialogue passes through unchanged
- Server components: `getTranslations({ namespace })`
- Client components: `useTranslations(namespace)`
- Dictionaries split by namespace: `common`, `landing`, `create`, `room`, `werewolf`, `replays`

```
apps/web/messages/
  en/
    common.json
    landing.json
    create.json
    room.json
    werewolf.json
    replays.json
  zh/
    (mirror)
```

### 3.2 Round-table geometry

```typescript
function tablePosition(index: number, total: number): { x: number; y: number } {
  // Distribute around an ellipse so the table fits screen better than a circle
  const angle = (2 * Math.PI * index) / total - Math.PI / 2  // start at top
  const rx = 280  // horizontal radius
  const ry = 200  // vertical radius
  return { x: rx * Math.cos(angle), y: ry * Math.sin(angle) }
}
```

Container is `position: relative`; each agent is `position: absolute` with `transform: translate(...)`. Bubbles position above the avatar with a tail pointer rendered via SVG or CSS triangle.

For 6-12 agents, ellipse radii scale based on container width. Mobile uses a tighter circle.

### 3.3 Component tree

```
apps/web/app/room/[id]/components/v2/
  RoundTable.tsx           — orchestrates layout
  AgentSeat.tsx            — one agent's avatar + bubble + click handler
  Bubble.tsx               — solid/dashed/crossfading speech bubble
  AgentAvatar.tsx          — gradient circle + initial + provider badge
  ChatSidebar.tsx          — WeChat-style scrollable timeline
  AgentDetailModal.tsx     — click-to-view modal
  PhaseBadge.tsx           — replaces existing PhaseIndicator with localized labels

apps/web/app/i18n/
  config.ts                — next-intl config + supported locales
  request.ts               — server-side message loader
  cookies.ts               — locale cookie helpers

apps/web/app/components/
  LocaleSwitcher.tsx       — header dropdown (en / zh)
```

The existing `MessageList` / `AgentList` / `ChannelTabs` / `Timeline` move to `components/legacy/` and remain available for the observability page (which doesn't need round-table treatment).

### 3.4 Bubble crossfade

- Bubble has internal state `mode: 'thinking' | 'speaking' | 'fading'`
- When `agent:thinking` event fires → mode becomes `thinking` (dashed border)
- When `message:created` fires → mode becomes `speaking` (solid border)
- When **next message from same agent** arrives → previous bubble enters `fading` (200ms opacity transition out), new bubble crossfades in
- Long messages: clamp to 4 lines + "more" expander; expanded shows full text in same bubble (max-height with scroll)

### 3.5 ChatSidebar (WeChat-style)

- Right column, ~320px wide on desktop
- Each row: agent avatar (small, 32px) + name + timestamp + message content
- Auto-scroll to bottom on new message
- Filter by channel (dropdown atop sidebar) — defaults to active channel
- Decisions render as monospace JSON (current behavior preserved)
- System/Narrator messages render with subtle dashed background

### 3.6 Replay integration

Both the live view and replay view feed `RoundTable + ChatSidebar` from the same `messages[]` + `snapshot` props — no changes to the replay reconstruction logic. The bubble system reads from "latest message per agent" computed from filtered messages.

---

## 4. Sub-units

### 5.1 — i18n foundation
**Files**:
- `apps/web/next.config.ts` — wire next-intl plugin
- `apps/web/middleware.ts` — locale negotiation (cookie + Accept-Language)
- `apps/web/app/i18n/{config,request,cookies}.ts`
- `apps/web/app/layout.tsx` — wrap in `NextIntlClientProvider`
- `apps/web/messages/{en,zh}/*.json`
- `apps/web/app/components/LocaleSwitcher.tsx`
- All existing pages: replace hardcoded strings with `t('key')` calls

**Validation**: switch to 中文, every UI string is translated; agent messages stay as-is.

### 5.2 — Round-table component
**Files**:
- `apps/web/app/room/[id]/components/v2/{RoundTable,AgentSeat,Bubble,AgentAvatar,PhaseBadge}.tsx`
- Bubble crossfade with framer-motion (lightweight, ~50KB) OR pure CSS keyframes (zero deps)

**Decision needed during build**: `framer-motion` vs CSS-only animations. Default to CSS for v1 (smaller bundle, easier to debug); add framer if mobile/desktop polish needs it.

**Validation**: 6-12 agents render around table without overlap; bubbles position correctly; thinking → speaking transition smooth.

### 5.3 — Agent detail modal
**Files**:
- `apps/web/app/room/[id]/components/v2/AgentDetailModal.tsx`
- Tab/state for "view all from this agent" sub-view inside the same modal

Stats (calls, cost, tokens) come from existing `tokenSummary.byAgent`. Recent messages filter from `messages[]` by `senderId`.

**Validation**: click any agent → modal shows correct info; "view all" lists every message from that agent including decisions.

### 5.4 — Chat sidebar
**Files**:
- `apps/web/app/room/[id]/components/v2/ChatSidebar.tsx`
- Channel filter dropdown (reuses existing channel discovery logic)
- Mobile: slide-in drawer triggered by FAB

**Validation**: messages append in order; auto-scroll works; filter switches view; sidebar collapsible.

### 5.5 — Wire to RoundtableView + WerewolfView
**Files**:
- `apps/web/app/room/[id]/modes/roundtable/RoundtableView.tsx` — replace MessageList/AgentList with RoundTable + ChatSidebar
- `apps/web/app/room/[id]/modes/werewolf/WerewolfView.tsx` — same, plus role badges on AgentSeat, channel tabs above table
- Phase labels in `werewolf.json` for both `en` and `zh` (proper Chinese rule names)

**Validation**: both modes render correctly live; replay re-emits into the new view without changes.

### 5.6 — Polish + deploy
- Mobile breakpoints (test at 375px, 768px, 1024px)
- Reduced-motion media query (skip animations)
- Keyboard accessibility (Esc closes modal, Tab cycles agents)
- Dark mode parity
- Push to main → Vercel auto-deploys

**Validation**: smoke test on production URL across debate + werewolf + replay paths in both languages.

---

## 5. Tradeoffs

| Choice | Tradeoff |
|--------|----------|
| Cookie-based locale (vs URL prefix) | Cleaner share links; no SEO benefit for zh page; acceptable since most users hit landing in their browser default |
| Round-table as primary view | Beautiful demo but mobile is harder; need responsive treatment |
| Translate chrome only, not agent dialog | Faster shipping; agents speaking English to a Chinese-locale user is fine since they're characters with their own voice |
| `next-intl` (vs `react-i18next` or homemade) | App Router native; slight learning curve; mature ecosystem |
| CSS animations first (no framer-motion) | Smaller bundle; less control; can add later if needed |
| Move existing components to `legacy/` | Observability page keeps its current Timeline UI; no rewrite needed |

---

## 6. Risks

1. **Round-table geometry on mobile** — 12 agents around an ellipse on a 375px screen will be tight. Mitigation: collapse to grid view below 640px, or shrink avatars dramatically.
2. **Bubble overlap when adjacent agents both have long messages** — z-index layering + max-width on bubbles.
3. **i18n + next-intl App Router gotchas** — server/client component boundaries can get sticky. Reserve buffer time for this.
4. **next-intl version compatibility** — check Next 16 support before installing; v3+ should be fine.
5. **Bundle size growth** — adding next-intl + animations pushes initial JS. Acceptable for a polished demo; monitor Lighthouse.

---

## 7. File inventory (estimated)

**New files** (~12):
- 4 i18n setup files
- 1 LocaleSwitcher
- 6 v2 components (RoundTable, AgentSeat, Bubble, AgentAvatar, PhaseBadge, ChatSidebar, AgentDetailModal)
- 12 message dictionaries (6 namespaces × 2 locales)

**Modified files** (~8):
- next.config.ts, middleware.ts, layout.tsx
- 4 page.tsx files (landing, create, create-werewolf, replays)
- 2 mode views (RoundtableView, WerewolfView)
- 1 replay page (reuses mode views, but locale + bubble props need wiring)

**Moved to legacy/** (~5):
- MessageList, AgentList (kept for observability page)

**Total churn**: ~1500 LOC net new, ~500 LOC modified.

---

## 8. Sequencing for next session

After compact:

1. Read this doc + `docs/design/phase-5-handoff.md`
2. Verify Phase 4 still works (`pnpm check-types`, smoke test prod URL)
3. Start with **5.1 (i18n)** — foundational, doesn't depend on visualization, can ship + deploy alone
4. Then 5.2 RoundTable, 5.3 Modal, 5.4 ChatSidebar in that order
5. 5.5 wires both modes; 5.6 polish + deploy

Single commit per sub-unit. Push after 5.1, 5.4, 5.6 (preserves preview deploys).
