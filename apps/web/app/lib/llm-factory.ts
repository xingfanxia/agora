// ============================================================
// Phase 4.5d-2.3 -- LLM injection seam for @workflow/vitest tests
// ============================================================
//
// Why a factory? `@workflow/vitest` bundles step dependencies via
// esbuild, so `vi.mock()` cannot intercept LLM calls inside a
// step body. Tests need an env-flag-controlled seam instead.
//
// Pattern: every production call site that previously imported
// `createGenerateFn` from `@agora/llm` now imports from this module.
// In production WORKFLOW_TEST is unset -> real LLM. In integration
// tests it is '1' -> deterministic hash-based mock that returns the
// same content across http_chain and WDK runtimes for matching
// inputs (cross-runtime equivalence -- durability contract Rule 8 +
// the binding meta-invariant of 4.5d-2.1).
//
// The hash mock keys content off (provider, modelId, systemPrompt,
// history). Identical inputs -> identical bytes -> equivalence test
// can diff event sequences across runtimes by exact content match.
//
// Env check is performed at CALL time (inside the returned closure),
// not at factory time. This matches the "no module-level state"
// constraint of the durability contract -- a workflow restart picks
// up the current env, not a captured one.
//
// ── SEAM SCOPE (4.5d-2.3, extended 4.5d-2.12) ─────────────
// Text generation (createGenerateFn) -- mock-aware, routed through here:
//   * apps/web/app/api/rooms/route.ts                (roundtable WDK)
//   * apps/web/app/workflows/roundtable-workflow.ts  (roundtable WDK)
//   * apps/web/app/workflows/open-chat-workflow.ts   (open-chat WDK)
//
// Structured output (createGenerateObjectFn -- 4.5d-2.12) -- no mock,
// throws under WORKFLOW_TEST=1. Werewolf-workflow.ts is the only
// consumer. Validation strategy is real games end-to-end, not unit
// equivalence -- per pre-users feedback rule, structured-output mocks
// would be scaffolding for a use case (cross-runtime equivalence)
// that's about to be deleted in 4.5d-2.18.
//
// NOT YET routed (still calls @agora/llm directly -- gone after 2.18):
//   * apps/web/app/lib/room-runtime.ts          (legacy http_chain advance loop)
//   * apps/web/app/api/rooms/werewolf/route.ts  (werewolf creation -- moves to WDK in 2.17)
//   * packages/modes/src/roundtable/index.ts    (CLI/script entrypoint)

import {
  createGenerateFn as realCreateGenerateFn,
  createGenerateObjectFn as realCreateGenerateObjectFn,
} from '@agora/llm'
import type { GenerateFn, GenerateObjectFn, GenerateResult } from '@agora/llm'
import type { ModelConfig, TokenUsage } from '@agora/shared'
import { createHash } from 'node:crypto'

/**
 * Deterministic mock token usage. Exported so cost-tracking tests
 * (phase 4.5d-2.4) can import this directly instead of duplicating
 * the literals -- a tweak to the mock then breaks the cost test loud.
 */
export const MOCK_USAGE: TokenUsage = {
  inputTokens: 100,
  outputTokens: 50,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  reasoningTokens: 0,
  totalTokens: 150,
}

export function createGenerateFn(model: ModelConfig): GenerateFn {
  // Lazy: real GenerateFn is only constructed when actually needed,
  // so test runs never reach into provider auth (createModel reads
  // env vars at call time). The mock path returns immediately.
  let real: GenerateFn | undefined
  return async (systemPrompt, messages, instruction) => {
    if (process.env.WORKFLOW_TEST === '1') {
      return mockGenerate(model, systemPrompt, messages, instruction)
    }
    real ??= realCreateGenerateFn(model)
    return real(systemPrompt, messages, instruction)
  }
}

// ASCII unit separator (0x1f) -- never appears in normal text, so
// concatenating with it never collides with payload bytes. Empty
// strings are no-ops to crypto.update, so a real delimiter byte
// is required for a sound hash over a sequence of fields.
const SEP = '\x1f'

function mockGenerate(
  model: ModelConfig,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  instruction: string | undefined,
): GenerateResult {
  const hash = createHash('sha256')
  hash.update(model.provider + SEP + model.modelId + SEP + systemPrompt)
  for (const m of messages) {
    hash.update(SEP + m.role + SEP + m.content)
  }
  // Truthiness check (not `!== undefined`) to match the real
  // createGenerateFn at packages/llm/src/generate.ts:151, which
  // skips empty-string instructions. Asymmetric handling here
  // would silently break cross-runtime equivalence for callers
  // that pass `''`.
  if (instruction) {
    hash.update(SEP + 'instruction' + SEP + instruction)
  }
  const digest = hash.digest('hex').slice(0, 16)

  // The digest is the load-bearing equivalence anchor; the `turn=`
  // and `model=` annotations are human-readable decoration. If two
  // runs share a digest but disagree on `turn=`, message-count
  // diverges between callers (e.g., one folds system into messages,
  // another doesn't) -- LLM-input equivalence still holds.
  const content = `[mock:${digest}] turn=${messages.length} model=${model.modelId}`

  return { content, usage: MOCK_USAGE }
}

// ============================================================
// Phase 4.5d-2.12 -- structured-output factory (no mock)
// ============================================================
//
// Werewolf phase decisions (vote, witch action, seer check, guard
// protect, etc.) constrain the LLM to a Zod schema via Vercel AI SDK's
// generateObject. This factory wraps @agora/llm's createGenerateObjectFn
// for parity with createGenerateFn above, but does NOT implement a
// mock: validation for werewolf is real game playthroughs, not
// cross-runtime equivalence (cf. pre-users feedback rule).
//
// WORKFLOW_TEST=1 is forced globally by vitest.config.ts. If a unit
// test ever imports this and invokes the returned function, that's
// almost certainly a mistake -- so we throw fast with a pointer to
// the integration test path instead of silently calling the real
// provider (which would also fail, but with a confusing auth error).
export function createGenerateObjectFn(config: ModelConfig): GenerateObjectFn {
  // Lazy: same pattern as createGenerateFn -- real factory only
  // resolved when actually needed. Keeps tests that import this
  // module free of provider-auth side effects.
  let real: GenerateObjectFn | undefined
  return async (systemPrompt, messages, schema, instruction) => {
    if (process.env.WORKFLOW_TEST === '1') {
      throw new Error(
        'createGenerateObjectFn: structured-output has no WORKFLOW_TEST mock. ' +
          'Werewolf validation is real games (see docs/design/phase-4.5d-werewolf-port.md). ' +
          'If you need to test a workflow that uses structured output, run it under ' +
          'vitest.integration.config.ts (which does NOT set WORKFLOW_TEST=1) with a ' +
          'real or test-double provider, or move the assertion to an end-to-end test.',
      )
    }
    real ??= realCreateGenerateObjectFn(config)
    return real(systemPrompt, messages, schema, instruction)
  }
}
