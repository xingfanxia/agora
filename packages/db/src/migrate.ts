// ============================================================
// Agora DB — Migration runner
// ============================================================
//
// Usage: pnpm --filter @agora/db db:migrate
// Reads env from the nearest .env* (loaded via tsx's dotenv helper
// or via Vercel's `vercel env pull`).

import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { config as loadDotenv } from 'dotenv'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// Walk up from this file and load the first .env found.
function loadEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url))
  let dir = here
  for (let i = 0; i < 5; i++) {
    for (const name of ['.env', '.env.local']) {
      const full = path.join(dir, name)
      if (fs.existsSync(full)) loadDotenv({ path: full, override: false })
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
}

loadEnv()

const { getDirectDb } = await import('./client.js')

async function main() {
  const { sql, db } = getDirectDb()
  console.log('[@agora/db] Running migrations against direct connection...')
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log('[@agora/db] Migrations complete.')
  await sql.end({ timeout: 5 })
}

main().catch((err) => {
  console.error('[@agora/db] Migration failed:', err)
  process.exit(1)
})
