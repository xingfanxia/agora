#!/usr/bin/env tsx
// ============================================================
// scripts/monitor-zh-demos.ts
// ============================================================
// Polls a fixed list of room IDs until all settle (completed/error),
// printing status updates whenever a room advances.
// ============================================================

interface Room {
  id: string
  label: string
}

const ROOMS: Room[] = [
  { id: 'f362efbe-6f8f-40e7-8187-c55c8716d385', label: 'debate-1 AI 开源' },
  { id: '1d30173d-af7b-4c7e-bd6e-5d967a59c933', label: 'debate-2 远程办公' },
  { id: 'a2427cba-ce80-4e35-9b4d-0d187e70f8e4', label: 'debate-3 短视频' },
  { id: '79c7dc69-45dd-4706-9c88-7b1b826c0187', label: 'werewolf-1 9p 基础' },
  { id: '0ae6b772-98ef-45f2-9c51-1f95c5add3c9', label: 'werewolf-2 9p 遗言' },
  { id: '53618d83-90a4-4bcd-9294-0e7fd3a246a4', label: 'werewolf-3 12p 预女猎守' },
]

const apiUrl = (process.env.AGORA_API_URL ?? 'https://agora-panpanmao.vercel.app').replace(/\/$/, '')

interface Snapshot {
  status: string
  messages?: unknown[]
  tokenSummary?: { callCount: number; totalCost: number }
  error?: string | null
}

const lastCalls: Record<string, number> = {}
const settled = new Set<string>()

async function snapshot(id: string): Promise<Snapshot | null> {
  const res = await fetch(`${apiUrl}/api/rooms/${id}/messages`)
  if (!res.ok) return null
  return (await res.json()) as Snapshot
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function tick() {
  await Promise.all(
    ROOMS.map(async (room) => {
      if (settled.has(room.id)) return
      const s = await snapshot(room.id)
      if (!s) return
      const calls = s.tokenSummary?.callCount ?? 0
      const cost = s.tokenSummary?.totalCost ?? 0
      const msgs = (s.messages ?? []).length
      if (calls !== lastCalls[room.id]) {
        console.log(
          `[${new Date().toISOString().slice(11, 19)}] ${room.label.padEnd(28)} · ${s.status.padEnd(9)} · ${String(msgs).padStart(3)} msgs · ${String(calls).padStart(3)} calls · $${cost.toFixed(4)}`,
        )
        lastCalls[room.id] = calls
      }
      if (s.status === 'completed' || s.status === 'error') {
        settled.add(room.id)
        if (s.status === 'error') console.error(`  ✗ ${room.label}: ${s.error}`)
        else console.log(`  ✓ ${room.label} done`)
      }
    }),
  )
}

async function main() {
  console.log(`Monitoring ${ROOMS.length} rooms at ${apiUrl}\n`)
  const deadline = Date.now() + 45 * 60 * 1000
  while (Date.now() < deadline && settled.size < ROOMS.length) {
    await tick()
    if (settled.size === ROOMS.length) break
    await sleep(20000)
  }
  console.log(`\n✓ ${settled.size}/${ROOMS.length} rooms settled`)
  console.log(`  Browse: ${apiUrl}/replays`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
