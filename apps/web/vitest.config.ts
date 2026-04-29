// ============================================================
// Vitest config — apps/web (WDK spike)
// ============================================================
//
// Phase 4.5d-2.0 spike adds @workflow/vitest as the integration-
// test plugin. Without the plugin, `"use workflow"` and `"use step"`
// are no-ops; with it, the workflow runtime + hook resumption work
// in-process so we can drive deterministic restart simulations
// without a live Vercel server.

import { defineConfig } from 'vitest/config'
import { workflow } from '@workflow/vitest'

export default defineConfig({
  plugins: [workflow()],
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
    // @workflow/vitest's setupWorkflowTests clears workflow event log
    // between test invocations, but NOT user module-level state — so
    // helpers like `spikeStore` carry over between tests in the same
    // worker. Always pair with `beforeEach(() => clearSpikeStore())`.
    // (See workflows-and-steps.mdx → "Module state across tests".)
  },
})
