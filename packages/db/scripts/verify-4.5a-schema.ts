// Quick verification that Phase 4.5a schema additions landed.
// Run with: cd packages/db && pnpm tsx scripts/verify-4.5a-schema.ts
import { config as loadDotenv } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

for (const file of ['../../.env.local', '../../.env']) {
  const abs = resolvePath(process.cwd(), file)
  if (existsSync(abs)) loadDotenv({ path: abs })
}

import { getDirectDb } from '../src/client.js'

async function main() {
  const { sql, db: _db } = getDirectDb()

  const cols = await sql<{ column_name: string; data_type: string }[]>`
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_name = 'rooms'
       AND column_name IN ('waiting_for', 'waiting_until', 'updated_at')
     ORDER BY column_name
  `
  console.log('columns:', cols)

  const checks = await sql<{ conname: string; definition: string }[]>`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
     WHERE t.relname = 'rooms' AND c.contype = 'c'
  `
  console.log('check constraints:', checks)

  const triggers = await sql<{ trigger_name: string; event_manipulation: string }[]>`
    SELECT trigger_name, event_manipulation
      FROM information_schema.triggers
     WHERE event_object_table = 'rooms'
  `
  console.log('triggers:', triggers)

  const indexes = await sql<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef
      FROM pg_indexes
     WHERE tablename = 'rooms'
       AND indexname LIKE '%sweep%'
  `
  console.log('sweeper indexes:', indexes)

  await sql.end({ timeout: 5 })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
