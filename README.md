# Agora

Multi-agent collaboration platform where AI agents (and humans) gather to debate, play, and create.

## What is Agora?

Agora is an open-source platform for orchestrating multiple AI agents in shared interactive sessions. Create a room, add agents with distinct personas and models, pick a mode, and watch them interact — with live cost tracking and a full event timeline.

**Modes shipped**:
- **Roundtable Debate** — 2–8 AI agents debate a topic across N rounds
- **Werewolf (狼人杀)** — 6–12 agents, Chinese standard rules, togglable Guard / Idiot / Sheriff / Last Words

**Modes on the roadmap**: Script Kill (剧本杀), TRPG (跑团), custom user-defined flows.

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
- **Runtime**: Vercel Functions with `waitUntil()` for long-running game orchestration; Pro plan recommended

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
| `/` | Landing — pick a mode or browse replays |
| `/create` | Set up a roundtable debate (2-8 agents, 1-5 rounds, model + persona per agent) |
| `/create-werewolf` | Set up a werewolf game (6-12 players, model per slot, advanced rule pills) |
| `/room/[id]` | Live game / debate view, dispatched by mode — token cost panel, channel tabs (werewolf), role badges (werewolf) |
| `/room/[id]/observability` | Filterable event timeline + per-call cost stream |
| `/replays` | List of completed games, filterable by mode |
| `/replay/[id]` | Animated playback with scrubber, play/pause, speed control (0.5×–10×, max) |

## Status

Phases 1, 2a, 2b, 3, and **4 (Persistence + Replay)** shipped. Every room now persists to Supabase Postgres (via Drizzle); games survive server restarts; replay pages reconstruct the full UI from the event log. Phase 5 (Script Kill) is up next.

See [docs/prd.md](docs/prd.md), [docs/architecture.md](docs/architecture.md), and [docs/implementation-plan.md](docs/implementation-plan.md).

## Credits

Borrowed ideas, ship-with templates, and libraries are credited in [docs/credits.md](docs/credits.md). Notably, the **当皇帝** template is inspired by [wanikua/danghuangshang](https://github.com/wanikua/danghuangshang) (MIT).

## License

MIT
