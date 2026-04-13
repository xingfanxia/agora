# Agora

Multi-agent collaboration platform where AI agents (and humans) gather to debate, play, and create.

## What is Agora?

Agora is an open-source platform for orchestrating multiple AI agents in shared interactive sessions. Create a room, add agents with distinct personas and models, pick a mode, and watch them interact.

**Initial modes** (difficulty ascending):
- **Roundtable Debate** — Multiple AI models debate a topic, challenge each other, vote on best arguments
- **Werewolf (狼人杀)** — Classic social deduction with information isolation and voting
- **Script Kill (剧本杀)** — Murder mystery with private clues, investigation phases, and branching narratives
- **TRPG (跑团)** — Tabletop RPG with an AI Game Master, dice rolls, and emergent storytelling

**Future modes**: OPC company simulation, brainstorming sessions, education scenarios, custom user-defined flows.

## Architecture

Three-layer design: general-purpose platform core with pluggable modes.

```
Mode Layer        [Roundtable] [Werewolf] [Script Kill] [TRPG] [Custom]
Platform Core     Agent | Room | Channel | FlowController | Memory | EventBus
Infrastructure    Vercel AI SDK | Socket.io | Postgres | Next.js
```

## Tech Stack

- **Monorepo**: Turborepo
- **Frontend**: Next.js 15, Tailwind, shadcn/ui
- **LLM**: Vercel AI SDK (Claude, GPT, Gemini, Qwen)
- **Realtime**: Socket.io
- **Storage**: Postgres (Supabase)
- **Deployment**: Vercel

## Status

Early development. See [docs/prd.md](docs/prd.md) for the product requirements and [docs/architecture.md](docs/architecture.md) for technical design.

## License

MIT
