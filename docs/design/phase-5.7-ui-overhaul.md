# Phase 5.7 — UI Overhaul V2 (Accio-inspired)

> **Date**: 2026-04-15
> **Trigger**: User feedback after Phase 5.5 shipped. Screenshots of
> current Agora (buggy round-table) + 16 screenshots of Accio Work as
> reference. User: "整体界面设计也不好, 我们参考一下 Accio Work 的".
>
> **Goal**: Ship an aesthetic + functional overhaul that gives Agora
> the polish level of Accio Work without rebuilding from scratch.
> Preserve everything that works; replace what doesn't.

---

## 1. What the screenshots told us

### 1.1 Accio's visual system

| Token | Value (eyeballed) | Usage |
|---|---|---|
| bg | `#0F1012` | page canvas |
| surface | `#17181C` | cards, chat bg |
| surface-elevated | `#1A1B1F` | modals, popovers |
| surface-hover | `#1E2025` | hover / secondary bg |
| border | `#25272C` | dividers, card borders |
| text | `#E8E9EC` | primary |
| muted | `#8A8B92` | secondary |
| muted-strong | `#55565C` | tertiary |
| accent | `#22C493` | CTAs, active states, checkmarks |
| warn | `#E0A64A` | leader glow, caution |

Spacing scale: roughly 4 / 8 / 12 / 16 / 24 / 32. Card radius 16. Modal
radius 20. Button radius 8. No harsh borders — everything breathes.

Typography: system sans (SF / PingFang). Hierarchy: H1 semibold 1.25rem
(room title), body regular 14px, small 12-13px, ALL CAPS labels 11px
with 0.8em letter-spacing.

### 1.2 Accio's layout patterns

**Three-column shell**:
- **Left sidebar** (~200px, persistent):
  - Brand + quick-create action at top
  - Primary nav: 新消息, 智能体, 能力 (expandable)
  - "Messages" section listing recent rooms/threads
  - "团队 Beta" section listing teams
  - User pill at bottom
- **Center content** (flex): page-specific
- **Right rail** (optional, toggle): team roster, when applicable

**Stepped wizards** for creation flows (4 steps with progress bar, back
ghost + primary green pill CTA). Used for agent creation.

**Card grids** for browsing entities (agents, replays) — 3 columns,
16-24px gutter, ~240×280px cards with avatar/icon + name + description
+ CTA button.

### 1.3 Accio's chat rendering (critical)

**Agents = markdown on surface, no bubble**. Avatar + name + timestamp
header, then markdown body flows. Long content works because headings/
lists/bold give structure instead of a wall of text in a bubble.

**User = green bubble, right-aligned**. This visually distinguishes
the human from the AI agents. Important once Agora has human seats
(Phase 4.5c) — structure is there today.

**Structured data** (JSON decisions) renders as compact one-line
summaries ("→ Eve — quiet, suspicious") with an expand toggle.

### 1.4 Accio's results views (for debate/game wrap-up)

Two layers:
- **Tournament table** (image 22): per-round rows showing question +
  score + vote-distribution strip (6-8 small square pills per row,
  each labeled with a player letter, green = won vote, gray = didn't).
- **Summary page** (image 24): hero card for leader with amber glow +
  secondary cards for others with per-player accent colors, then a
  per-round trend strip (R1…R10 tiles showing winner per round,
  green/slate/gray colour-coding for leader-won/other-won/tie).

Not a 1:1 fit for Agora — Accio tracks a voted-best-answer tournament.
But the visual vocabulary (hero card + stat grid + trend strip) maps
nicely to:
- **Werewolf**: winner banner + role-reveal roster + per-night
  elimination timeline
- **Debate**: topic summary + per-agent contribution bars + total
  cost/tokens

---

## 2. What's already done

✅ **Phase 5.7a** (commit `17cd608`): chat-default + markdown rendering
+ bubble "more" fix. ChatView + ViewToggle.

✅ **Phase 5.7b** (commit `30094b4`): Accio palette — mint green
`#22c493` accent, deeper `#0f1012` canvas, elevated/hover tiers for
cards, warn amber tier.

---

## 3. What's still missing (this phase's scope)

| # | Sub-phase | Component / Change | Addresses |
|---|---|---|---|
| 5.7c | AppShell + Sidebar | Left nav persistent on all pages | User's "整体UI" complaint |
| 5.7d | Werewolf results view | Winner banner + role roster + timeline | Accio image 24 inspiration |
| 5.7e | Debate results view | Topic summary + per-agent contribution | Accio image 22 inspiration |
| 5.7f | Replay list → grid | Card grid, mode-specific thumbnails | Accio agent grid pattern |
| 5.7g | Create page polish | Spacing, typography, preset-agent card row | Accio form polish |
| 5.7h | Landing page polish | Sidebar-aware hero, remove redundant chrome | — |
| 5.7i | Mobile + a11y | Breakpoints, keyboard nav, reduced-motion | Phase 5.6 original scope |

Total estimate: ~2 days of focused work, one commit per sub-phase.

---

## 4. Detailed plan per sub-phase

### 5.7c — AppShell + Sidebar

**Goal**: Unified left-sidebar nav across every page so the chrome is
consistent with Accio.

**Files**:
- NEW `apps/web/app/components/AppShell.tsx` — client component that
  wraps page content with the sidebar + main grid.
- NEW `apps/web/app/components/Sidebar.tsx` — nav items, locale
  switcher, collapse toggle.
- MOD `apps/web/app/layout.tsx` — wrap children in AppShell.
- MOD page components — remove duplicate header breadcrumbs that the
  sidebar now provides.

**Sidebar sections** (top to bottom):
1. Brand: "Agora" logo text
2. Actions: `+ 新辩论` `+ 新狼人杀` (two buttons stacked)
3. Nav: `🎬 回放` (replays)
4. (Future) `👥 团队` (teams) — collapsed section for later
5. Divider
6. Settings (collapsible footer): language, agent language

**Responsive**:
- ≥1024px: sidebar always visible (200px fixed)
- 768-1024px: sidebar collapses to icon rail (56px)
- <768px: sidebar slides off-canvas, hamburger toggles

**Dark by default** (matches Accio). Light mode inherits from media
query.

**Out of scope** for this sub-phase: recent-rooms list, search, team
selector. Stubs only.

### 5.7d — Werewolf results view

**Goal**: Replace the current single-line winner banner with a
polished results card that feels like Accio's summary page.

**Trigger**: `status === 'completed'` in WerewolfView, irrespective of
viewMode (chat or table).

**Visual**:
```
┌────────────────────────────────────────┐
│ 🐺 狼人获胜  (village wins variant green)│
│ ──────────────────────────────────────  │
│ 6 players · 76 messages · $0.33 · 8 min│
│                                        │
│ ───  生还者 (survivors) ───             │
│  [avatar Alice]   werewolf  ✓          │
│  [avatar Frank]   werewolf  ✓          │
│  [avatar Diana]   witch     ✓          │
│                                        │
│ ───  淘汰 (eliminated) ───              │
│  [avatar Bob]     villager  night 1    │
│  [avatar Charlie] seer      day 1      │
│  [avatar Eve]     villager  night 2    │
│                                        │
│ [ Watch replay ]  [ New game ]         │
└────────────────────────────────────────┘
```

All roles revealed (not blurred) since the game is over. Survival
status: alive = green check, eliminated = badge with the phase they
died in.

**Files**:
- NEW `apps/web/app/room/[id]/components/v2/WerewolfSummary.tsx`
- MOD `WerewolfView.tsx` — when completed, render WerewolfSummary
  above the ChatView/RoundTable (or instead of the table, user
  choice via ViewToggle).

### 5.7e — Debate results view

**Goal**: When a debate finishes, show a stats summary card before
the chat transcript.

**Visual**:
```
┌─────────────────────────────────────┐
│ ✓ 辩论结束                          │
│ "AI 是否应该开源?"                  │
│ 3 rounds · 3 agents · 12 messages   │
│ 2.3 min · $0.045 · 4.2k tokens      │
│                                     │
│ ── 每位参与者 ──                    │
│ [avatar The Optimist] 4 msgs $0.018 │
│  ████████░░░ 42% of discussion      │
│ [avatar The Skeptic]  4 msgs $0.014 │
│  ██████████░ 34% of discussion      │
│ [avatar Pragmatist]   4 msgs $0.013 │
│  ████████░░░ 24% of discussion      │
│                                     │
│ [ Watch replay ]  [ New debate ]    │
└─────────────────────────────────────┘
```

"% of discussion" = tokens / total tokens per agent. Bars use that
agent's theme color.

**Files**:
- NEW `apps/web/app/room/[id]/components/v2/DebateSummary.tsx`
- MOD `RoundtableView.tsx` — render above chat when completed.

### 5.7f — Replay list → grid

Turn the table at `/replays` into a card grid matching Accio agent
grid. Each card:
- Mode icon top-left (🗣️ debate / 🐺 werewolf)
- Title (debate topic or "Werewolf 9p") in large bold
- Subtitle: date + N agents + cost
- Winner badge (werewolf only): village/wolves chip
- Click → `/replay/[id]`

Pagination: 12 cards per page, bottom-right arrow controls.

### 5.7g — Create page polish

Minimal pass — don't rebuild. Adjust:
- Wrap in AppShell (no duplicate header/footer)
- Tighter spacing (24px sections not 32px)
- Agent cards in a horizontal scroll row of "preset" quick-picks
  above the current manual form (clicking a preset fills the form)
- Consistent input styling (matching Accio's `#17181C` surface with
  `#25272C` border, 8px radius)

**Out of scope**: full stepped wizard. The current flat form works;
we polish rather than restructure.

### 5.7h — Landing page polish

With sidebar in place, the current landing's duplicate breadcrumb
goes away. Hero stays centered but:
- Smaller top margin (sidebar provides spatial anchor)
- Mode cards become richer: add a large emoji/icon, hover elevates
- "How it works" 3-step block → maybe move to a bottom strip or
  remove (sidebar is discoverable)

### 5.7i — Mobile + a11y

Was Phase 5.6. Rolls in here:
- Round-table collapses to a grid at ≤640px
- ChatView reduces padding/gutter at ≤640px
- Sidebar off-canvas with hamburger toggle
- Tab order correct across modal / toggle / chat
- Reduced-motion mutes all agora-* animations (already wired)

---

## 5. Explicitly NOT doing (yet)

To keep scope tight:
- **Accio's stepped wizard for agent creation** — too much structural
  change. Current single-page create is fine.
- **Team selector / team switching** — Agora doesn't have the
  concept yet; 4.5c might add it via seat tokens.
- **Agent skill catalog** — Accio has a rich "skills" concept;
  Agora has personas. Don't force-fit.
- **Right rail (team members)** — deferred. The round-table itself
  is our agent roster; a right rail would duplicate.
- **Tournament table** (Accio image 22) — no tournament concept in
  Agora debates. Debate results live in the summary card only.
- **Per-player accent colors in results** — Accio uses distinct
  colors per player. Agora already does this via createAgentColorMap;
  summaries should reuse that mapping.

---

## 6. Open questions for user

1. **Sidebar always visible or togglable?** Accio is always visible.
   I'd default to always visible at ≥1024px. OK?
2. **Results view: overlay or replace?** Werewolf completed → should
   the summary card REPLACE the round-table/chat, or sit ABOVE as a
   banner with the transcript scrolling below? I'd go with "above"
   so the replay is still accessible without clicking through.
3. **Debate stats: % of discussion**, or also show total speaking time
   / token breakdown by provider? I'd keep it simple — % of discussion
   via tokens.
4. **"Recent rooms" in sidebar**: stub it out now (empty section), or
   leave it off entirely until we have the data source? I'd stub.
5. **Replay grid size**: 12 per page fit well at 1400px width? Happy
   to do 8 if you prefer bigger cards.

---

## 7. Execution order + checkpoints

```
Sign-off on this plan (you)
  ↓
5.7c AppShell + Sidebar  [commit + deploy]
  ↓
5.7d Werewolf summary    [commit]  ┐  grouped
5.7e Debate summary      [commit]  ┘
  ↓
5.7f Replay grid         [commit + deploy — visual checkpoint]
  ↓
5.7g Create polish       [commit]  ┐  grouped
5.7h Landing polish      [commit]  ┘
  ↓
5.7i Mobile + a11y       [commit + deploy — final]
```

Each deployed checkpoint pauses for your visual review. No more
blind multi-commit bursts.

---

## 8. Risks

1. **AppShell refactor breaks something page-local** (replay
   playback, admin page). Mitigation: introduce the shell with
   `children` slot that pages opt into; pages that should be
   bare (e.g. `/admin`) can skip the wrap.
2. **Summary cards miscount tokens** because `tokenSummary` may be
   null for new rooms. Mitigation: guard with `?.` and render a
   "stats pending" state.
3. **Mobile round-table will be tight** with 12 seats on 375px.
   Mitigation: fall back to list view below 640px.
4. **i18n keys balloon**. Every new label needs en + zh. Mitigation:
   budget 20 new keys per sub-phase; reuse existing where possible.

---

## 9. What I'll ask from you before coding

Just a 👍 / 👎 on:
- (1) Section 4 scope — anything you want added or cut?
- (2) Open questions in section 6 (or "all your defaults are fine").
- (3) Execution order in section 7.

Then I'll start with 5.7c and show you the shell before going further.
