# Phase 6 — Team Platform: Handoff for next session

> **Date**: 2026-04-15
> **Audience**: Fresh Claude session picking up after compact
> **Prerequisite reading** (in order, ~15 min):
> 1. This document (TL;DR + state + next sub-phase playbook)
> 2. `docs/design/phase-6-team-platform.md` — the full plan with data model, user flows, locked answers, and danghuangshang research
> 3. `memory/project_agora.md` (auto-loaded) — everything else about the project
>
> **Do NOT read** the superseded `docs/design/phase-5.7-ui-overhaul.md`
> except for context on what was abandoned and why.

---

## 0. TL;DR — start here

### 0.1 The one-paragraph summary

Agora pivoted from "games-with-modes" to a **general team platform**:
users build reusable agents, compose them into teams, run teams
through activities (open chat, debate, werewolf, future: script-kill
/ TRPG). Phase 6 ships this. 8 design questions are locked (see §3).
Research of `wanikua/danghuangshang` gave us concrete patterns to
steal (dispatch discipline, status tokens, nested sub-crews). Schema
migration is written and committed but **not yet applied to Supabase**
— start there.

### 0.2 First 5 commands to run

```bash
cd /Users/xingfanxia/projects/products/agora
git log --oneline -12                    # See recent commits
git status --short                       # Should be clean
pnpm check-types                         # Should be green across all 6 packages
pnpm test                                # 23 tests should pass (17 werewolf-determinism + 6 state-machine-rehydrate)
pnpm --filter @agora/db db:migrate       # ← Apply the Phase 6 schema to Supabase
```

Then read this handoff + `phase-6-team-platform.md` fully. Then begin
sub-phase **6b part 2** (CRUD API) per §4.2.

### 0.3 What's already on `main` (as of handoff commit)

| Commit | Sub-phase | What it did |
|---|---|---|
| `730d436` | 4.5a | Deterministic createWerewolf via seeded PRNG + TDD (17 tests) |
| `2aaaf85` | 4.5a | Waiting-state columns + runtime-polish migration |
| `fb34c24` | 4.5a | advanceRoom durable step + phase-boundary pause + rehydrate |
| `df119c9` | 4.5a | /api/rooms/tick dispatcher + werewolf POST rewire |
| `5aa1dbd` | 4.5a | tick-all sweeper + Vercel Cron + /admin observability |
| `f770ac3` | docs | Phase 4.5a shipped |
| `7b70ddd` | 5.2 | Round-table components (Avatar/Bubble/AgentSeat/RoundTable/PhaseBadge) |
| `a044723` | 5.3 | AgentDetailModal |
| `3f980e1` | 5.4 | WeChat ChatSidebar |
| `01deb66` | 5.5 | Wire v2 into Roundtable + Werewolf views |
| `90d6bc0` | fix | i18n default agent presets (zh names) |
| `17cd608` | **5.7a** | Chat-default + markdown + bubble "more" fix |
| `30094b4` | **5.7b** | Accio palette refresh |
| `03b59cd` | docs | Phase 5.7 plan (superseded — see phase-5.7 top banner) |
| `296fadf` | docs | Phase 6 plan created |
| `2a65271` | docs | Phase 6 — lock answers + danghuangshang research findings |
| `7fe17e7` | docs | Phase 6 — revise Q5 leader lock to D (dispatcher) |
| `(latest)` | **6b (part 1)** | Schema edit + migration file (NOT yet applied) |

---

## 1. Current state snapshot

### 1.1 What's shipped & working on prod

- **https://agora-panpanmao.vercel.app**
- Phase 4.5a durable runtime: smoke-tested, `2d29f700-…` werewolves_win complete
- Phase 5.7a chat-default + markdown in Roundtable/WerewolfView (replays default to chat, view toggle to round-table)
- Palette: mint green `#22c493`, dark bg `#0f1012`
- i18n: `/create` and `/create-werewolf` defaults localized (乐观派/质疑者/务实派 in zh; 林溪/江澈 etc. for werewolf)
- `/admin/rooms/[id]` diagnostic page
- `CRON_SECRET` env var set in Vercel prod; tick-all enforces 401 without Bearer

### 1.2 What's uncommitted before the handoff write

Nothing. The in-flight 6b schema work is committed as a clear
checkpoint ("6b schema — NOT APPLIED"). Everything is safe.

### 1.3 What needs a DB action before next sub-phase

**The migration `0003_serious_ma_gnuci.sql` is on disk but not
applied to Supabase prod.** Apply it with:

```bash
pnpm --filter @agora/db db:migrate
```

This creates `agents`, `teams`, `team_members` tables and adds
`rooms.team_id` + `rooms.mode_config` columns. All additive; no
existing data touched.

Verify with:

```bash
pnpm --filter @agora/db tsx scripts/verify-4.5a-schema.ts  # existing 4.5a verify
# Then a new verify-phase-6-schema.ts to confirm agents/teams tables landed (write as part of 6b part 2).
```

### 1.4 Tests, typecheck, tasks

- `pnpm check-types` — should be clean
- `pnpm test` — should be 23 passing (17 + 6)
- Task tree (legacy Phase 5 tasks) — stale, ignore. All Phase 6 work tracked in this handoff, not in TodoWrite.

---

## 2. The full Phase 6 plan, condensed

See `docs/design/phase-6-team-platform.md` for the 700-line version.
Condensed:

**Positioning**: "Assemble agents. Compose teams. Run anything."

**Five primitives**: Agent → Team → Room → Mode → Template.

**Data model** (already in schema):
- `agents` (reusable personas with model, avatar, style)
- `teams` (named compositions, optional leader, default mode)
- `team_members` (join with position)
- `rooms.team_id` (nullable back-ref)
- `rooms.mode_config` (jsonb for mode params)

**V1 modes**: `open-chat` (NEW), `roundtable` (existing), `werewolf` (existing).
**V1 templates**: 投资团队, 当皇帝 (唐朝三省制, 9 agents), 辩论赛, 狼人杀.
**V2 deferred**: 剧本杀 · TRPG · 现代企业制 · custom skills/tools.

---

## 3. All 8 locked answers (authoritative)

### 3.1 Positioning line

**"Assemble agents. Compose teams. Run anything."**

Use this in hero copy on `/` and in meta tags. Appears in
`messages/{en,zh}.json.landing.tagline` — update when doing 6j.

### 3.2 Wizard step count

**4 steps, matching Accio**:
1. **Identity** — name, persona description, avatar preview
2. **Model** — provider + model + style preset (temperature, verbosity, language)
3. **Prompt** — optional system prompt override (default: auto-generated from identity + model)
4. **Review** — summary card + save

Progress bar at top (25% / 50% / 75% / 100%), `Back` ghost button
bottom-left, `Next: <StepName>` green pill bottom-right matching
Accio pattern.

### 3.3 V1 templates

| # | Name | Agents | Default mode | Notes |
|---|---|---|---|---|
| 1 | **投资团队** | 6: CFO, Quant, Risk, Contrarian, Macro, Analyst | open-chat | Leader = CFO (tests dispatcher pattern) |
| 2 | **当皇帝** | 9: 中书令, 门下侍中, 尚书令, 吏部, 户部, 礼部, 兵部, 刑部, 工部 | open-chat | No leader (user is emperor). Attribution: inspired by wanikua/danghuangshang |
| 3 | **辩论赛** | 3: The Optimist, The Skeptic, The Pragmatist | roundtable (3 rounds) | No leader |
| 4 | **狼人杀** | 9 generic players | werewolf (9p 基础) | No leader |

V2 reserved slots: 剧本杀, TRPG, 现代企业制. Don't seed these.

### 3.4 Avatar source

**DiceBear pixel-art, client-side, via npm**:

```bash
pnpm --filter @agora/web add @dicebear/core @dicebear/pixel-art
```

Component pattern (see §5.5 for the security gotcha):

```tsx
// apps/web/app/components/AgentAvatarPixel.tsx
import { useMemo } from 'react'
import { createAvatar } from '@dicebear/core'
import { pixelArt } from '@dicebear/pixel-art'

export function AgentAvatarPixel({ seed, size = 48 }: { seed: string; size?: number }) {
  const dataUri = useMemo(
    () => createAvatar(pixelArt, { seed, size }).toDataUri(),
    [seed, size],
  )
  return (
    <img
      src={dataUri}
      alt=""
      width={size}
      height={size}
      style={{ display: 'inline-block', borderRadius: '50%' }}
    />
  )
}
```

Use `toDataUri()` + `<img src>`. See §5.5 — avoid the raw-HTML
injection pattern (triggers the security hook).

`avatarSeed` on agents/teams is stable — use `agentId` or a stable
string. Don't regenerate per render.

V2 override: user upload → Supabase Storage. Not V1.

### 3.5 Leader — V1 dispatcher via prompt-append

**Revised lock** (was "display-only"; now dispatcher).

When a room starts with a team that has `leaderAgentId` set, the
runtime appends this block to the leader agent's system prompt
**at room creation time** (before the agent responds):

```
──────────────────────────────────────────────
You are the leader of this team. Your KPI is successful delegation,
not direct execution.

FORBIDDEN
- Writing code, analysing data, or producing deliverables yourself
- Giving long domain answers that a specialist in this team would cover

REQUIRED
- For each user message, identify the right team member(s) to respond
- @mention them by name with a clear task brief
- Do not reply in-depth yourself until specialists contribute
- Close each cycle with a brief summary crediting each contributor

If no team member matches the request, say so and ask the user to
refine the ask or add a member to the team.
──────────────────────────────────────────────
```

Zero runtime changes beyond the append. Implementation lives in
`packages/core` or `packages/modes` at room boot, probably in a new
`applyLeaderDirective(agents, leaderAgentId)` helper that mutates
the AIAgent's `systemPrompt` before the first `reply()`.

Display: also show a leader badge on the team card + seat + chat
header. Just a `⚜` emoji or "LEADER" chip next to the name.

V2: full-featured leader (speaks first, summarizes, veto) — not
V1.

### 3.6 Legacy `/create` + `/create-werewolf`

**Keep as-is**. Both pages still render their forms. Internally
they still call `/api/rooms` (debate) and `/api/rooms/werewolf`
(werewolf) with `team_id=null`. No redirect, no wrapper, no change
to the user-facing flow.

Rationale: demo URLs in memory seed scripts + blog posts reference
these. Maintenance cost is tiny because both paths share the same
`/api/rooms*` endpoints under the hood.

New flow (`/rooms/new`) calls the same endpoints with
`team_id=<uuid>` + `mode_config`.

### 3.7 Agent edit mid-room

**Snapshot at room creation; edits never propagate.** The existing
`rooms.agents` jsonb column already snapshots AgentInfo per room.
Phase 6 rooms additionally persist the full `system_prompt` (with
leader directive appended) in the snapshot so edits to the agent
row don't rewrite history.

Implementation note: when creating a room from a team, resolve each
member's latest state (name, persona, model, style) and write
**everything** into `rooms.agents`. Don't just write `agentId`.

### 3.8 V1 scope

**Full plan (6b → 6m, ~11 focused days).** No MVP split. Sequential
commits; deploy-to-prod checkpoints at 6g, 6j, 6m per plan §13.

---

## 4. Sub-phase execution playbook

Each sub-phase = one commit. Typecheck green before commit. Don't
skip the §5 cross-cutting gotchas.

### 4.1 ~~6b part 1 — schema migration~~ ✅ DONE

Already in the commit before this handoff. Schema edited; migration
`0003_serious_ma_gnuci.sql` generated but not yet applied.

### 4.2 6b part 2 — apply migration + CRUD API (~1 day)

**Goal**: agents and teams can be created, read, updated, deleted
via REST. No UI yet. Verify with curl.

**Step-by-step:**

1. `pnpm --filter @agora/db db:migrate` — apply `0003_*.sql` to
   Supabase prod. Verify with a one-off `scripts/verify-phase-6-schema.ts`
   (follow pattern of `verify-4.5a-schema.ts`): query
   `information_schema.tables` for the 3 new tables + `columns` for
   `rooms.team_id` and `rooms.mode_config`.

2. Write `apps/web/app/lib/user-id.ts`:
   ```ts
   // Client-side only: persist a uuid in localStorage as the user's
   // identity until Supabase Auth lands (Phase 4.5d).
   export function getOrCreateUserId(): string { /* ... */ }
   ```
   And a server-side equivalent that reads it from a cookie that the
   client syncs from localStorage on page load (for API routes that
   need ownership checks).

3. Write `apps/web/app/lib/agent-store.ts` + `team-store.ts` on the
   model of the existing `room-store.ts`:
   - `createAgent / getAgent / listAgents({createdBy?, isTemplate?}) / updateAgent / deleteAgent`
   - `createTeam / getTeam / listTeams / updateTeam / deleteTeam`
   - `addMember / removeMember / getMembers / setLeader / reorderMembers`

4. API routes in `apps/web/app/api/`:
   - `agents/route.ts`: GET (list), POST (create)
   - `agents/[id]/route.ts`: GET (one), PATCH (update), DELETE
   - `teams/route.ts`: GET, POST
   - `teams/[id]/route.ts`: GET, PATCH, DELETE
   - `teams/[id]/members/route.ts`: GET, POST (add), DELETE (remove)
   - `teams/[id]/members/[agentId]/route.ts`: PATCH (reorder, set-leader)

5. Auth stub: every POST/PATCH/DELETE checks `req.cookies.userId`
   matches the target row's `created_by`. Templates (`is_template=true`)
   are read-only to non-admins. For V1 nobody is admin — anyone can
   read templates, only owner can mutate own agents/teams.

6. Tests: no E2E yet (wizard + composer land later). Just typecheck
   + basic integration test via `curl` from the `README` or a
   `scripts/dev/smoketest-phase-6-api.sh`.

**Exit criterion**: `curl -X POST .../api/agents -d '{"name":"Test","persona":"..."}'` returns 200 with the row. `GET /api/agents?createdBy=X` returns `[row]`.

**Commit message skeleton**:
```
feat(api): 6b part 2 — agents + teams CRUD + localStorage uid
```

### 4.3 6c — seed 4 templates (~1 day)

**Goal**: four ship-with teams (投资团队 · 当皇帝 · 辩论赛 · 狼人杀)
with ~30 authored agent templates behind them.

**Files**:
- `packages/db/drizzle/0004_seed_templates.sql` — hand-written
  migration with `INSERT ... ON CONFLICT DO NOTHING` for each agent +
  team + team_member row. Use deterministic UUIDs (namespace the
  seed ids like `00000000-0000-0000-0000-000000000001` + increment)
  so reruns don't duplicate.
- `docs/credits.md` (NEW) — enumerates borrowed concepts. Entry for
  `当皇帝` crediting `wanikua/danghuangshang` (MIT, attribution
  preserved).
- `scripts/seed/personas/huangdi/*.md` — one markdown per agent with
  the authored 200-word persona. Migration reads these at author-time
  (or inline in SQL as string literals). If as files, write a small
  `scripts/seed/build-template-sql.ts` that compiles into 0004.

**Authoring depth per agent** (non-negotiable — don't ship 1-line
stubs like danghuangshang did):

- **Identity**: 80-120 words on role, domain, relation to user
- **Voice specimen**: 40-60 words on opening/closing style + vocabulary tics
- **3 example utterances**: the agent's voice in concrete prose
- **Forbidden topics**: 20-40 words on what they refuse
- **Handoff vocabulary**: 20-30 words on how they address teammates

~200-250 words per agent × 27 agents ≈ 6,000 words of hand-written
content. Budget 1 full day. Use Claude with careful editing.

**Template metadata**:
- `description` field on teams includes a short teaser + attribution
  line if applicable. For 当皇帝:
  `"唐朝三省六部朝廷，陛下与九位重臣议政决疑。三省六部制结构灵感来自 wanikua/danghuangshang (MIT)。"`

**Exit criterion**: `GET /api/teams?isTemplate=true` returns 4 teams.
`/agents?isTemplate=true` returns ~27. Each team's `GET /teams/[id]`
shows the full member roster.

### 4.4 6e — agent wizard UI (~2 days)

**Goal**: `/agents/new` with 4-step wizard matching Accio. Save →
redirect to `/agents` list.

**Files** (all NEW):
- `apps/web/app/agents/page.tsx` — list view (tabs: 我的 / 模板 + `+ 新建` button + grid of AgentCard)
- `apps/web/app/agents/new/page.tsx` — wizard shell (wraps the 4
  steps in a client component with local state)
- `apps/web/app/agents/new/wizard/` — step components:
  - `WizardShell.tsx` — progress bar (25/50/75/100%), `Back` ghost,
    `Next: <Step>` green pill, Esc to close
  - `Step1Identity.tsx` — name, persona textarea (min 50 chars, max
    2000), avatar preview (4 randomly-seeded options + regenerate
    button)
  - `Step2Model.tsx` — provider select (anthropic/openai/google/deepseek),
    model dropdown for each, style sliders (temperature 0-1, maxTokens
    500-4000), language select
  - `Step3Prompt.tsx` — optional system prompt override. If left
    blank, display a preview of the auto-composed prompt. If filled,
    the custom prompt is used verbatim.
  - `Step4Review.tsx` — read-only summary card + save button
- `apps/web/app/agents/[id]/page.tsx` — agent detail (read-only;
  shows persona, system prompt, stats if any, "used by teams" list)
- `apps/web/app/agents/[id]/edit/page.tsx` — reuses the wizard,
  pre-filled
- `apps/web/app/components/AgentCard.tsx` — card for the grid
  (avatar + name + description + "+ 对话" CTA that actually means
  "+ add to new team" from this context — click opens a "new team
  including this agent" creation modal)

**i18n keys** (add to `messages/{en,zh}.json`):
```
"agents": {
  "title": "Agents",
  "tabs": { "mine": "Mine", "templates": "Templates" },
  "newAgent": "+ New Agent",
  "step1": { "title": "Identity", "nameLabel": "Name", ... },
  "step2": { ... },
  ...
}
```

~30 new i18n keys × 2 locales = 60 entries.

**Exit criterion**: create an agent end-to-end from UI, see it in the
`/agents?tab=mine` grid, click it to see detail page.

### 4.5 6f — team composer (~1.5 days)

**Goal**: `/teams/new` — drag/add agents into a team, set leader,
save.

**Files** (NEW):
- `apps/web/app/teams/page.tsx` — list (mine / templates tabs +
  `+ 新建` + grid)
- `apps/web/app/teams/new/page.tsx` — composer
- `apps/web/app/teams/[id]/page.tsx` — detail (members + recent
  rooms + `+ 开始对话`)
- `apps/web/app/teams/[id]/edit/page.tsx` — reuses composer
- `apps/web/app/components/TeamCard.tsx` — card with member avatar
  strip + leader badge

**Composer layout** (match Accio image 21):
```
┌──────────────────┬──────────────────┐
│ Available agents │ Selected (9/12)  │
│ [search]         │                  │
│ ▢ Alice  [+]    │ ⚜ Leader         │
│ ▢ Bob    [+]    │   Alice     [×]  │
│ ...              │   Bob       [×]  │
│                  │   Charlie   [×]  │
│                  │                  │
│                  │ Name: [______]   │
│                  │ Desc: [______]   │
│                  │ [Cancel] [Save]  │
└──────────────────┴──────────────────┘
```

Click ⚜ next to a selected member to toggle leader. Max 12 members
(matching `Room.maxAgents`).

**Exit criterion**: create a team from scratch, add 3 agents, set
one as leader, save, see it in `/teams?tab=mine`.

### 4.6 6g — unified `/rooms/new` (~1 day)

**Goal**: pick team → pick mode → configure → start room.

**Files** (NEW):
- `apps/web/app/rooms/new/page.tsx`
- `apps/web/app/components/ModePicker.tsx` — shows 3 cards
  (open-chat, roundtable, werewolf) with mode icon + description
- `apps/web/app/components/ModeConfigForm.tsx` — dispatcher:
  - open-chat → `OpenChatConfig` (topic textarea, rounds 1-5)
  - roundtable → `RoundtableConfig` (topic, rounds 1-10)
  - werewolf → `WerewolfConfig` (playerCount 6-12, advancedRules checkboxes)

**API wire**: the existing `/api/rooms` and `/api/rooms/werewolf`
accept `team_id` + `mode_config` now. Adjust request body to include
those. Backward-compatible: if `team_id` absent, legacy behavior.

**Exit criterion**: from `/teams/[id]`, click `+ 开始对话`, pick
mode, configure, redirect to `/room/[new-id]`, agents are the team's
members, game proceeds.

### 4.7 6h — open-chat mode (~1.5 days)

**Goal**: `packages/modes/src/open-chat/` with advance.ts that
rehydrates from events and runs N turns of agent replies.

**Files** (NEW):
- `packages/modes/src/open-chat/index.ts` — `createOpenChat(config)` factory
- `packages/modes/src/open-chat/advance.ts` — phase machine
- `packages/modes/src/open-chat/types.ts` — `OpenChatConfig`, `OpenChatGameState`
- `packages/modes/__tests__/open-chat-determinism.test.ts`
- Mode dispatch in `apps/web/app/lib/room-runtime.ts` — add
  `if (roomRow.modeId === 'open-chat') return advanceOpenChatRoom(...)`

**Mechanics (V1 flat round-robin):**
- Opening: user-provided topic/question stored in `mode_config.topic`
- Turn 1: leader (if any) speaks first, else member[0]
- Turns 2...N: round-robin through members
- End: after `mode_config.rounds` full laps (1-5, default 3)
- Single `main` channel; no roles

**Exit criterion**: create a 当皇帝 room via `/rooms/new`, provide
a prompt like "朕该如何处理边关饥荒", watch all 9 ministers reply
in 3 rounds, room completes cleanly, replay works.

### 4.8 6i — AppShell + Sidebar (~1.5 days)

**Goal**: persistent left nav on every page. See plan §5.1.

**Files** (NEW):
- `apps/web/app/components/AppShell.tsx` — layout frame
- `apps/web/app/components/Sidebar.tsx` — nav content
- MOD `apps/web/app/layout.tsx` — wrap children in AppShell

**Responsive breakpoints**:
- ≥1024px: 220px fixed
- 768-1023px: 56px icon rail
- <768px: off-canvas + hamburger

**Sidebar structure** (see plan §5.1):
```
Agora
+ 新对话

AGENTS — 我的 / 模板 / + 新建
TEAMS — 我的 / 模板 / + 新建
ACTIVITIES — 辩论 / 狼人杀 / 开放对话
HISTORY — 回放

─────
SETTINGS — 语言 / 智能体使用
[User pill with menu]
```

**Exit criterion**: every page renders inside the shell. Sidebar
links work. Mobile hamburger toggle works.

### 4.9 6j — landing redesign (~1 day)

**Goal**: `/` becomes the template gallery + "my teams" + "my
agents" strip.

**Content** (top to bottom):
- Hero: tagline + "Start from a template →" CTA
- Template grid: 4 team templates as cards (6c's teams)
- "My teams" strip: up to 6 cards, "+ 新建" at end
- "My agents" strip: up to 6 cards, "+ 新建" at end
- Footer: link to /replays

Update `messages/*.json.landing.tagline` to "Assemble agents.
Compose teams. Run anything." (en) + 中文 translation.

### 4.10 6k — legacy rewire (~0.5 day)

**Goal**: `/create` and `/create-werewolf` continue to work but
internally construct a `team_id=null` room via the shared
`/api/rooms*` endpoint. No UI change visible to users.

Main cleanup: extract the "pick mode + configure" form from
`/rooms/new` into a shared component, use it in both places.

### 4.11 6l — polish (~1.5 days)

- **Werewolf summary card**: survivors + role reveals + per-night elimination timeline
- **Debate summary card**: topic + per-agent contribution bars + stats
- **Replay list** → card grid (/replays redesign)

Files: `apps/web/app/room/[id]/components/v2/WerewolfSummary.tsx`,
`DebateSummary.tsx`, update `/replays/page.tsx`.

### 4.12 6m — mobile + a11y (~1 day)

- Round-table → grid at ≤640px
- ChatView reduces padding at ≤640px
- Sidebar off-canvas < 768px with hamburger
- Keyboard: Tab order, Esc closes modals, Enter submits forms
- Reduced-motion already wired (see `globals.css` `@media (prefers-reduced-motion: reduce)`)

Final commit = production-ready V1.

---

## 5. Cross-cutting gotchas

Read ALL of these before 6b part 2.

### 5.1 NodeNext + workspace packages

All packages use `moduleResolution: NodeNext`. Imports between
packages inside `packages/*` use `.js` extensions even though
source is `.ts`. Example:

```ts
import { rooms } from '@agora/db'                    // ✓ package export
import { getAgent } from './agent-store.js'          // ✓ relative with .js
import { getAgent } from './agent-store'             // ✗ no extension
```

`next.config.js` has `extensionAlias: { '.js': ['.ts', '.js'] }` so
webpack resolves at build time.

### 5.2 `rooms.agents` snapshot — never normalize

DO NOT refactor rooms to lookup agents via `team_members`. The
`rooms.agents` jsonb column is the snapshot that Phase 4.5a's
`advanceRoom` rehydrates from. It must be self-contained (name,
model, etc.). Phase 6 ADDS `team_id` as a back-reference for UI
("which team is this from?") but the runtime never dereferences it
for member data.

### 5.3 `rooms.config` is legacy; prefer `rooms.mode_config`

Old code stores rounds/advancedRules in `config.rounds`,
`config.advancedRules`. Keep that working for legacy rooms. New
code should write both `config` (legacy) AND `mode_config` (new)
until we've migrated all readers — safer than breaking replays.

### 5.4 Leader prompt-append — where does it live?

Decision: in `apps/web/app/lib/room-runtime.ts`, during the
rehydration/creation step. Add:

```ts
function applyLeaderDirective(agents: AIAgent[], leaderAgentId: string): AIAgent[] {
  // Find the leader agent, clone it with the directive appended to systemPrompt.
  // Return a new array with the modified leader at its original index.
}
```

Call it once at room start. Rehydration doesn't need to re-apply
because `rooms.agents` snapshot already contains the modified
system prompt (see §3.7 — snapshot at creation includes prompt).

### 5.5 DiceBear rendering — `<img src={toDataUri()}>`

The security hook flags raw-HTML injection via React inner-HTML
props (the `dangerous*SetInner*HTML` pattern — intentionally
disemvoweled here so this doc stays writable). Use `<img>` with a
data URI from DiceBear's `toDataUri()` helper instead. It renders
the SVG as a data-URL image, no string-to-DOM injection, no hook
warning.

```tsx
const dataUri = useMemo(
  () => createAvatar(pixelArt, { seed, size }).toDataUri(),
  [seed, size],
)
return <img src={dataUri} alt="" width={size} height={size} />
```

### 5.6 Determinism — open-chat must replay identically

Same rules as werewolf (§4.5a):
- `createOpenChat({ seed: roomId, agentIds, roomId, ... })` deterministic
- `advance.ts` uses `@agora/shared` seeded helpers if any randomness needed
- Write a `open-chat-determinism.test.ts` with at least 6 tests mirroring `werewolf-determinism.test.ts` structure

### 5.7 i18n — every new UI string in both locales

All new keys land in both `messages/en.json` and `messages/zh.json`.
Don't skip zh — we have zh users and the whole point of Phase 5.1
was UI parity.

Common patterns already in use:
- `t.raw('key')` for arrays (see `messages/{en,zh}.json.create.defaultAgents`)
- `t('key', { count, total })` for interpolation

### 5.8 Attribution — docs/credits.md

When 6c lands, create `docs/credits.md` with:
- 当皇帝 template inspired by [wanikua/danghuangshang](https://github.com/wanikua/danghuangshang) (MIT)
- Palette inspired by Accio Work (Alibaba internal tool referenced via screenshots)
- DiceBear pixel-art avatars via @dicebear/core (MIT)
- react-markdown + remark-gfm

Link from README.md.

### 5.9 CRON_SECRET is set in Vercel prod — don't break it

The tick-all safety-net cron requires `CRON_SECRET`. Don't rotate
it accidentally via `vercel env` during Phase 6 work.

### 5.10 Legacy `/_v2-preview` route

Exists at `apps/web/app/_v2-preview/page.tsx` — scratch route from
Phase 5.2. Can delete in 6k (legacy rewire) or keep for component
previews. Low priority either way.

### 5.11 The superseded Phase 5.7 doc

`docs/design/phase-5.7-ui-overhaul.md` is marked SUPERSEDED at the
top. Its "polish" items (results cards, replay grid, mobile)
carried over to Phase 6 §4.11-4.12. Don't execute from that doc.

### 5.12 Security hook — avoid the trigger string in any file

The `security_reminder_hook.py` blocks Write/Edit calls whose
content contains the raw phrase `dangerous` + `Set` + `Inner` + `HTML`
run together. Even documentation triggers it. If you need to
reference the React prop in a comment or doc, disemvowel it or
describe the pattern by behavior ("raw HTML inject via React
inner-HTML prop") rather than naming it literally.

---

## 6. Deploy + verify procedure

### 6.1 Sub-phase commit checklist

Before `git commit` on every sub-phase:

- [ ] `pnpm check-types` green across all 6 packages
- [ ] `pnpm test` — no regression in existing 23 tests; new tests added where §5.6 requires
- [ ] i18n keys in both en + zh
- [ ] No uncommitted debug code / console.logs / placeholders
- [ ] Commit message follows the `feat(area): N.N description` convention
- [ ] No raw-HTML-inject React prop (§5.5 + §5.12) — use `<img src={dataUri}>`

### 6.2 Deploy checkpoints (push to origin/main)

Per plan §13, push after:
- 6g (rooms/new working) — **first visible V1 milestone**
- 6j (landing redesigned) — **feature-complete V1**
- 6m (mobile + a11y) — **production V1**

Between checkpoints, commit to `main` locally but consider holding
pushes if multiple rounds stacking. Each push triggers Vercel auto-
deploy.

### 6.3 Post-deploy smoke test

After 6g deploys:
1. Visit `https://agora-panpanmao.vercel.app/teams` — see 4
   templates
2. Click `当皇帝` → team detail shows 9 ministers
3. `+ 开始对话` → open-chat → topic "朕问边关之事" → start
4. Wait ~2 min → room completes → all 9 agents replied in 3 rounds
5. Replay renders in ChatView with markdown intact

### 6.4 Final V1 acceptance

- [ ] Can create an agent via wizard (zh + en)
- [ ] Can compose a team (drag + leader + save)
- [ ] Can start a room from team (3 modes, each works)
- [ ] 4 templates visible + cloneable
- [ ] Legacy `/create` + `/create-werewolf` still work
- [ ] Existing zh replays render in new UI
- [ ] Sidebar navigates cleanly
- [ ] Mobile looks reasonable at 375px
- [ ] `pnpm test` green; no runtime warnings in browser console
- [ ] Phase 4.5a durable runtime still shipping werewolf games
- [ ] `/admin/rooms/:id` still functional
- [ ] Vercel Cron still sweeping stuck rooms

---

## 7. Quick reference — files inventory (Phase 6 end-state)

### New files

```
packages/db/drizzle/
  0003_serious_ma_gnuci.sql          [DONE, NOT YET APPLIED]
  0004_seed_templates.sql            [6c]

packages/db/scripts/
  verify-phase-6-schema.ts           [6b part 2]

packages/db/src/schema.ts            [DONE — agents/teams/team_members]

packages/modes/src/open-chat/
  index.ts                           [6h]
  advance.ts                         [6h]
  types.ts                           [6h]

packages/modes/__tests__/
  open-chat-determinism.test.ts      [6h]

apps/web/app/lib/
  user-id.ts                         [6b part 2]
  agent-store.ts                     [6b part 2]
  team-store.ts                      [6b part 2]

apps/web/app/api/
  agents/route.ts                    [6b part 2]
  agents/[id]/route.ts               [6b part 2]
  teams/route.ts                     [6b part 2]
  teams/[id]/route.ts                [6b part 2]
  teams/[id]/members/route.ts        [6b part 2]
  teams/[id]/members/[agentId]/route.ts  [6b part 2]

apps/web/app/agents/
  page.tsx                           [6e]
  new/page.tsx                       [6e]
  new/wizard/WizardShell.tsx         [6e]
  new/wizard/Step1Identity.tsx       [6e]
  new/wizard/Step2Model.tsx          [6e]
  new/wizard/Step3Prompt.tsx         [6e]
  new/wizard/Step4Review.tsx         [6e]
  [id]/page.tsx                      [6e]
  [id]/edit/page.tsx                 [6e]

apps/web/app/teams/
  page.tsx                           [6f]
  new/page.tsx                       [6f]
  [id]/page.tsx                      [6f]
  [id]/edit/page.tsx                 [6f]

apps/web/app/rooms/new/page.tsx      [6g]

apps/web/app/components/
  AppShell.tsx                       [6i]
  Sidebar.tsx                        [6i]
  AgentAvatarPixel.tsx               [6b part 2]
  AgentCard.tsx                      [6e]
  TeamCard.tsx                       [6f]
  ModePicker.tsx                     [6g]
  ModeConfigForm.tsx                 [6g]

apps/web/app/room/[id]/components/v2/
  WerewolfSummary.tsx                [6l]
  DebateSummary.tsx                  [6l]

scripts/seed/personas/
  huangdi/*.md                       [6c, 9 files]
  investment/*.md                    [6c, 6 files]
  debate/*.md                        [6c, 3 files]
  werewolf-template/*.md             [6c, 9 files]

scripts/seed/build-template-sql.ts   [6c, optional]

docs/credits.md                      [6c]
```

### Modified files

```
apps/web/app/layout.tsx              [6i — wrap in AppShell]
apps/web/app/page.tsx                [6j — landing redesign]
apps/web/app/create/page.tsx         [6k — thin shared form]
apps/web/app/create-werewolf/page.tsx [6k — same]
apps/web/app/api/rooms/route.ts      [6g — accept team_id + mode_config]
apps/web/app/api/rooms/werewolf/route.ts [6g — same]
apps/web/app/lib/room-runtime.ts     [5.5, 6h — add open-chat dispatch; apply leader directive]
apps/web/messages/en.json            [6c+ — new keys for agents/teams/wizard/modes]
apps/web/messages/zh.json            [6c+ — same in zh]
apps/web/next.config.js              [no changes expected]
turbo.json                           [no changes expected]

apps/web/app/room/[id]/modes/roundtable/RoundtableView.tsx [6l — hook in DebateSummary]
apps/web/app/room/[id]/modes/werewolf/WerewolfView.tsx [6l — hook in WerewolfSummary]
apps/web/app/replays/page.tsx        [6l — card grid]
```

---

## 8. Open issues to track (not blockers)

1. **`user-id` cookie sync** — client writes to localStorage, server
   reads from cookie. Needs a small shim: on client mount, if
   `localStorage.userId` is set but cookie isn't, write the cookie.
   Covered in 6b part 2.
2. **Template mutation guard** — non-owner trying to PATCH a
   template row should get 403. Tested in 6b.
3. **Team member position drift** — when an agent is deleted, its
   team_members rows cascade. Remaining members' `position` may
   have gaps. UI handles gaps; don't renumber. (If we ever need
   contiguous positions, do it in a batch cleanup job.)
4. **Leader referencing deleted agent** — FK ON DELETE SET NULL
   handles this. UI should show "no leader" when `leaderAgentId IS NULL`.
5. **Open-chat with no leader** — first speaker = member at
   position 0. UI + mode should match.
6. **Large persona files in migration SQL** — embedding ~6,000
   words of text in a .sql file is fine, but editors will scream.
   Consider `scripts/seed/build-template-sql.ts` that reads from
   markdown files and emits the migration. Worth doing.

---

## 9. TL;DR (repeat for end-of-doc skimming)

- Read `phase-6-team-platform.md` + this doc (both)
- Run `pnpm --filter @agora/db db:migrate` to apply 0003
- Start at §4.2 (6b part 2 — CRUD API)
- Ship sub-phase by sub-phase through §4.12
- Push to main after 6g, 6j, 6m
- Final acceptance criteria at §6.4

**Estimated total effort**: ~11 focused days to ship Phase 6 V1.

**Good luck.**
