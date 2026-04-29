// ============================================================
// Phase 4.5d-2.8 -- vitest config for WDK-driven integration tests
// ============================================================
//
// Loads `@workflow/vitest`'s plugin so test bodies can `start()`
// real workflows (the WDK in-process runner). Companion to
// `vitest.config.ts` -- this config OWNS files named
// `*.integration.test.ts` under tests/durability/.
//
// What the plugin does (see node_modules/@workflow/vitest):
//   * SWC transform on workflow + step modules ('use workflow' /
//     'use step' directives) so the bundler produces the runner's
//     expected entry shape.
//   * globalSetup builds the workflow + step bundles to disk
//     (`.workflow-vitest/` -- gitignored).
//   * setupFiles registers in-process handlers per worker so
//     `start()` returns a Run that resolves locally.
//
// The test process AND the in-process workflow runner share the
// same Node.js module cache, so room-store's WORKFLOW_TEST seam
// (4.5d-2.8) routes BOTH the legacy http_chain path and the WDK
// step bodies into the same in-memory event log. That's the
// foundation for cross-runtime equivalence diffing.

import { workflow } from '@workflow/vitest'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [workflow()],
  test: {
    include: ['tests/durability/**/*.integration.test.ts'],
    // Generous default -- in-process WDK runs are fast (mock LLM,
    // in-memory store) but bundle build + handler registration
    // adds a few hundred ms of cold-start per file.
    testTimeout: 60_000,
    // Same env contract as the unit config: enables the LLM
    // factory mock AND the room-store memory seam.
    env: {
      WORKFLOW_TEST: '1',
    },
  },
})
