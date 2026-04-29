// ============================================================
// Phase 4.5d-2.3 -- vitest config for unit-level durability tests
// ============================================================
//
// Plain vitest (no @workflow/vitest plugin) -- the durability
// tests in tests/durability/ test pure transformations (LLM
// factory, history role tagging) that don't require driving the
// workflow runtime. Files named `*.integration.test.ts` are
// excluded here and run under `vitest.integration.config.ts`,
// which loads the @workflow/vitest plugin (4.5d-2.8).

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/durability/**/*.test.ts'],
    // *.integration.test.ts files require @workflow/vitest's
    // SWC transform + bundle building. They run under
    // vitest.integration.config.ts; exclude them here so this
    // config stays fast and hermetic (no esbuild / bundle step).
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
    // Workflow-bundled scenarios may run longer than typical unit
    // tests -- keep generous to avoid flakes once @workflow/vitest
    // tests land here.
    testTimeout: 60_000,
    // Force WORKFLOW_TEST for the whole suite. The factory's mock
    // path activates only when this is '1'; setting it here means
    // tests never accidentally hit a real provider on a misconfigured
    // dev machine. The room-store seam (4.5d-2.8) also keys on this
    // flag -- unit tests don't import room-store, so the seam is
    // dormant here.
    env: {
      WORKFLOW_TEST: '1',
    },
  },
})
