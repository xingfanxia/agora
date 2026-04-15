# Credits & Attribution

Agora borrows ideas, patterns, and inspiration from the work below.
We credit them here and in the README; where a specific template
derives from a specific upstream, the attribution is repeated in
that template's `description` field so users see it on the team card.

## Templates

### 当皇帝

**Inspired by**: [wanikua/danghuangshang](https://github.com/wanikua/danghuangshang) · MIT

We borrowed the *concept* (user plays Tang dynasty emperor; 三省六部制
officials advise) and *structural inspiration* (which ministries are
represented). The reference project ships very thin agent prompts
— ours are authored from scratch at 200-250 words per minister,
with historically grounded voice, period-accurate self-reference
(臣/微臣/老臣), and cross-ministry handoff vocabulary. Our trimmed
roster (9 ministers instead of a larger set) is a product choice
to fit `Room.maxAgents = 12` and match the open-chat mode's
round-robin cadence.

### 投资团队 · 辩论赛 · 狼人杀

Authored directly in-house. No single upstream.

## UI

### Accio Work (Alibaba)

**Inspired by**: internal product referenced via user screenshots (not open source).

Our sidebar layout, 4-step wizard pattern, markdown-on-surface chat
rendering, palette restraint (mint green `#22c493` accent, deep
charcoal `#0f1012` background, layered `surface`/`surface-elevated`),
and the round-table → chat toggle all draw from Accio Work's shipping
design language. None of their code, only the shape of good
decisions.

## Libraries

### Vercel AI SDK v4

MIT · https://github.com/vercel/ai

Multi-provider LLM abstraction + structured output via Zod.

### Drizzle ORM · postgres-js

MIT · https://github.com/drizzle-team/drizzle-orm · https://github.com/porsager/postgres

Schema + typed queries + migrations. Works well with Supabase.

### DiceBear (@dicebear/core + @dicebear/pixel-art)

MIT · https://github.com/dicebear/dicebear

Deterministic pixel-art avatars from a seed string. Runs entirely
client-side via `toDataUri()` + `<img src>`.

### react-markdown + remark-gfm

MIT · https://github.com/remarkjs/react-markdown

Markdown rendering for agent messages in the chat view.

### next-intl

MIT · https://github.com/amannn/next-intl

Cookie-based locale switching (en/zh) without URL prefix.

### Next.js 15 · Turborepo · pnpm

MIT · https://github.com/vercel/next.js · https://github.com/vercel/turborepo

App Router, monorepo build system.

## Architecture

### AgentScope (concept)

Apache 2.0 · https://github.com/agentscope-ai/agentscope

Not used as code. Our `reply()` + `observe()` agent interface and
channel-based information isolation (MsgHub pattern) drew initial
inspiration from AgentScope's API surface before we settled on a
self-built TypeScript core. See `docs/implementation-plan.md` for
why we did not fork.

---

If you feel your work belongs on this list and is not credited, please
open an issue or PR — attribution is never complete and we want to
fix omissions promptly.
