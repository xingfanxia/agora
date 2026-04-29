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
// ── SEAM SCOPE (4.5d-2.3) ──────────────────────────────────
// Currently routed through this factory (mock-aware):
//   * apps/web/app/api/rooms/route.ts        (roundtable http_chain + WDK)
//   * apps/web/app/workflows/roundtable-workflow.ts (roundtable WDK)
//
// NOT YET routed (still calls @agora/llm directly):
//   * apps/web/app/lib/room-runtime.ts       (advance loop for werewolf + open-chat)
//   * apps/web/app/api/rooms/werewolf/route.ts  (werewolf creation)
//   * packages/modes/src/roundtable/index.ts (CLI/script entrypoint)
//
// Tests that exercise those code paths will hit a real provider unless
// the seam is extended. The werewolf migration (phase 4.5d-3+) is the
// natural time to widen scope.

import { createGenerateFn as realCreateGenerateFn } from '@agora/llm'
import type { GenerateFn, GenerateResult } from '@agora/llm'
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
