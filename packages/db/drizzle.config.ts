import type { Config } from 'drizzle-kit'
import { config as loadDotenv } from 'dotenv'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Load env from nearest .env, walking up from this file until repo root.
// Supports: packages/db/.env, repo-root/.env, repo-root/.env.local
function loadEnv(): void {
  const start = path.dirname(new URL(import.meta.url).pathname)
  let dir = start
  for (let i = 0; i < 5; i++) {
    for (const name of ['.env', '.env.local']) {
      const full = path.join(dir, name)
      if (fs.existsSync(full)) {
        loadDotenv({ path: full, override: false })
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
}

loadEnv()

/**
 * Drizzle-kit uses the *direct* (non-pooled) connection because
 * migrations hold transactions — Supavisor in transaction mode
 * disallows that.
 */
const nonPoolingUrl =
  process.env['POSTGRES_URL_NON_POOLING'] ??
  process.env['POSTGRES_URL'] ??
  ''

if (!nonPoolingUrl) {
  throw new Error(
    '[drizzle.config] POSTGRES_URL_NON_POOLING (or POSTGRES_URL) not set. ' +
      'Run `vercel env pull` or source .env.vercel before running db:generate.',
  )
}

export default {
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: nonPoolingUrl },
  strict: true,
  verbose: true,
} satisfies Config
