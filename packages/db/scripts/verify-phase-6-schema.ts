// Verify Phase 6 schema additions (agents + teams + team_members,
// rooms.team_id, rooms.mode_config).
// Run with: cd packages/db && pnpm tsx scripts/verify-phase-6-schema.ts
import { config as loadDotenv } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

for (const file of ['../../.env.local', '../../.env']) {
  const abs = resolvePath(process.cwd(), file)
  if (existsSync(abs)) loadDotenv({ path: abs })
}

import { getDirectDb } from '../src/client.js'

async function main() {
  const { sql } = getDirectDb()

  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('agents', 'teams', 'team_members')
     ORDER BY table_name
  `
  console.log('new tables:', tables)

  const roomCols = await sql<{ column_name: string; data_type: string }[]>`
    SELECT column_name, data_type
      FROM information_schema.columns
     WHERE table_name = 'rooms'
       AND column_name IN ('team_id', 'mode_config')
     ORDER BY column_name
  `
  console.log('rooms additive columns:', roomCols)

  const fks = await sql<{ conname: string; definition: string }[]>`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
     WHERE t.relname IN ('rooms', 'teams', 'team_members')
       AND c.contype = 'f'
     ORDER BY c.conname
  `
  console.log('foreign keys:', fks)

  const indexes = await sql<{ indexname: string; tablename: string }[]>`
    SELECT indexname, tablename
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename IN ('agents', 'teams', 'team_members', 'rooms')
       AND indexname LIKE ANY(ARRAY['agents_%', 'teams_%', 'team_members_%', 'rooms_team_%'])
     ORDER BY indexname
  `
  console.log('indexes:', indexes)

  await sql.end({ timeout: 5 })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
