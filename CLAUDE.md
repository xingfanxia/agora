# Agora — Project Instructions

## Project Overview

Agora is a general-purpose multi-agent collaboration platform. Games (werewolf, murder mystery, TRPG) are the initial wedge; the architecture must support arbitrary interaction modes.

## Architecture

Three-layer design:
1. **Infrastructure**: Vercel AI SDK, Socket.io, Postgres, Next.js
2. **Platform Core** (`packages/core`): Agent, Room, Channel, FlowController, Memory, EventBus — mode-agnostic
3. **Mode Layer** (`packages/modes`): Pluggable interaction modes (roundtable, werewolf, script-kill, trpg, custom)

## Tech Stack

- Monorepo: Turborepo
- Language: TypeScript (full-stack)
- Frontend: Next.js 15 (App Router), Tailwind, shadcn/ui
- LLM: Vercel AI SDK (Claude, GPT, Gemini, Qwen) + structured output via Zod
- Realtime: Socket.io
- Storage: Postgres (Supabase) + Redis (optional)
- Deployment: Vercel

## Key Design Principles

- **Platform first, modes second** — Core must be mode-agnostic. Games are just one type of mode.
- **Channel-based information isolation** — Borrowed from AgentScope's MsgHub pattern. Channels control who sees what.
- **Pluggable flow control** — FreeForm, RoundRobin, StateMachine, Hierarchical are all implementations of the same FlowController interface.
- **Structured output for decisions** — All agent decisions (votes, choices, approvals) use Zod schemas to prevent hallucination.
- **Agent = reply() + observe()** — Borrowed from AgentScope's AgentBase. Clean two-method interface.

## Development Phases

1. Roundtable Debate (MVP — validate platform core)
2. Werewolf (introduce Channel + StateMachine)
3. UX Polish (Room View, persona editor, human players, spectator)
4. Script Kill (clue system, branching narrative, long-term memory)
5. TRPG (GM Agent, dice, narrative generation)
6. Platform (custom modes, agent marketplace, replay)

## Commands

```bash
# TBD — will be filled as project scaffolding is set up
```
