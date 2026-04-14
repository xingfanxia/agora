#!/usr/bin/env tsx
import { config as loadDotenv } from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

for (const file of ['../../.env.local', '../../.env']) {
  const abs = resolvePath(process.cwd(), file)
  if (existsSync(abs)) loadDotenv({ path: abs })
}

import { and, eq, inArray } from 'drizzle-orm'
import { getDb, rooms } from '../src/index.js'

const STUCK_ROOM_IDS = [
  '79c7dc69-45dd-4706-9c88-7b1b826c0187',
  '0ae6b772-98ef-45f2-9c51-1f95c5add3c9',
  '53618d83-90a4-4bcd-9294-0e7fd3a246a4',
]

async function main() {
  const db = getDb()

  const current = await db
    .select({ id: rooms.id, status: rooms.status })
    .from(rooms)
    .where(inArray(rooms.id, STUCK_ROOM_IDS))
  console.log('Current state:')
  for (const r of current) console.log(`  ${r.id}: ${r.status}`)

  await db
    .update(rooms)
    .set({
      status: 'completed',
      endedAt: new Date(),
      errorMessage: 'Vercel 5-min function timeout (zh seed batch)',
    })
    .where(and(inArray(rooms.id, STUCK_ROOM_IDS), eq(rooms.status, 'running')))

  console.log('✓ flipped to completed')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
