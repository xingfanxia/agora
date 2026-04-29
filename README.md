# Agora

**Assemble agents. Compose teams. Run anything.**

A general-purpose multi-agent team platform. Build reusable AI personas,
compose them into teams, and run them through any activity — from
open-ended discussions to structured debates to werewolf.

## What is Agora?

Agora is an open-source platform where agents, teams, rooms, modes, and
templates are five orthogonal primitives. Create an agent once, drop it
into multiple teams, start a room in any mode, and watch the team work
— with live cost tracking and a full event timeline.

**Live on prod**: [agora-panpanmao.vercel.app](https://agora-panpanmao.vercel.app)

**Ship-with templates** (2026-04-15):
- **投资团队** — CFO (leader) + Quant + Risk + Contrarian + Macro + Analyst; dispatcher-led open chat.
- **当皇帝** — Nine Tang-dynasty ministers from the 三省六部制. You play emperor; they debate.
- **辩论赛** — 乐观派 / 质疑者 / 务实派; three-way roundtable debate.
- **狼人杀** — 9-player standard game with authored playstyle personas.

**Modes shipped**:
- **Open chat** — free-form round-robin discussion, optional leader, ✨ **human play**
- **Roundtable** — structured N-round debate, 2-8 agents
- **Werewolf (狼人杀)** — 6-12 agents, Chinese rules, togglable Guard / Idiot / Sheriff / Last Words, ✨ **human play (7 role-specific panels)**

**Human play (Phase 4.5c)**: Any seat in a team can be toggled to "You" on `/rooms/new`. During the game, a bottom bar shows your turn panel — free text for discussions, target picker for votes, role-specific UIs for witch/seer/guard/hunter/sheriff. Single-human MVP; multi-human + Supabase Auth in 4.5d.

**On the roadmap**: Script Kill (剧本杀), TRPG (跑团), multi-human rooms (Phase 4.5d).

## Architecture

Three-layer design: general-purpose platform core with pluggable modes.

```
Mode Layer        [Roundtable] [Werewolf] [Script Kill] [TRPG] [Custom]
Platform Core     Agent | Room | Channel | FlowController | TokenAccountant | EventBus
Infrastructure    Vercel AI SDK | Next.js 15 | (Postgres deferred)
```

## Tech Stack

- **Monorepo**: Turborepo + pnpm
- **Frontend**: Next.js 15 (App Router), inline styles + CSS variables
- **LLM**: Vercel AI SDK (Claude, GPT, Gemini, DeepSeek)
- **Pricing**: LiteLLM registry (auto-fetched, with offline fallback)
- **Storage**: Supabase Postgres (events table as source of truth, rooms as denormalized snapshot) via Drizzle
- **Auth**: Supabase Auth (magic-link) + email allowlist gate
- **Runtime**: Bespoke durable runtime — `advanceRoom()` + chained `/api/rooms/tick` self-invokes, with a 1-min cron sweep as backstop. Replay-deterministic via seeded agent IDs. Vercel Pro recommended. Migrating to **Vercel Workflow DevKit** at Phase 4.5d for multi-human fan-in (see `docs/design/workflow-architecture.md`).

## Quick Start

```bash
pnpm install
pnpm dev                                                     # Next.js at :3000
npx tsx scripts/run-werewolf.ts --players=9                  # CLI werewolf game
npx tsx scripts/run-werewolf.ts --guard --sheriff --players=12  # advanced rules
npx tsx scripts/token-report.ts                              # LiteLLM pricing snapshot
```

`.env` keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`.

## Web UI

| Route | What it does |
|-------|--------------|
| `/` | Landing — hero + template gallery + your teams/agents |
| `/agents` | Your reusable agent personas (Mine / Templates tabs) |
| `/agents/new` | 4-step wizard: Identity → Model → Prompt → Review |
| `/agents/[id]` | Agent detail (persona, style, prompt) + edit CTA |
| `/teams` | Team list (Mine / Templates tabs) |
| `/teams/new` | Team composer — Available ↔ Selected split, leader toggle |
| `/teams/[id]` | Team detail — roster, `+ 开始对话` CTA |
| `/rooms/new?teamId=X` | Mode picker + config → start a room |
| `/create` | Legacy roundtable debate creator (kept as fast-path) |
| `/create-werewolf` | Legacy werewolf game creator (kept as fast-path) |
| `/room/[id]` | Live room — chat-default view, round-table toggle, token panel |
| `/replays` | List of completed rooms, filterable by mode |
| `/replay/[id]` | Animated playback with scrubber and speed control |

## Status

**Phase 4.5d (Multi-Human + Auth) IN PROGRESS** (as of 2026-04-28) —
Supabase Auth + email allowlist gate (`c858213`), JWT seat invites +
multi-human picker (`5b73b6d`), and a mid-phase replay bugfix (`c01119c`)
have shipped. **Remaining**: Realtime presence + 30s disconnection grace
(4.5d-1), parallel vote fan-in via Vercel Workflow DevKit (4.5d-2), and
2-human-7-AI exit verification (4.5d-3). The fan-in work triggers a
migration to WDK (GA 2026-04-16) — see `docs/design/workflow-architecture.md`
for the architectural decision.

**Phase 4.5c (Human Play) shipped** on 2026-04-16 — HumanAgent runtime pause,
seat tokens in localStorage, /api/rooms/[id]/human-input endpoint,
"Play as" dropdown on /rooms/new, HumanPlayBar with phase-based panel
dispatch, 7 werewolf turn panels (Vote/Witch/Seer/Guard/Hunter/
Sheriff election+transfer). Supports open-chat + werewolf. Roundtable
durable-runtime migration folded into 4.5d-3.

**Design migration shipped** on 2026-04-17 — Linear-spec design system
(Inter + Linear-derived dark-mode tokens + Agora mint accent), full UI
migration with WCAG contrast pass.

**Phase 6 (Team Platform) shipped** on 2026-04-15 — five primitives
(agents · teams · rooms · modes · templates), four ship-with templates,
open-chat mode, durable runtime (Phase 4.5a), Accio-inspired UI.

**Earlier phases**: 1 (Roundtable) · 2 (Werewolf core + advanced rules) ·
3 (Frontend + observability + token tracking) · 4 (Persistence + replay) ·
4.5a (AI-only durable runtime) · 4.5b (Human-play UX spec V3) ·
5 (UI + i18n + chat-default).

**Next on deck after 4.5d**: Phase 7 (TRPG — inherits WDK substrate for
durable long pauses), Phase 8 (Script Kill), Phase 9 (Custom Mode SDK).

See [docs/prd.md](docs/prd.md), [docs/architecture.md](docs/architecture.md),
[docs/implementation-plan.md](docs/implementation-plan.md), and
[docs/design/workflow-architecture.md](docs/design/workflow-architecture.md).

## Credits

Borrowed ideas, ship-with templates, and libraries are credited in [docs/credits.md](docs/credits.md). Notably, the **当皇帝** template is inspired by [wanikua/danghuangshang](https://github.com/wanikua/danghuangshang) (MIT).

## License

MIT
