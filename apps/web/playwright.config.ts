// ============================================================
// Playwright config — apps/web E2E tests (Phase 4.5d-3)
// ============================================================
//
// Single-browser (chromium) for now — the 4.5d-3 plan calls out
// "Playwright multi-context smoke" for the 2-human-7-AI disconnection
// scenario, which uses Browser.newContext() to drive two virtual
// players in the same test. That test lives in `tests/e2e/multi-human/`
// (TBD) and will reuse this config.
//
// `webServer` auto-spawns `pnpm dev` so `pnpm exec playwright test`
// works from a clean checkout. CI may swap to `pnpm build && pnpm
// start` for production-mode runs (faster + more representative of
// the deployed bundle).

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // Each test runs serially within its file, but files run in parallel.
  // Multi-context tests within a single file (e.g. 2-human werewolf)
  // share workspace state, so file-level isolation is the safer default.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'html' : 'list',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    // 4.5d-3 disconnection tests will need to override these per-test
    // (e.g. simulate offline via context.setOffline(true)). The default
    // is fine for steady-state smoke.
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // Cold Next.js dev start can take 30-60s on this monorepo; give it
    // headroom so the first run after `pnpm install` doesn't timeout.
    timeout: 120_000,
  },
})
