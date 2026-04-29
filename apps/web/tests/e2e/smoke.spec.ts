// ============================================================
// E2E smoke test — verifies the dev server boots + home renders
// ============================================================
//
// Phase 4.5d-3 — first Playwright test. The intent is breadth not
// depth: confirm the test harness works end-to-end (config loads,
// browser launches, dev server is reachable, basic assertions pass).
// Multi-context disconnection-recovery tests for 2-human-7-AI
// werewolf are deliberately scoped separately — they need a real DB
// + LLM-mocking strategy + room-creation flow that this smoke test
// avoids.

import { test, expect } from '@playwright/test'

test.describe('home page', () => {
  test('renders the hero copy and tagline', async ({ page }) => {
    await page.goto('/')

    // Hero line — unique enough that matching it proves the i18n
    // bundle loaded and the locale resolved correctly.
    await expect(
      page.getByText('Assemble agents. Compose teams. Run anything.'),
    ).toBeVisible()

    // Hero subtitle — second proof that the page chrome rendered, not
    // just the title island. (The shorter `landing.tagline` only
    // renders inside the Sidebar which may be off-screen on smoke runs.)
    await expect(
      page.getByText(/Create reusable AI agents/),
    ).toBeVisible()
  })
})
