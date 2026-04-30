// ============================================================
// Phase 4.5d-2.3 -- LLM factory determinism tests
// ============================================================
//
// Foundation for the cross-runtime equivalence test: prove the
// mock honors WORKFLOW_TEST=1 and produces deterministic content
// for matching inputs. The full equivalence test depends on this
// invariant -- if the mock is non-deterministic, runtime parity
// claims are meaningless.

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  createGenerateFn,
  createGenerateObjectFn,
  MOCK_USAGE,
} from '../../app/lib/llm-factory.js'
import type { ModelConfig } from '@agora/shared'

const MODEL: ModelConfig = {
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-6',
  maxTokens: 1024,
}

const SYSTEM_PROMPT = 'You are a debater on the topic of AI safety.'
const HISTORY = [
  { role: 'user', content: '[Bob]: I think we should slow down.' },
  { role: 'user', content: '[Carol]: I disagree, the upside is huge.' },
]

// Vitest config sets WORKFLOW_TEST=1 globally; restore for tests
// that need the real-path branch.
const ORIGINAL_FLAG = process.env.WORKFLOW_TEST
afterAll(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.WORKFLOW_TEST
  else process.env.WORKFLOW_TEST = ORIGINAL_FLAG
})

describe('createGenerateFn (mock path)', () => {
  beforeEach(() => {
    process.env.WORKFLOW_TEST = '1'
  })

  it('returns the same content for identical inputs', async () => {
    const fnA = createGenerateFn(MODEL)
    const fnB = createGenerateFn(MODEL)
    const a = await fnA(SYSTEM_PROMPT, HISTORY)
    const b = await fnB(SYSTEM_PROMPT, HISTORY)
    expect(a.content).toBe(b.content)
  })

  it('returns different content for different system prompts', async () => {
    const fn = createGenerateFn(MODEL)
    const a = await fn(SYSTEM_PROMPT, HISTORY)
    const b = await fn(SYSTEM_PROMPT + ' Be concise.', HISTORY)
    expect(a.content).not.toBe(b.content)
  })

  it('returns different content for different history', async () => {
    const fn = createGenerateFn(MODEL)
    const a = await fn(SYSTEM_PROMPT, HISTORY)
    const b = await fn(SYSTEM_PROMPT, [
      ...HISTORY,
      { role: 'user', content: '[Dan]: late entry' },
    ])
    expect(a.content).not.toBe(b.content)
  })

  it('returns different content for different role tagging of the same content', async () => {
    // Critical for cross-runtime equivalence: changing only the
    // role field of a single history message must change the hash.
    // This is what surfaces the WDK-vs-legacy role-tagging divergence
    // in the equivalence test.
    const fn = createGenerateFn(MODEL)
    const sharedContent = '[Bob]: I think we should slow down.'
    const asUser = await fn(SYSTEM_PROMPT, [{ role: 'user', content: sharedContent }])
    const asAssistant = await fn(SYSTEM_PROMPT, [
      { role: 'assistant', content: sharedContent },
    ])
    expect(asUser.content).not.toBe(asAssistant.content)
  })

  it('returns different content for different model IDs', async () => {
    const fnA = createGenerateFn(MODEL)
    const fnB = createGenerateFn({ ...MODEL, modelId: 'claude-opus-4-7' })
    const a = await fnA(SYSTEM_PROMPT, HISTORY)
    const b = await fnB(SYSTEM_PROMPT, HISTORY)
    expect(a.content).not.toBe(b.content)
  })

  it('produces obvious-mock content with [mock:...] prefix', async () => {
    // Belt-and-suspenders: if the mock ever leaks into production,
    // a human reviewer should spot it immediately. The prefix is
    // load-bearing in that sense.
    const fn = createGenerateFn(MODEL)
    const result = await fn(SYSTEM_PROMPT, HISTORY)
    expect(result.content).toMatch(/^\[mock:[0-9a-f]{16}\]/)
  })

  it('returns deterministic usage numbers', async () => {
    // Cost-tracking tests (Phase 4.5d-2.4) import MOCK_USAGE and
    // assert against it directly -- a tweak to the mock then
    // breaks the cost test loud, exactly the desired coupling.
    const fn = createGenerateFn(MODEL)
    const result = await fn(SYSTEM_PROMPT, HISTORY)
    expect(result.usage).toEqual(MOCK_USAGE)
  })

  it('returns different content for different instructions', async () => {
    // M-4: instruction parameter must affect the hash. Werewolf +
    // script-kill modes use `instruction` heavily; if it falls out
    // of the hash, those modes silently lose determinism.
    const fn = createGenerateFn(MODEL)
    const a = await fn(SYSTEM_PROMPT, HISTORY, 'Choose a target.')
    const b = await fn(SYSTEM_PROMPT, HISTORY, 'Cast your vote.')
    expect(a.content).not.toBe(b.content)
  })

  it('treats empty-string instruction the same as undefined', async () => {
    // Pin truthiness semantics. Real createGenerateFn at
    // packages/llm/src/generate.ts:151 uses `if (instruction)` --
    // mock must match or cross-runtime equivalence silently breaks
    // for callers that pass `''` (e.g. JSON-roundtripped fixtures).
    const fn = createGenerateFn(MODEL)
    const a = await fn(SYSTEM_PROMPT, HISTORY)
    const b = await fn(SYSTEM_PROMPT, HISTORY, '')
    expect(a.content).toBe(b.content)
  })
})

describe('createGenerateFn (real path gating)', () => {
  it('does NOT call the real provider when WORKFLOW_TEST=1', async () => {
    // The factory closes over a lazy `real` binding. When the flag
    // is set, the closure never resolves it -- so even invalid
    // model configs (no API key, bad model ID) work in tests.
    process.env.WORKFLOW_TEST = '1'
    const fn = createGenerateFn({
      provider: 'anthropic',
      modelId: 'definitely-not-a-real-model-id',
    })
    // Should NOT throw -- mock path doesn't validate model config.
    const result = await fn(SYSTEM_PROMPT, HISTORY)
    expect(result.content).toMatch(/^\[mock:/)
  })
})

// ============================================================
// Phase 4.5d-2.12 -- structured-output factory smoke
// ============================================================
//
// Unlike createGenerateFn, the structured-output variant has no
// WORKFLOW_TEST mock -- werewolf is validated by real game
// playthroughs, not unit equivalence. The contract this pins:
//
//   1. Factory is callable and returns a function (no provider auth
//      side effect at construction time -- proves the lazy `real`
//      binding survived the WORKFLOW_TEST=1 path).
//   2. Invoking the returned fn under WORKFLOW_TEST=1 throws fast
//      with a message that points the operator at the integration
//      test config, NOT at a generic provider auth failure.
//
// The schema parameter is never reached in the throw path, so we
// pass `null as never` -- avoids forcing a `zod` dep into apps/web
// just for a test that doesn't exercise schema validation. (When
// werewolf-workflow.ts lands in 2.13 it will already pull zod
// transitively via @agora/modes.)

describe('createGenerateObjectFn (no mock path -- throws under WORKFLOW_TEST=1)', () => {
  beforeEach(() => {
    process.env.WORKFLOW_TEST = '1'
  })

  it('returns a function without touching provider auth at construction', () => {
    // Same lazy-binding contract as createGenerateFn: invalid model
    // configs must not throw at factory time. If this regresses,
    // any test importing this module would fail at import time.
    const fn = createGenerateObjectFn({
      provider: 'anthropic',
      modelId: 'definitely-not-a-real-model-id',
    })
    expect(typeof fn).toBe('function')
  })

  it('throws on invocation under WORKFLOW_TEST=1', async () => {
    const fn = createGenerateObjectFn(MODEL)
    // Schema is never reached -- the env-flag check throws first.
    await expect(fn(SYSTEM_PROMPT, HISTORY, null as never)).rejects.toThrow(
      /no WORKFLOW_TEST mock/,
    )
  })

  it('error message points at the integration test config', async () => {
    // Belt-and-suspenders: if this test ever fires in CI it should
    // tell whoever's debugging it where the real-provider path
    // lives, not just "an error happened".
    const fn = createGenerateObjectFn(MODEL)
    await expect(fn(SYSTEM_PROMPT, HISTORY, null as never)).rejects.toThrow(
      /vitest\.integration\.config\.ts/,
    )
  })
})
