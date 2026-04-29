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
    // The vitest plugin compiles step bodies at module-load time, so
    // each test file gets a fresh module cache — module-level state
    // in workflow files (e.g. spikeStore) is per-test-process, fine.
  },
})
