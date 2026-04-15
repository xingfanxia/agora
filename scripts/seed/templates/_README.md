# Seed Templates — Format

This directory holds one JSON per ship-with template team. The
`scripts/seed/build-template-sql.ts` script reads all `*.json` here,
assigns deterministic UUIDs via `@agora/shared`'s `seededUuid`, and
emits `packages/db/drizzle/0004_seed_templates.sql` (INSERT ... ON
CONFLICT DO NOTHING).

## Schema

```ts
interface TemplateJson {
  slug: string                        // e.g., "investment" (stable)
  name: string                        // display name, can be zh
  description: string                 // short teaser incl. attribution if applicable
  avatarSeed: string                  // DiceBear pixel-art seed
  defaultModeId: 'open-chat' | 'roundtable' | 'werewolf'
  leaderAgentSlug: string | null      // must match one of agents[].slug, or null
  agents: TemplateAgentJson[]
}

interface TemplateAgentJson {
  slug: string                        // stable id within the template, e.g., "cfo"
  name: string                        // display name
  avatarSeed: string                  // DiceBear seed; convention: `{team-slug}-{agent-slug}`
  modelProvider: 'anthropic' | 'openai' | 'google' | 'deepseek'
  modelId: string                     // e.g., "claude-sonnet-4-6"
  style: { temperature?: number; maxTokens?: number; language?: 'zh' | 'en' }
  persona: string                     // **200-250 words**, flowing prose — see below
}
```

## Persona authoring rules (§4.3 of the handoff)

Every persona field is 200-250 words, structured as one or more
paragraphs of flowing prose that **implicitly** cover:

1. **Identity** (80-120 words) — role, domain, how they relate to the user
2. **Voice specimen** (40-60 words) — opening/closing style, vocabulary
   tics, rhythm
3. **3 example utterances** — the agent's voice in concrete prose
4. **Forbidden topics** (20-40 words) — what they refuse or defer on
5. **Handoff vocabulary** (20-30 words) — how they address teammates
   ("let our Quant run the numbers" vs "I'd defer to the CFO here")

Don't split these into sections with headings. It should read as
one or two tight paragraphs that a reader can drop into an agent's
system prompt and feel the personality from the first sentence.

## Model picker (for diversity in V1)

Prefer using a mix across providers inside each template so the
cards show varied provider logos. Suggested defaults:

- Analytical / rigorous roles → `deepseek-reasoner` or `claude-sonnet-4-6`
- Creative / persuasive roles → `gpt-5.4` or `gemini-3.1-pro-preview`
- Conservative / diplomatic roles → `claude-sonnet-4-6`
- Contrarian / adversarial roles → `gpt-5.4`

`language: 'zh'` for 当皇帝 and 狼人杀 (templates in zh).
`language: 'en'` for 投资团队 (multilingual but English-leaning).
`language: 'zh'` for 辩论赛 if the personas are zh archetypes;
`en` if English.

## UUID assignment

The build script derives UUIDs from:
- team id = `seededUuid('agora-template:team', slug)`
- agent id = `seededUuid('agora-template:agent', `${teamSlug}:${agentSlug}`)`

**Never** hand-write UUIDs. Let the script assign them.

## Attribution

For `huangdi.json`, the description MUST credit
[wanikua/danghuangshang](https://github.com/wanikua/danghuangshang)
(MIT). See `docs/credits.md`.
