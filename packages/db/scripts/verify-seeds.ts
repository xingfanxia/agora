// Quick sanity check: 4 templates + 27 agents + memberships landed.
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

  const teams = await sql<{ id: string; name: string; default_mode_id: string; leader_agent_id: string | null }[]>`
    SELECT id, name, default_mode_id, leader_agent_id
      FROM teams
     WHERE is_template = true
     ORDER BY name
  `
  console.log(`templates (${teams.length}):`)
  for (const t of teams) {
    console.log(`  ${t.name} (id=${t.id.slice(0, 8)}, mode=${t.default_mode_id}, leader=${t.leader_agent_id ? t.leader_agent_id.slice(0, 8) : 'none'})`)
  }

  const agentCount = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM agents WHERE is_template = true
  `
  console.log(`template agents: ${agentCount[0]!.count}`)

  const memberCount = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
      FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
     WHERE t.is_template = true
  `
  console.log(`template memberships: ${memberCount[0]!.count}`)

  const perTeam = await sql<{ name: string; members: number }[]>`
    SELECT t.name, COUNT(tm.agent_id)::int AS members
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
     WHERE t.is_template = true
     GROUP BY t.id, t.name
     ORDER BY t.name
  `
  console.log('per-team rosters:')
  for (const row of perTeam) console.log(`  ${row.name}: ${row.members} agents`)

  await sql.end({ timeout: 5 })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
