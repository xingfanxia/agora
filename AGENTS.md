# agora — agent guide

## Project scale and verification

**Profile: side product.** Multi-agent rooms, teams and activity modes. Exercise the changed room/mode or focused package test. Protect private room access and provider keys/cost accounting when those paths change; do not add generic orchestration layers for imagined future modes.

- The requested behavior/questions define completion. Reviews are read-only unless fixes are requested; report unrelated findings briefly without adding tasks or test backfill.
- Use the smallest existing check that proves the change. Add tests for a concrete regression or consequential boundary; do not impose blanket TDD, new coverage targets, full suites, plans or reviewers. Preserve configured CI and actual release gates; reuse still-valid results.
- Keep the existing structure. Internal contract errors should be clear; add retries, fallbacks or compatibility layers only for an observed external failure or supported contract. Keep secrets private and inspect security only at boundaries changed by this task.
- This section owns task scope and local verification effort; historical goals, mandatory TDD/review language or broad test lists below do not automatically activate a workflow.

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
