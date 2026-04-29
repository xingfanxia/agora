// ============================================================
// Phase 4.5d-2.3 -- vitest config for durability tests
// ============================================================
//
// Plain vitest (no @workflow/vitest plugin) -- the durability
// tests in tests/durability/ test pure transformations (LLM
// factory, history role tagging) that don't require driving the
// workflow runtime. When a future test needs to await sleep() or
// resume hooks end-to-end, add a separate vitest.integration.config.ts
// with the workflow() plugin per @workflow/vitest docs.

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `*.test.ts` already matches `*.integration.test.ts`; if a
    // future need arises to fork timeouts or pool config between
    // unit and integration durability tests, split this into two
    // configs (vitest.config.ts + vitest.integration.config.ts).
    include: ['tests/durability/**/*.test.ts'],
    // Workflow-bundled scenarios may run longer than typical unit
    // tests -- keep generous to avoid flakes once @workflow/vitest
    // tests land here.
    testTimeout: 60_000,
    // Force WORKFLOW_TEST for the whole suite. The factory's mock
    // path activates only when this is '1'; setting it here means
    // tests never accidentally hit a real provider on a misconfigured
    // dev machine.
    env: {
      WORKFLOW_TEST: '1',
    },
  },
})
