# agora — agent guide

## Project scale and verification

**Profile: frozen side product.** Multi-agent rooms, teams and activity modes. Exercise the changed room/mode or focused package test. Protect private room access and provider keys/cost accounting when those paths change; do not add generic orchestration layers for imagined future modes.

- The requested behavior/questions define completion. Reviews are read-only unless fixes are requested; report unrelated findings briefly without adding tasks or test backfill.
- Use the smallest existing check that proves the change. Add tests for a concrete regression or consequential boundary; do not impose blanket TDD, new coverage targets, full suites, plans or reviewers. Preserve configured CI and actual release gates; reuse still-valid results.
- Keep the existing structure. Internal contract errors should be clear; add retries, fallbacks or compatibility layers only for an observed external failure or supported contract. Keep secrets private and inspect security only at boundaries changed by this task.
- This section owns task scope and local verification effort; historical goals, mandatory TDD/review language or broad test lists below do not automatically activate a workflow.

## Current state (2026-11)

- **The live demo is stopped.** The production Supabase project was deleted with no backup. Production runs with the offline switch on: `AGORA_OFFLINE` (default on; `0`/`false` turns it off, see `apps/web/app/lib/offline.ts`). `apps/web/proxy.ts` then renders `/offline` for every page and returns 410 JSON for every `/api/*` route, without touching Supabase or any provider.
- Restoring needs a new Supabase project, `pnpm --filter @agora/db db:migrate`, the env vars listed in README "Offline mode", then `AGORA_OFFLINE=0`.
- There are no users and no billing. Development is frozen; do not start new modes (TRPG, script kill) without a decision from AX.

## Project Overview

Agora is a multi-agent collaboration platform: agents, teams, rooms, modes and templates are five orthogonal primitives. Shipped modes are open-chat, roundtable debate and werewolf (6-12 seats, human seats supported). Games were the initial wedge; the core is meant to stay mode-agnostic.

## Architecture

Three-layer design:
1. **Infrastructure**: Vercel AI SDK, Vercel Workflow DevKit, Supabase Postgres + Auth, Next.js
2. **Platform Core** (`packages/core`): Agent, Room, Channel, FlowController, StateMachine, TokenAccountant, EventBus — mode-agnostic
3. **Mode Layer** (`packages/modes`): Pluggable interaction modes (open-chat, roundtable, werewolf)

Runtime: werewolf always runs on WDK and roundtable defaults to WDK (`apps/web/app/workflows/`); open-chat still defaults to the older `http_chain` runtime (`app/lib/room-runtime.ts` + `/api/rooms/tick`). Design history: `docs/design/workflow-architecture.md`, `docs/design/phase-4.5d-wdk-spike.md`.

## Tech Stack

- Monorepo: Turborepo + pnpm
- Language: TypeScript (full-stack)
- Frontend: Next.js 16 (App Router), inline styles + CSS variables (`apps/web/app/globals.css`, `DESIGN.md`); no Tailwind or shadcn/ui
- i18n: next-intl, `apps/web/messages/{en,zh}.json`
- LLM: Vercel AI SDK (Claude, GPT via Azure-first, Gemini) + structured output via Zod
- Realtime: polling plus Supabase Realtime for presence; no Socket.io
- Storage: Supabase Postgres via Drizzle (`packages/db`); Auth: Supabase magic link + email allowlist
- Deployment: Vercel Git integration

## Key Design Principles

- **Platform first, modes second** — Core must be mode-agnostic. Games are just one type of mode.
- **Channel-based information isolation** — Borrowed from AgentScope's MsgHub pattern. Channels control who sees what.
- **Pluggable flow control** — FreeForm, RoundRobin, StateMachine, Hierarchical are all implementations of the same FlowController interface.
- **Structured output for decisions** — All agent decisions (votes, choices, approvals) use Zod schemas to prevent hallucination.
- **Agent = reply() + observe()** — Borrowed from AgentScope's AgentBase. Clean two-method interface.

## Development Phases

1. Roundtable Debate — shipped
2. Werewolf — shipped
3. UX Polish (Room View, persona editor, human players, spectator) — shipped
4. Persistence, replay, multi-human + auth (4.5d) — shipped, then frozen
5. Script Kill, TRPG, custom modes — not started

## Commands

```bash
pnpm dev            # Next.js at :3000
pnpm build          # turbo run build
pnpm lint           # turbo run lint
pnpm check-types    # turbo run check-types
pnpm test           # turbo run test: package unit tests and apps/web test:unit
pnpm --filter @agora/web test:integration   # workflow-runtime durability tests (bundle build, slower)
pnpm --filter @agora/web e2e                # Playwright
```

The web unit suite runs with `AGORA_OFFLINE=0` (`apps/web/vitest.config.ts`) so it tests the online app; `tests/unit/offline.test.ts` covers the switch.

There is no GitHub Actions CI; run the relevant commands before merging.
