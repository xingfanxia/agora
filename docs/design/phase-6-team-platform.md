# Phase 6 — Team Platform (the real Agora)

> **✅ SHIPPED 2026-04-15** (commit `f5d71c5`). All 8 locked design
> answers executed. Plan kept for historical reference; for current
> state see `memory/project_agora.md` and `docs/design/workflow-architecture.md`.

> **Date**: 2026-04-15
> **Trigger**: User feedback — "our roundtable and 狼人杀 basically is
> two modes for a team room, and I like having customized agent setup
> + skills, and forming teams. Then we can do roundtable debate,
> 狼人杀, 剧本杀 in the room. And user can setup other general room
> discussion like Accio Work shows — 投资团队, 当皇帝, etc. I don't
> want to limit ourself to a game setup."
>
> **What this supersedes**: Phase 5.7 UI overhaul. The redesign was
> the right instinct but at the wrong layer — we were polishing the
> game-centric UI when the product itself needs to pivot.
>
> **Preserved from prior work**: Phase 4.5a durable runtime (already
> mode-agnostic), Phase 5.7a chat-default + markdown, Phase 5.7b
> palette. These directly support the new model.

---

## 0. TL;DR

Agora becomes what its CLAUDE.md always said it was: **a general-
purpose multi-agent collaboration platform**. Games are one activity
category among many.

Five primitives:
- **Agent** — reusable persona: name, description, model, style, avatar
- **Team** — a named composition of agents with an optional leader
- **Room** — a session where a team runs an activity
- **Mode** — the activity: open chat, debate, werewolf, (future: script-kill, TRPG)
- **Template** — cloneable starter agents, teams, and rooms

Agents and teams are first-class and persistent. Users build a roster
once, use it across many rooms.

**V1 ships** (7-10 focused days): agent CRUD + team CRUD + new room
flow + open-chat mode + sidebar nav + 4 starter templates.

**V2 adds** (later): skills catalog, tool use, auth (4.5d), sharing,
marketplace.

---

## 1. Why this shift, why now

### 1.1 The game-centric framing is limiting

Phase 3-5 built rich werewolf + debate modes. The UI, the create
pages, the landing — all presume "pick a game, go play". That's the
wrong shape for where the product is headed:

- **Users don't think in modes; they think in teams.** "I want my
  court of advisors" is a team goal. What they DO with that team (ask
  questions, run scenarios, argue) is secondary.
- **Retention comes from saved state.** Re-creating 6 personas every
  time you want a debate is friction that kills repeat use. Accio's
  power comes from "my agents" being a durable object.
- **The architecture already supports it.** Modes in `packages/modes`
  are pluggable. Phase 4.5a made the runtime mode-agnostic and
  durable. We've been building the right engine; we just put
  game-shaped UI on top.

### 1.2 What Accio Work demonstrates

From the 16 reference screenshots, Accio's product shape:

- **Left sidebar** is the permanent nav: 智能体 / 能力 / 团队 / 消息
- **Agents** have identities (name, avatar, persona, model, style)
  and abilities (tools, skills)
- **Teams** are compositions of agents with an optional leader
- **Stepped wizard** (4 steps) for creating agents: Identity → Tools
  → Skills → User Profile
- **Card grids** for browsing agents + teams
- **Quick-create** top-left: "+ 新消息"
- **Chat room** view: agent messages flow as markdown, user messages
  are green right-aligned bubbles, team roster is a toggleable right
  rail
- **Templates** visible in creation flows (blank, Daily Assistant,
  Shopify Operator, Coder, E-commerce Expert, Dropshipper)

Our takeaway: **the unit of reuse is the agent, not the room.**

### 1.3 This is the original vision, pulled forward

`/apps/web/CLAUDE.md` (or project-level) already says:
> Agora is a general-purpose multi-agent collaboration platform.
> Games are the initial wedge; the architecture must support
> arbitrary interaction modes.

The original plan was Phases 6/7/8 adding Script Kill / TRPG /
Platform-with-custom-modes. That sequence assumed incremental mode
additions would naturally mature into a platform. In practice, UI
affordances for agent reuse and team composition weren't on the path.
User's feedback pulls Platform forward to **become the next phase**,
subsuming modes that come later.

---

## 2. Mental model

```
   ┌──────────┐        ┌────────┐        ┌──────┐
   │  AGENT   │◄──────►│  TEAM  │◄──────►│ ROOM │
   │          │ many   │        │ many   │      │
   │ name     │        │ name   │        │ mode │
   │ model    │        │ leader │        │ topic│
   │ persona  │        │ agents │        │ ...  │
   │ avatar   │        │ ...    │        └──────┘
   └──────────┘        └────────┘            │
                                             │
                                          ┌──┴───┐
                                          │ MODE │
                                          │      │
                                          │ open-│
                                          │ chat │
                                          │ debate│
                                          │ ww   │
                                          └──────┘
```

### 2.1 Agent (reusable persona)

Fields (V1):
- `id`, `createdBy`, `name`
- `persona` — a paragraph describing personality, voice, expertise
- `systemPrompt` — optional override; if absent, we compose from persona
- `modelProvider`, `modelId`, `style` (temperature, max tokens, language)
- `avatarSeed` — DiceBear pixel-art seed (stable per agent)
- `isTemplate` — true if system-provided starter, false if user-made

Agents are visible globally (no auth yet). "My agents" = created by
this browser's localStorage userId.

### 2.2 Team (composition)

Fields:
- `id`, `createdBy`, `name`, `description`, `avatarSeed`
- `leaderAgentId` — optional; when set, the leader moderates open-
  chat mode and speaks first in debates
- `members` — array of `{ agentId, position }` (position = display order)

A team has 2–12 members. Unlike a room, the team itself has no
lifecycle — it's a persistent composition.

### 2.3 Room (activity instance)

Fields (additions to existing schema):
- `teamId` — new FK, nullable (legacy rooms have null)
- `modeConfig` — jsonb, mode-specific params

Everything else (`agents`, `roleAssignments`, `currentPhase`,
`gameState`, events, etc.) stays the same. On creation, a room
snapshots the team's agents into its own `agents` column so
modifications to the team later don't rewrite history.

### 2.4 Mode (pluggable activity)

V1 modes:
- **`open-chat`** — new. Free-form; agents reply to a user prompt in
  leader-first-then-round-robin order; ends after N turns.
- **`roundtable`** — existing. Structured N-round debate.
- **`werewolf`** — existing. Social deduction game.

V2 modes:
- **`script-kill`** — Phase 7 (deferred)
- **`trpg`** — Phase 8 (deferred)
- **`custom`** — user-defined mode via SDK (much later)

### 2.5 Template (cloneable starter)

Three types:
- **Agent templates**: ship-with curated personas (the 优etc. Optimist,
  Skeptic, Pragmatist for debate; 尚书令 / 中书令 for 当皇帝; plus a
  dozen werewolf character archetypes)
- **Team templates**: pre-composed teams (投资团队, 当皇帝, 辩论赛, 狼人杀)
- **Room templates**: team + mode + default config ("+ Start a werewolf
  game with this team")

Templates live in the same tables with `isTemplate=true`. Cloning
copies the row to user-owned data. No synchronization — changes to
the template don't back-propagate.

---

## 3. Data model

### 3.1 Schema additions

```sql
-- agents (reusable personas)
CREATE TABLE agents (
  id uuid PK DEFAULT gen_random_uuid(),
  created_by text,                    -- localStorage uid or auth user id
  name text NOT NULL,
  persona text NOT NULL,
  system_prompt text,                 -- optional override
  model_provider text NOT NULL,       -- 'anthropic' | 'openai' | ...
  model_id text NOT NULL,             -- 'claude-opus-4-6' | ...
  style jsonb NOT NULL DEFAULT '{}',  -- temperature, max_tokens, language
  avatar_seed text NOT NULL,          -- DiceBear pixel-art seed
  is_template boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agents_created_by_idx ON agents (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX agents_template_idx  ON agents (is_template) WHERE is_template = true;

-- teams (agent compositions)
CREATE TABLE teams (
  id uuid PK DEFAULT gen_random_uuid(),
  created_by text,
  name text NOT NULL,
  description text,
  leader_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  avatar_seed text NOT NULL,
  is_template boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teams_created_by_idx ON teams (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX teams_template_idx  ON teams (is_template) WHERE is_template = true;

-- team_members (join with display order)
CREATE TABLE team_members (
  team_id  uuid NOT NULL REFERENCES teams(id)  ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  position integer NOT NULL,
  PK (team_id, agent_id)
);
CREATE INDEX team_members_agent_idx ON team_members (agent_id);

-- rooms additions
ALTER TABLE rooms
  ADD COLUMN team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN mode_config jsonb;
```

### 3.2 Migration from existing data

- Existing `rooms.agents` (jsonb AgentInfo[]) stays — it's the
  session's snapshot and remains the source of truth for replay.
- Existing rooms get `team_id = NULL` — treated as ad-hoc, no
  "back to team" link.
- Starter templates seeded via SQL (one migration that inserts ~12
  agent templates + 4 team templates).

### 3.3 Identity: who created what

No auth in V1. We use a `localStorage.agoraUserId` (uuid, generated
on first visit) as `created_by`. Trade-offs:
- ✅ Zero-friction, works immediately
- ✅ "My agents" filter works per browser
- ❌ Clearing cookies/localStorage orphans the user's work
- ❌ Cross-device state doesn't carry

Phase 4.5d (already planned) swaps this for Supabase Auth magic-link
+ OAuth. At that point, orphaned localStorage-owned rows get a
migration prompt ("claim these as yours").

---

## 4. User flows

### 4.1 First-time visitor: clone a template

```
/ (landing)
  └ "Start with a template →"
    ↓ grid of starter TEAM templates (+ clone button each)
    ↓ user clicks "当皇帝 — imperial advisory team"
      ↓ auto-clone team + its agents into user's localStorage uid
      ↓ redirect to /teams/{new-team-id}
        ↓ user sees team detail (members, avatars, description)
        ↓ clicks "+ 开始对话" (start conversation)
          ↓ modal: pick mode (Open Chat default for this team) +
            optional topic
            ↓ room created, redirect to /room/{id}
              ↓ first tick fires, agents start responding
```

This is the "magic in 30 seconds" flow. Zero typing.

### 4.2 Power user: build from scratch

```
Sidebar → "+ 新建智能体"
  ↓ /agents/new — stepped wizard
    ↓ Step 1: Identity (name, persona description, avatar preview)
    ↓ Step 2: Model (provider, specific model, style preset)
    ↓ Step 3: (Optional) System prompt override
    ↓ Step 4: Review + save
      ↓ redirect to /agents (list view)
Sidebar → "+ 新建团队"
  ↓ /teams/new — composer
    ↓ Left: searchable agent catalog (user's + templates)
    ↓ Right: selected members (up to 12); click to mark one as leader
    ↓ Name + description + save
      ↓ redirect to /teams/{id}
Start activity:
  ↓ "+ 开始对话" → pick mode → configure → room
```

### 4.3 Returning user: start a fresh room

```
Sidebar → 团队 (team list)
  ↓ click a team they've used before
    ↓ /teams/{id}
      ↓ "+ 开始对话" → mode picker
        ↓ pre-fills defaults from last room with this team
        ↓ tweak topic/settings → start
```

### 4.4 Replay browsing

```
Sidebar → 回放
  ↓ /replays — card grid sorted by recent
    ↓ click a room → /replay/{id}
      ↓ ChatView by default (Phase 5.7a); toggle to RoundTable
```

---

## 5. UI architecture

### 5.1 AppShell + sidebar (persistent across the app)

```
┌───────────┬──────────────────────────────────────┐
│ Agora     │                                      │
│ + 新对话  │                                      │
│           │                                      │
│ 智能体 ▸  │                                      │
│  我的     │                                      │
│  模板     │             CONTENT AREA             │
│  + 新建   │                                      │
│           │                                      │
│ 团队 ▸    │                                      │
│  我的     │                                      │
│  模板     │                                      │
│  + 新建   │                                      │
│           │                                      │
│ 活动 ▸    │                                      │
│  辩论     │                                      │
│  狼人杀   │                                      │
│  开放对话 │                                      │
│           │                                      │
│ 回放      │                                      │
│           │                                      │
│ ─────     │                                      │
│ SETTINGS  │                                      │
│ 语言: 中文│                                      │
│ [user pill]                                      │
└───────────┴──────────────────────────────────────┘
```

Responsive:
- ≥1024px: 220px fixed
- 768–1023px: 56px icon rail (text collapses)
- <768px: off-canvas + hamburger

### 5.2 Page inventory (V1 end-state)

| Route | Purpose | Status |
|---|---|---|
| `/` | Landing: templates grid + "my teams" + "my agents" strips | REWRITE |
| `/agents` | Agent list (filterable: mine / templates) | NEW |
| `/agents/new` | 4-step wizard | NEW |
| `/agents/[id]` | Agent detail (read-only) | NEW |
| `/agents/[id]/edit` | Agent edit (reuses wizard) | NEW |
| `/teams` | Team list (filterable: mine / templates) | NEW |
| `/teams/new` | Team composer | NEW |
| `/teams/[id]` | Team detail (members + recent rooms + "+ 开始对话") | NEW |
| `/teams/[id]/edit` | Edit team composition | NEW |
| `/rooms/new` | Unified room creator (pick team + pick mode) | NEW |
| `/room/[id]` | Existing live room view | EXISTS |
| `/room/[id]/observability` | Existing | EXISTS |
| `/replay/[id]` | Existing (uses chat-default from 5.7a) | EXISTS |
| `/replays` | Grid redesign | POLISH |
| `/create` | Legacy debate quick-create, thin wrapper | KEEP |
| `/create-werewolf` | Legacy werewolf quick-create, thin wrapper | KEEP |
| `/admin/rooms/[id]` | Existing durable-runtime debug page | EXISTS |

Legacy `/create` routes stay — they're quick-paths that internally
create an ad-hoc team (team_id=NULL on the room) and skip the team
composer. New users go through the sidebar; demo URLs still work.

### 5.3 Key new components

```
apps/web/app/
  components/
    AppShell.tsx            NEW — layout frame, persists sidebar
    Sidebar.tsx             NEW — left nav
    AvatarPixel.tsx         NEW — DiceBear pixel-art avatar
    SectionHeader.tsx       NEW — "AGENTS" all-caps accio-style label

  agents/
    new/wizard/
      Step1Identity.tsx     NEW
      Step2Model.tsx        NEW
      Step3Prompt.tsx       NEW
      Step4Review.tsx       NEW
      WizardShell.tsx       NEW — progress bar + back/next framework
    AgentCard.tsx           NEW
    AgentGrid.tsx           NEW

  teams/
    new/
      TeamComposer.tsx      NEW — left catalog + right selected
    TeamCard.tsx            NEW

  rooms/new/
    ModePicker.tsx          NEW
    ModeConfigForm.tsx      NEW (dispatches to mode-specific form)

  modes/
    open-chat/
      OpenChatView.tsx      NEW
```

And in `packages/modes/`:
- `src/open-chat/` — new mode with `advance.ts`, system prompts, etc.

---

## 6. Open-chat mode (the new primitive)

Why it matters: most Accio team rooms ARE open chat (see the 爱江山
imperial court example). It's the primitive that makes non-game
activities possible.

### 6.1 Mechanics (V1, spectator-only)

- User provides an **opening prompt** when creating the room
- Flow: leader (if any) responds first, then round-robin through
  members. One full lap = one round.
- Default: 1–3 rounds, configurable 1–5.
- Ends naturally after N rounds OR a leader summary (next round).
- No channels, no roles — all in `main`.

### 6.2 Mechanics (V2, post-4.5c human play)

- User can send messages mid-room
- `@all` or `@name` mentions drive who replies
- No fixed round count; room ends on explicit "end conversation"

V1 is a thin flow because we don't have human play yet. V2 is where
Open Chat comes alive. We ship V1 now to validate the primitive;
V2's richer flow is straightforward once seat-tokens land.

### 6.3 Why this also fits Phase 4.5a

`packages/modes/src/open-chat/advance.ts` plugs into the existing
mode dispatcher. No runtime changes needed — it's a new mode, runs
in ticks, rehydrates from events, all the same machinery.

---

## 7. Templates to ship with V1

**Goal**: user lands on an empty app and can play in 30 seconds.

Four team templates, each backed by 6–9 agent templates:

### 7.1 投资团队 (Investment Committee)
- Members: CFO, Quant, Risk Officer, Contrarian, Macro Strategist,
  Industry Analyst (+ optional: Compliance)
- Mode default: open-chat
- Starter prompt: "Should we take this 20M Series B position in X?"

### 7.2 当皇帝 (Imperial Court)
- Members: 尚书令 (Chancellor), 中书令 (Strategist), 门下侍中 (Auditor),
  户部尚书 (Finance), 兵部尚书 (War), 礼部尚书 (Ritual)
- Leader: none (the user is the emperor; agents advise)
- Mode default: open-chat
- Starter prompt: "朕该如何处理边关近日的饥荒?"

### 7.3 辩论赛 (Debate Contest)
- Members: The Optimist, The Skeptic, The Pragmatist
- Leader: none
- Mode default: roundtable, 3 rounds
- Starter prompt: user-provided topic

### 7.4 狼人杀 (Werewolf Village)
- Members: 9 generic players with diverse personas
- Leader: none
- Mode default: werewolf, 9p 基础
- Starter prompt: none (werewolf self-configures)

Templates are raw DB rows, seeded via a one-time SQL migration.

---

## 8. Migration strategy

### 8.1 Backward compatibility (Phase 6 ships without breaking anything)

- All existing rooms keep working (team_id=NULL is fine)
- `/create` and `/create-werewolf` pages keep working (become quick
  paths that set team_id=NULL)
- Existing replays render identically
- Existing CLI scripts (`scripts/run-*.ts`) untouched

### 8.2 Migration steps

```
6a  Design doc sign-off (this)                    0 days
6b  Schema migration + agents/teams tables        0.5 day
6c  Seed template SQL (4 teams, ~30 agents)       0.5 day
6d  /api/agents CRUD + /api/teams CRUD            1 day
6e  Agent wizard (Step 1–4 + save)                2 days
6f  Team composer UI                              1.5 days
6g  Room creator /rooms/new + mode picker         1 day
6h  Open-chat mode in packages/modes              1.5 days
6i  AppShell + Sidebar                            1.5 days
6j  Landing redesign (templates grid)             1 day
6k  Legacy /create routes rewire                  0.5 day
6l  Polish (results cards, replay grid)           1.5 days
6m  Mobile + a11y                                 1 day
```

**Critical-path MVP** (6a → 6j): ~11 days. Everything after is
polish that can ship opportunistically.

**"Can show people today" MVP** (6a → 6g): ~6 days — lets a user
create an agent + team + room. Open-chat + sidebar + landing follow
within a week.

### 8.3 Rollout

Each sub-phase commits + deploys. The feature gating is natural:
- `/agents`, `/teams`, `/rooms/new` routes don't exist yet → no user
  sees them until the PR with them lands
- Sidebar only appears after 6i → all pages look the same until then
- Legacy flow keeps working throughout, so no user is ever stranded

---

## 9. Avatars

DiceBear pixel-art variant, seeded by `agentId`:

```tsx
<img src={`https://api.dicebear.com/9.x/pixel-art/svg?seed=${agentId}`} />
```

Why:
- Deterministic — same agent always has same face
- No storage, no moderation
- Matches Accio's aesthetic (compare images 11, 19)
- Free at scale

Fallback: current gradient+initial AgentAvatar for legacy rooms
(where `agentId` isn't seed-like).

Later: allow user image upload (Supabase Storage) as a field
override. Not in V1.

---

## 10. What we explicitly defer

| Feature | Phase | Why defer |
|---|---|---|
| Auth (Supabase magic-link/OAuth) | 4.5d | Already planned; localStorage is enough for V1 demo |
| Skills catalog | V2 (post-6) | Agora agents don't call external tools today |
| Tool use (web search, code) | V2 | Requires skill catalog + execution sandbox |
| Custom mode SDK | V3 | Need a stable mode interface first |
| Agent marketplace / sharing | V3 | Requires auth + moderation |
| Cross-device sync | 4.5d | Needs auth |
| Moderator/GM agent (narrator) | Phase 7 | Script-kill-specific; not needed for open-chat V1 |
| Rich room layouts beyond chat+table | V2 | Ship chat-default; iterate on demand |
| Multi-human rooms | 4.5c/d | Already scheduled |

---

## 11. Risks

1. **Scope creep during agent wizard.** Accio's wizard has 4 steps
   because tools + skills are real features. Ours should be 4 only
   if each step earns its keep; otherwise collapse to 3 (Identity /
   Model / Review).
   - Mitigation: V1 Step 3 ("System prompt override") is optional
     and collapsible. Most users skip it.

2. **Template quality.** Bad templates = bad first impressions.
   - Mitigation: spend real time curating 4 teams. Each agent gets a
     100–200 word persona written by a human (or Claude with careful
     editing). No lorem ipsum.

3. **Open-chat flow feels aimless without human play.** "3 rounds of
   agents talking" can meander.
   - Mitigation: leader agent (when set) is prompted to summarize on
     the final round. Gives the session a clear end.

4. **DB migration with live data.** We add FK columns to existing
   `rooms` and new tables.
   - Mitigation: new columns are nullable. FK ON DELETE SET NULL. No
     data loss possible.

5. **Sidebar vs deep-linking.** Will users ever land directly on
   `/agents/[id]/edit` outside of the sidebar flow?
   - Mitigation: AppShell wraps every page, so sidebar is always
     present. Deep links work.

6. **Template rows in agents/teams clutter "my" lists.** A user who
   has never created anything should see "My: (empty)" but still get
   templates as inspiration.
   - Mitigation: agents/teams lists have two tabs — "我的" | "模板".
     Default tab is "我的" if non-empty, "模板" if empty.

7. **Phase 4.5a rehydration with new mode.** Open-chat needs its own
   `advance.ts` that rehydrates from DB events.
   - Mitigation: copy the roundtable advance pattern (which is
     simpler than werewolf). Write a replay determinism test like
     `werewolf-determinism.test.ts`.

---

## 12. Open questions (need your call before 6b starts)

1. **Positioning line.** Current CLAUDE.md: "multi-agent
   collaboration platform." Want something crisper? Options:
   - "Build your AI team. Use them for anything."
   - "A social runtime for AI minds."
   - "Assemble agents. Compose teams. Run anything."
   Your pick, or write one.

2. **Wizard step count.** 4 steps (Accio-match) or 3 steps (cut
   step 3 prompt-override for V1)?

3. **Template roster.** Confirm the 4: 投资团队, 当皇帝, 辩论赛,
   狼人杀. Or swap one? (I'd argue 投资团队 is weaker as a demo
   than something like "剧本杀排位" — but 剧本杀 mode doesn't exist
   yet, so deferring.)

4. **Avatar source.** DiceBear pixel-art via CDN? Or generate &
   cache server-side (avoids runtime CDN dependency)?

5. **Leader agent — what does it actually DO?** Options:
   - (a) Always speaks first in debate/open-chat
   - (b) Summarizes at end
   - (c) Both
   - (d) Just a display flag; no runtime effect in V1
   Recommend (c); (d) if we want to ship faster.

6. **Legacy `/create` and `/create-werewolf` fate.**
   - Keep as-is (team_id=NULL, no team link)
   - Auto-create an ad-hoc team visible in /teams
   - Just redirect to /rooms/new
   Recommend keeping as-is; they're fast paths.

7. **Agent editability mid-room.** If a team's agent changes after
   a room starts, does the running room pick up changes?
   - No (snapshot at room creation). Much simpler. Replays stay
     consistent.

8. **Scope: V1 through 6j (~6 days) vs full plan (~11 days)?** What
   do you want to ship first?

---

## 13. Immediate execution order (post sign-off)

1. **6b — schema migration + agent/team tables + CRUD API**. Ship
   alone; no UI yet. Test via curl. [0.5d + 1d]
2. **6c — seed templates**. Pure SQL, reviewable in a PR. [0.5d]
3. **6e — agent wizard**. Biggest UI piece; ship in isolation so we
   can iterate on the wizard UX before touching teams. [2d]
4. **6f — team composer**. Blocked on 6e being usable. [1.5d]
5. **6g + 6i — room creator + AppShell/Sidebar**. Together; they
   co-evolve. [1d + 1.5d = 2.5d]
6. **6j — landing redesign**. Easy win once shell is in. [1d]
7. **6h — open-chat mode**. Can slot in anywhere after 6g; shipping
   Open Chat unlocks the 投资团队 and 当皇帝 templates. [1.5d]
8. **6k — legacy rewire** (clean commits removing dead code). [0.5d]
9. **6l + 6m — polish + mobile**. [2.5d]

---

## 14. What this does NOT touch

- Phase 4.5a durable runtime (already done; plugs in naturally)
- Phase 4.5c human play (on its own track; arrives after Phase 6)
- Existing werewolf + roundtable mode logic (preserved exactly)
- Replay reconstruction (unchanged; new mode adds its own advance
  but follows the same pattern)
- Observability / admin / timeline pages (untouched)

---

## 15. What I need from you

A short thumbs-up / push-back on:

- **Section 2 mental model** — agent/team/room/mode/template as
  orthogonal concepts. Buy it?
- **Section 3 data model** — three tables + two columns. Any names
  you'd change?
- **Section 6 open-chat V1 mechanics** — "leader speaks first,
  N-round round-robin, leader summary on last round" good enough
  for V1?
- **Section 7 templates** — lock the roster.
- **Section 12 open questions** — pick answers.
- **Section 13 execution order** — OK or want resequencing?

With that, I write 6b code and go.

---

**End of plan.** This doc is the checkpoint. No code until you sign
off on the model + templates + execution order.

---

## 16. Locked answers (2026-04-15 sign-off)

| # | Question | Locked answer |
|---|---|---|
| 1 | Positioning line | **"Assemble agents. Compose teams. Run anything."** |
| 2 | Wizard step count | **4 steps** (Accio-match): Identity → Model → Prompt override (optional) → Review |
| 3 | V1 templates | **4 ship with V1**: 投资团队 · 当皇帝 · 辩论赛 · 狼人杀. **Reserved for V2** after script-kill + TRPG modes land: 剧本杀 · TRPG |
| 4 | Avatar source | **DiceBear pixel-art** via `@dicebear/core` + `@dicebear/pixel-art` npm packages, generated client-side from `avatarSeed = agentId`. Rendered via `toDataUri()` → `<img src={dataUri}>` (avoids `dangerouslySetInnerHTML`). Memoized per-seed. No CDN, no server storage. Matches Accio's pixel-character aesthetic. |
| 5 | Leader agent runtime role | **V1: dispatcher via prompt-append** (§17.3 pattern). When a team has a leader, the room runtime appends the FORBIDDEN/REQUIRED block to the leader's system prompt at creation. Badge on team card + seat + roster also shows. V2/future: full-featured leader (speaks-first + summary + runtime veto). |
| 6 | Legacy `/create*` routes | **Keep as fast-path shortcuts**. Internal: they call `/api/rooms` with `team_id=null`. New `/rooms/new` flow calls same endpoint with `team_id=X`. Shared `ModePicker` / config components so code doesn't fork. |
| 7 | Agent edit mid-room | **Snapshot at room creation; edits never propagate.** Replays stay consistent. |
| 8 | V1 scope | **Full plan (6b → 6m, ~11 days).** Sequential commits, deployed checkpoints per §13. |

---

## 17. Research findings — `wanikua/danghuangshang` study

Research agent ran 2026-04-15 against the source repo. Key findings
that shape our V1 implementation below.

### 17.1 What danghuangshang actually is

- **70% metaphor + UX theater, 25% prompt discipline, 5% glue code.**
  The "framework" is entirely [OpenClaw](https://github.com/openclaw/openclaw);
  danghuangshang is a packaged OpenClaw config + ~19 persona `.md`
  files.
- **Three regimes**:
  - **明朝内阁制**: 19 agents (司礼监 → 内阁 → 六部 → 都察院 +
    翰林院 sub-crew + auxiliary four: 国子监/太医院/内务府/御膳房).
  - **唐朝三省制**: 14 agents (中书 drafts → 门下 audits → 尚书
    dispatches → 六部 execute → 御史台 monitors).
  - **现代企业制**: README claims 14; repo has **9** (CEO → COO
    audits → CTO/CFO/CMO/CIO/CHRO etc. → QA reviews). README lies.
- **"60+ skills"** is marketing. In-repo `skills/` has ~10; the rest
  come from OpenClaw's shared ecosystem (not vendored here).
- **No routing engine.** "Dispatch" is emergent from LLM compliance
  with persona rules. Agents `@mention` each other in Discord
  channel text; OpenClaw's `sessions_send` is a thin RPC for
  hidden handoffs.

### 17.2 The real gems — patterns to steal

| Pattern | Source | Our use |
|---|---|---|
| **Dispatch discipline** — orchestrator persona has explicit FORBIDDEN action list ("禁止: 写代码/查资料/分析数据. KPI 是任务派发率") | silijian persona (Ming) | Apply to Agora "leader" agents in V1.5 as a persona suffix. Stops LLMs from "helpful = do it myself" default. |
| **Two-step pipeline**: cheap dispatcher + slow planner | 司礼监 → 内阁 → 六部 | For large teams: leader routes, plan-generator agent optimizes, specialists execute. Much better than leader→specialists direct. |
| **Status tokens** in agent output: `【诏令草案】 【审核意见】通过/需要补充/返回修改` | menxiasheng persona (Tang) | Users parse stage instantly without reading prose. Poor-man's typed output. Use for any multi-stage flow. |
| **Three-cycle escalation** on rejection | menxia audit rules | Bounded retry loop for open-chat when an agent disagrees. |
| **Nested sub-crew** for specialized workflow | 翰林院 5-agent writing team inside the larger court | Future: Script-Kill 主持人 has a private sub-crew for evidence, while the public stage stays simple. |
| **Multi-avatar distinctness** — each agent feels like a separate person | Discord native bots | Agora round-table already does this via distinct avatars + colors. Don't underrate it. |
| **Per-agent SQLite memory + workspace dir** | OpenClaw per-agent `workspace: "$HOME/clawd-<id>"` | Future: Agora agents should accumulate memory per-agent over time, not just per-room. Post-Phase 6 feature. |

### 17.3 Leader prompt-append pattern (the V1.5 path)

Because danghuangshang's dispatch discipline is 100% prompt-driven,
Agora can enable it with **zero runtime changes** — just append a
"leader rules" block to the leader agent's system prompt at room
creation time:

```
You are the leader of this team. Your KPI is successful delegation,
not direct execution.

FORBIDDEN:
- Writing code, analysing data, producing deliverables yourself
- Giving long answers to domain questions that a specialist should cover

REQUIRED:
- For each user request, identify which team member(s) should respond
- @mention them by name with a clear task brief
- Do not reply in-depth yourself until you've collected their outputs
- Summarise at the end, crediting each contributor

If nothing in the team matches the request, say so and ask the user
to refine or add members.
```

This ships in V1.5 (or V2), NOT V1. V1 is display-only per §16. The
data model already supports this — the leaderAgentId field exists
and we can look up the agent's persona to append the block when
building the room runtime. No schema change needed later.

### 17.4 Anti-patterns to avoid

| Anti-pattern | Where in danghuangshang | What Agora should do |
|---|---|---|
| 1-line persona for specialists | 六部 persona files are literally "你是户部尚书, 专精财务分析. 回答用中文, 数据驱动" | Min **200 words per agent**: voice specimen, 3 example utterances, forbidden-topics list, handoff vocabulary. |
| Bolted-on infra agents don't actually use | `task-store.js` + `message-bus.js` are unused scripts | Ship only code paths that have test coverage. |
| Discord-specific routing in prompts | `@兵部 ...`, `allowBots: mentions`, `sessions_send` | Platform-agnostic: when we add a handoff primitive, make it a tool call (`handoff(agentId, message)`), not `@mention` text. |
| README claims > repo reality | "60+ skills" / "18+ agents" / "14 CEOs" | Keep Agora numbers honest. |
| No prompt versioning / evals | Zero tests on persona compliance | Agora V1.5: eval suite against 当皇帝 template verifying leader delegates. |
| Skill auto-trigger shared across all agents | OpenClaw keyword-triggered skill loading — 户部 gets `github` skill if any message mentions "github" | When Agora adds skills (V2), scope per-agent explicitly. |

### 17.5 当皇帝 template — V1 specification

**Locked roster** (9 agents, 唐朝三省制 trimmed):

| # | Agent | Role | Domain |
|---|---|---|---|
| 1 | 中书令 | Drafts decrees / proposals | Policy drafting |
| 2 | 门下侍中 | Audits drafts (✅ 通过 / ⚠️ 需补充 / ❌ 驳回) | Review / veto gate |
| 3 | 尚书令 | Dispatches to 六部 | Routing / coordination |
| 4 | 吏部尚书 | Personnel / organization / HR-equivalent | People |
| 5 | 户部尚书 | Finance / taxation / economy | Money |
| 6 | 礼部尚书 | Rites / diplomacy / education / culture | Protocol / culture |
| 7 | 兵部尚书 | Military / border / crisis response | Defense |
| 8 | 刑部尚书 | Law / judicial / compliance | Law |
| 9 | 工部尚书 | Public works / infrastructure / engineering | Build |

**Default mode**: open-chat (no leader assigned — the **user is the
emperor**; the team advises).

**Default opening prompt template** (editable by user before room start):
```
朕今日要与诸卿议 __________ 事。请各就其位，从各自立场发言，
中书令起草方案，门下审核，尚书派发如有执行事宜。
```

**V1 persona depth** — each agent gets:
- **Identity** (~80 words): role, historical context, current
  domain, relation to user
- **Voice specimen** (~50 words): sentence opener, closing
  phrase, vocabulary tics
- **3 example utterances** showing tone
- **Forbidden topics** (~30 words): what they refuse to opine on
  because it's outside their brief
- **Handoff vocabulary** (~20 words): how they address other team
  members when recommending a handoff

Total ~180-200 words × 9 = ~1,800 words of authored prompts. Real
writing work, done by hand with Claude's help, edited down.

**Attribution** (per §16.4 locked decision and research §17.1):
- Template description field in DB includes:
  `"三省六部制结构灵感来自 danghuangshang (wanikua/danghuangshang, MIT)."`
- `docs/credits.md` enumerates borrowed concepts
- No persona text copy-pasted; all rewritten in our voice

### 17.6 Gaps we're filling ourselves

Research called out 10 gaps where danghuangshang doesn't give us what
we need:

1. **Persona depth** — we write ~2,000 words from scratch (covered above)
2. **Platform-agnostic handoff** — tool-based `handoff(agentId, msg)` not Discord `@mention` text
3. **Concurrent vs sequential dispatch** — 尚书令 派发 六部: we default to **parallel** (all 六部 receive simultaneously, reply independently)
4. **Activity phase state machine** — open-chat V1 is flat round-robin; the 当皇帝 flow's "draft → audit → dispatch → execute → summarize" is handled by the LLMs reading the persona, not by runtime phases. V2 could add a `hierarchical` mode variant with fixed phases.
5. **Turn budgeting** — open-chat V1 caps at N total rounds (configurable 1-5); 当皇帝 default 3.
6. **门下 user-clarification UX** — when 门下侍中 returns `⚠️ 需要补充`, V1 just posts it as a regular message. V2 could add an inline "reply to clarify" affordance. V1 user clicks into the chat and answers.
7. **Per-agent tool scoping** — V1 has no tools; all agents are prompt-only. V2 adds skills catalog.
8. **Voice variation between 六部** — each persona gets its own opening stem + pet phrase (covered in persona depth)
9. **Seed demo conversation** — V1 ships a 5-message canonical example shown as a preview under the template card
10. **Veto authority over user** — 门下 can reject; V1 = returns advice rather than blocking. V2 could add a hard-stop affordance.

### 17.7 Changes to the plan docs

None substantive. §3 data model stands. §5 page inventory stands.
§13 execution order stands. Research mostly validates the plan and
gives us concrete content for 6c (template seed) and 6e (wizard
guidance text).

One refinement: **6c (template seed) budget expands from 0.5d to
1d** to account for the authored personas (~2k words × 4 templates
with similar depth = ~8k words of curated prompt content). This is
real writing work, not just SQL. Plan ship cost: +0.5d on the
critical path. Still within the ~11 day window.

---

**End of plan (with research).** Locked — proceeding to 6b code.
