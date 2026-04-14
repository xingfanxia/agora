# Phase 3 — Handoff Document

> **Status**: ✅ SHIPPED 2026-04-14 (commits 748d9c4, 90e2ad6, 526618d, b268897)
>
> See `docs/implementation-plan.md` Phase 3 section for the completion checklist with file paths.
> This document is preserved as a historical planning artifact. Content below is what was written *before* implementation and may not match the final shape exactly (e.g. callback-based token capture became return-type-based; AgentMemoryInspector / DecisionTree / NightOverlay were deferred).
>
> **Target audience (original)**: Next Claude session starting fresh after compact
> **Date written**: 2026-04-13
> **Previous session accomplishments**: Phase 1 (debate), Phase 2a (werewolf core), Phase 2b (advanced rules)

---

## Quick Start

```bash
cd /Users/xingfanxia/projects/products/agora
git log --oneline -10                  # recent commits
npx tsx scripts/run-werewolf.ts        # validate backend works
pnpm dev                                # start dev server
```

Repo: https://github.com/xingfanxia/agora (all committed, clean working tree)

---

## What's Done (Before Phase 3)

### Phase 1 — Roundtable Debate ✅
- Core: Agent + Room + EventBus + RoundRobinFlow
- LLM: Vercel AI SDK multi-provider (Claude Opus 4.6, GPT-5.4, Gemini 3.1 Pro, Azure)
- Mode: Roundtable with preset personas
- Frontend: Basic Next.js UI at `apps/web/app/create` and `apps/web/app/room/[id]`
- Validated: 3 parallel debates, 63 LLM calls, blog material in `docs/report/debates/`

### Phase 2a — Werewolf Core ✅
- Channel system (`packages/core/src/channel.ts`) — information isolation
- StateMachineFlow (`packages/core/src/state-machine.ts`) — generic phase controller
- Structured output (Vercel AI SDK `generateObject` + Zod)
- Werewolf mode (`packages/modes/src/werewolf/`) — 5 roles, 9-player standard config
- Blind voting via no-subscriber channels

### Phase 2b — Advanced Rules ✅
- Togglable rules: Guard (守卫), Idiot (白痴), Sheriff (警长), Last Words (遗言)
- Sheriff 1.5x vote, Day 1 election, badge transfer
- Guard protection with 同守同救 edge case
- Idiot survives day vote, loses voting rights
- Last words free-form text
- 12-player 预女猎守 config validated

### Key Docs Already Written
- `docs/prd.md` — Product requirements (phase 1-6 vision)
- `docs/architecture.md` — Full TypeScript interface definitions
- `docs/implementation-plan.md` — Phase-by-phase checklist
- `docs/design/werewolf-rules-spec.md` — Chinese 狼人杀 standard rules
- `docs/report/debates/BLOG-MATERIAL.md` — Phase 1 blog material
- `docs/report/werewolf/BLOG-MATERIAL.md` — Phase 2 blog material
- `docs/report/werewolf/werewolf-game-*.md` — 6 validation transcripts

---

## Phase 3 Goals

Three major additions, loosely ordered by dependency:

### Goal 1: Token Usage + Cost Tracking (Backend foundation)
Track input / cache-input / output tokens per LLM call. Fetch pricing from LiteLLM. Aggregate per agent, per game, per model. Foundation that observability UI will consume.

### Goal 2: Frontend UI — Generic Agent Collab + Mode-Specific
- **Generic**: Reusable components for any mode (MessageList, AgentList, ChannelTabs, PhaseIndicator, TokenCostDisplay)
- **Roundtable polish**: Refactor existing debate UI using new components
- **Werewolf UI**: Phase-aware views (night overlay, day view), role reveal, vote panel, advanced rules toggle

### Goal 3: Observability (Backend events + UI)
- Backend: Emit granular events (decisions, tool calls, memory snapshots, token usage)
- UI: Timeline view, agent memory inspector, decision tree, channel filter (see what each agent sees)

---

## Architecture Decisions

### Mode-Specific UI Pattern

```
apps/web/app/room/[id]/
├── page.tsx                    # generic room view — delegates to mode component
├── components/                 # SHARED components (used by all modes)
│   ├── MessageList.tsx
│   ├── AgentList.tsx
│   ├── ChannelTabs.tsx
│   ├── PhaseIndicator.tsx
│   ├── TokenCostPanel.tsx
│   └── Timeline.tsx
└── modes/                      # MODE-SPECIFIC overlays
    ├── roundtable/
    │   ├── RoundtableView.tsx  # debate-specific styling
    │   └── RoundIndicator.tsx
    └── werewolf/
        ├── WerewolfView.tsx    # game-specific layout
        ├── RoleCard.tsx
        ├── NightOverlay.tsx
        ├── VotePanel.tsx
        └── PhaseBanner.tsx
```

**Key insight**: The room's `modeId` (already in `RoomConfig`) determines which mode component to render. Generic components stay mode-agnostic; mode components compose them with mode-specific logic and styling.

### Token Tracking Architecture

Two-layer design:

**Layer 1: Capture** (packages/llm)
- Wrap `generateText` / `generateObject` to extract `usage` from AI SDK response
- Emit a token usage event immediately after the call
- Don't modify `GenerateFn` signature — emit via callback injected at construction

**Layer 2: Store + Aggregate** (packages/core)
- Add `tokenUsage` to `Message` metadata (per-turn capture)
- New `TokenAccountant` class tracks per-agent, per-game totals
- EventBus emits `token:recorded` events

**Pricing** (new package or in `packages/llm`)
- Fetch LiteLLM pricing JSON at startup: `https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/model_prices_and_context_window_backup.json`
- Cache in memory
- Calculate cost = inputTokens × inputPrice + cachedInputTokens × cachedPrice + outputTokens × outputPrice
- Prices are per 1M tokens, LiteLLM provides per-token (divide by 1M for display)

### Observability Events

Extend `PlatformEvent` union in `packages/shared/src/types.ts`:

```typescript
| { type: 'token:recorded'; roomId: Id; agentId: Id; messageId: Id; usage: TokenUsage; cost: number }
| { type: 'decision:made'; roomId: Id; agentId: Id; phase: string; decision: unknown; schema: string }
| { type: 'memory:snapshot'; roomId: Id; agentId: Id; messageCount: number }
| { type: 'channel:published'; roomId: Id; channelId: Id; messageId: Id; receivers: readonly Id[] }
```

Observability UI subscribes to these and builds:
- **Timeline**: chronological event stream with filters (agent, phase, channel, event type)
- **Agent Memory Inspector**: shows what each agent has observed (per-channel)
- **Decision Tree**: for structured outputs, show schema + decision + reasoning
- **Cost Meter**: live cost accumulation

---

## File-Level Implementation Plan

### Step 3.1: Token Tracking (start here — foundation)

**New files:**
- `packages/llm/src/pricing.ts` — LiteLLM pricing fetcher + cache + cost calculator
- `packages/core/src/token-accountant.ts` — aggregates token usage per room/agent/model

**Modified files:**
- `packages/shared/src/types.ts` — add `TokenUsage` type, extend `PlatformEvent`
- `packages/llm/src/generate.ts` — capture usage from AI SDK, emit via callback
- `packages/core/src/agent.ts` — accept optional `onTokenUsage` callback
- `packages/core/src/room.ts` — wire token accountant to agents

**Validation:**
- Run existing `scripts/run-werewolf.ts` — verify token counts are captured
- Add `scripts/token-report.ts` — print cost summary for a run

**Key gotchas:**
- Different providers return usage differently. Vercel AI SDK normalizes most of this via `result.usage`.
- Prompt caching (Claude) — `providerMetadata.anthropic.cacheCreationInputTokens` / `cacheReadInputTokens`. Need to check current AI SDK version.
- Gemini doesn't support prompt caching in SDK as of v4.3 — will report 0 cached tokens.

### Step 3.2: Frontend Generic Components

**New files:**
- `apps/web/app/room/[id]/components/MessageList.tsx` — scrollable message feed
- `apps/web/app/room/[id]/components/AgentList.tsx` — avatar + name + status + role (if revealed)
- `apps/web/app/room/[id]/components/ChannelTabs.tsx` — channel selector for multi-channel rooms
- `apps/web/app/room/[id]/components/PhaseIndicator.tsx` — current phase + transitions
- `apps/web/app/room/[id]/components/TokenCostPanel.tsx` — live cost + breakdown

**Modified files:**
- `apps/web/app/room/[id]/page.tsx` — dispatch to mode component based on `room.modeId`
- `apps/web/app/api/rooms/[id]/messages/route.ts` — include token usage in response
- `apps/web/app/api/rooms/[id]/state/route.ts` (NEW) — current phase, channels, agent roles (if spectator)

**Key decisions:**
- Real-time: keep polling (1-2s) for Phase 3, upgrade to SSE in Phase 4
- Spectator mode: `?spectator=true` query param, shows all channels + all roles (for debugging/demo)

### Step 3.3: Roundtable Refactor

Existing code works but uses inline styles. Refactor to use new generic components.

**Modified files:**
- `apps/web/app/room/[id]/modes/roundtable/RoundtableView.tsx` (NEW) — wraps generic components
- `apps/web/app/room/[id]/page.tsx` — render RoundtableView if modeId === 'roundtable'

### Step 3.4: Werewolf Frontend

**New files:**
- `apps/web/app/create-werewolf/page.tsx` — game setup (player count, model per slot, advanced rules toggles)
- `apps/web/app/api/rooms/werewolf/route.ts` — werewolf-specific room creation endpoint
- `apps/web/app/room/[id]/modes/werewolf/WerewolfView.tsx` — main game view
- `apps/web/app/room/[id]/modes/werewolf/RoleCard.tsx` — private role display
- `apps/web/app/room/[id]/modes/werewolf/NightOverlay.tsx` — dim screen during night phases
- `apps/web/app/room/[id]/modes/werewolf/PhaseBanner.tsx` — dramatic phase transition
- `apps/web/app/room/[id]/modes/werewolf/VoteSummary.tsx` — post-vote tally animation

**UI States to handle:**
- Setup: player picker, model selector, advanced rules checkboxes
- Night: dark theme, only show relevant channels (wolf chat for wolves, seer result, etc.)
- Day: light theme, full discussion, vote button
- Terminal: winner announcement, reveal all roles

**Player perspective switcher:**
In spectator mode, let the viewer switch between "as player X" views. Each view filters messages based on that player's channel subscriptions.

### Step 3.5: Observability UI

**New files:**
- `apps/web/app/room/[id]/observability/page.tsx` — dedicated observability view
- `apps/web/app/room/[id]/components/Timeline.tsx` — event timeline with filters
- `apps/web/app/room/[id]/components/AgentMemoryInspector.tsx` — per-agent message history
- `apps/web/app/room/[id]/components/DecisionTree.tsx` — structured output viewer

**Modified files:**
- `packages/core/src/events.ts` — add new event types emission
- `packages/core/src/room.ts` — emit decision events when agent.reply() returns structured output
- `apps/web/app/api/rooms/[id]/events/route.ts` (NEW) — stream events for timeline

**Key decisions:**
- Store all events in room state (in-memory for now, Postgres in Phase 4)
- Timeline: filterable by event type, agent, phase, channel
- Memory inspector: "show what agent X saw at time T" — needs event reconstruction

---

## References

### Where Current Implementation Lives

**Core package** (`packages/core/src/`):
- `agent.ts` — Agent interface + AIAgent implementation
- `room.ts` — Room orchestrator with channel-aware routing
- `channel.ts` — Channel + ChannelManager (information isolation)
- `flow.ts` — FlowController interface + RoundRobinFlow
- `state-machine.ts` — StateMachineFlow (generic, mode-agnostic)
- `events.ts` — Typed EventBus
- `index.ts` — barrel exports

**LLM package** (`packages/llm/src/`):
- `provider.ts` — multi-provider registry (Anthropic, OpenAI, Google, DeepSeek, Azure)
- `generate.ts` — `createGenerateFn` + `createGenerateObjectFn`
- `index.ts` — barrel exports

**Modes** (`packages/modes/src/`):
- `roundtable/` — debate mode
- `werewolf/` — werewolf mode (types, roles, phases, index)

**App** (`apps/web/app/`):
- `page.tsx` — landing
- `create/page.tsx` — debate setup
- `room/[id]/page.tsx` — debate room view (needs refactor)
- `api/rooms/route.ts` — room creation (debate only currently)
- `api/rooms/[id]/messages/route.ts` — polling endpoint
- `lib/room-store.ts` — in-memory room state (uses globalThis for HMR)

### Key External Resources

- **LiteLLM pricing**: https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/model_prices_and_context_window_backup.json
- **Vercel AI SDK docs**: https://sdk.vercel.ai/docs (usage tracking, structured output, streaming)
- **Werewolf rules reference**: `docs/design/werewolf-rules-spec.md`

### Env Variables
```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
AZURE_OPENAI_API_KEY=          # optional
AZURE_OPENAI_ENDPOINT=          # optional
AZURE_OPENAI_DEPLOYMENT=        # optional
```

Located at `apps/web/.env` (symlinked to repo root `.env`).

### Known Issues / Tech Debt

1. **Web app `create` page** only supports debate mode. Need separate `/create-werewolf` route.
2. **Room store is in-memory** — any dev server restart loses games. Postgres deferred to Phase 4.
3. **No streaming** yet — `createGenerateFn` uses `generateText`, not `streamText`. Works fine for games but blog demos would benefit from streaming.
4. **No tests** — vitest infra not yet set up. Phase 3 is a good time to add tests for token tracking and channel filtering.

---

## Session Strategy Recommendation

**Session A: Token tracking (self-contained)**
- Build token capture + LiteLLM pricing + accountant
- Validate with `scripts/token-report.ts`
- ~1 session, moderate scope

**Session B: Frontend foundation + roundtable refactor**
- Build generic components
- Refactor existing debate UI
- ~1 session

**Session C: Werewolf frontend**
- Build werewolf-specific UI + setup page
- Most visual work
- ~1-2 sessions (this is the big one)

**Session D: Observability**
- Event emission + timeline + memory inspector
- ~1 session

Alternatively, vertical slices: token tracking UI + backend together; werewolf UI + observability together. Both patterns work.

---

## Testing Strategy (recommended)

Before Phase 3 frontend work, add minimal vitest infra:

```bash
pnpm add -D vitest @vitest/ui
```

Critical tests to write:
- `packages/core/src/channel.test.ts` — subscription, filtering
- `packages/core/src/state-machine.test.ts` — phase transitions, hooks
- `packages/modes/src/werewolf/phases.test.ts` — win conditions, vote tallying, idiot/guard/sheriff logic
- `packages/llm/src/pricing.test.ts` — cost calculations

These catch regressions as frontend pulls on backend APIs.

---

## Final Notes for Next Session

- The werewolf state machine is **battle-tested** — 6 games, 270+ messages, multiple rule combinations. Don't rewrite it.
- **Blind voting** is the subtle mechanic to preserve in the frontend. The vote UI should show votes AFTER all are cast, not during.
- **Channel filtering** is already implemented in `ChannelManager.filterMessagesForAgent`. The frontend just needs to call the right API for each user's perspective.
- **Role reveal** is sensitive — never leak roles to the UI if the user isn't supposed to see them. In spectator mode (all revealed), fine. In player mode, only show your own role + any info you've learned.
