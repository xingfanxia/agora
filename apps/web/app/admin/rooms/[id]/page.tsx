// ============================================================
// /admin/rooms/[id] — Phase 4.5a observability
// ============================================================
//
// Dense one-pager showing the durable runtime state of a room:
// - Status + phase + round + updated_at + waiting descriptor
// - Last 50 events with type + seq + occurred_at
// - Full gameState JSON dump
// - Agents + roleAssignments
//
// Auth (MVP): gated on ?secret=XYZ query param matching AGORA_ADMIN_SECRET
// env var when set. If the env var is empty/unset, the page is unguarded
// (useful for local dev).

import { notFound } from 'next/navigation'
import type { EventRow } from '@agora/db'
import { events, getDb, rooms } from '@agora/db'
import { and, desc, eq, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type Params = { id: string }

async function loadAdminData(id: string) {
  const db = getDb()
  const [row] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1)
  if (!row) return null
  // Load up to 200 most recent events — full transcript lives at
  // /observability; this page is for quick runtime diagnosis.
  const recentRows = await db
    .select()
    .from(events)
    .where(and(eq(events.roomId, id)))
    .orderBy(desc(events.seq))
    .limit(200)
  // Oldest-first for display
  const eventRows: EventRow[] = recentRows.slice().reverse()
  const [totalRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(events)
    .where(eq(events.roomId, id))
  return { row, eventRows, totalEventCount: totalRow?.c ?? eventRows.length }
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  return d.toISOString()
}

export default async function AdminRoomPage({
  params,
  searchParams,
}: {
  params: Promise<Params>
  searchParams: Promise<{ secret?: string }>
}) {
  const { id } = await params
  const { secret } = await searchParams
  const expected = process.env['AGORA_ADMIN_SECRET']
  if (expected && secret !== expected) {
    return (
      <main
        style={{
          fontFamily: 'system-ui, sans-serif',
          padding: 24,
          color: '#e6e6e6',
          background: '#0a0a0a',
          minHeight: '100vh',
        }}
      >
        <h1>Unauthorized</h1>
        <p>Missing or wrong ?secret= query param.</p>
      </main>
    )
  }

  const data = await loadAdminData(id)
  if (!data) return notFound()

  const { row, eventRows, totalEventCount } = data
  const waiting = row.waitingFor as { eventName?: string; match?: unknown } | null
  const lastEvent = eventRows[eventRows.length - 1]
  const recentEvents = eventRows.slice(-50)

  return (
    <main
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        padding: '24px 32px',
        color: '#e6e6e6',
        background: '#0a0a0a',
        minHeight: '100vh',
        fontSize: 13,
      }}
    >
      <h1 style={{ fontSize: 20, margin: '0 0 20px' }}>
        {row.modeId} · {row.id.slice(0, 8)}…
      </h1>

      <Section title="Runtime state">
        <Row label="status" value={row.status} accent={row.status} />
        <Row label="phase" value={row.currentPhase ?? '—'} />
        <Row label="round" value={String(row.currentRound)} />
        <Row label="thinking agent" value={row.thinkingAgentId ?? '—'} />
        <Row label="updated_at" value={fmtDate(row.updatedAt)} />
        <Row label="started_at" value={fmtDate(row.startedAt)} />
        <Row label="ended_at" value={fmtDate(row.endedAt)} />
        <Row label="error" value={row.errorMessage ?? '—'} />
      </Section>

      {waiting && (
        <Section title="Waiting for">
          <Row label="event" value={waiting.eventName ?? '—'} />
          <Row label="until" value={fmtDate(row.waitingUntil)} />
          <Row
            label="match"
            value={JSON.stringify(waiting.match ?? {})}
          />
        </Section>
      )}

      <Section title={`Events (${totalEventCount} total, showing last ${recentEvents.length})`}>
        <Row label="last seq" value={String(lastEvent?.seq ?? '—')} />
        <Row label="last type" value={lastEvent?.type ?? '—'} />
        <Row label="last at" value={fmtDate(lastEvent?.occurredAt ?? null)} />
        <div style={{ marginTop: 12, borderTop: '1px solid #2a2a2a', paddingTop: 12 }}>
          {recentEvents.map((e) => (
            <div
              key={e.seq}
              style={{
                display: 'grid',
                gridTemplateColumns: '60px 180px 160px 1fr',
                gap: 12,
                padding: '4px 0',
                borderBottom: '1px solid #1a1a1a',
                fontSize: 12,
              }}
            >
              <span style={{ color: '#7a7a7a' }}>#{e.seq}</span>
              <span style={{ color: typeColor(e.type) }}>{e.type}</span>
              <span style={{ color: '#7a7a7a' }}>{fmtDate(e.occurredAt)}</span>
              <span style={{ color: '#a0a0a0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {truncatePayload(e.payload)}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Agents">
        <pre style={{ fontSize: 12, color: '#a0a0a0', overflow: 'auto' }}>
          {JSON.stringify(row.agents, null, 2)}
        </pre>
      </Section>

      {row.roleAssignments ? (
        <Section title="Role assignments">
          <pre style={{ fontSize: 12, color: '#a0a0a0', overflow: 'auto' }}>
            {JSON.stringify(row.roleAssignments, null, 2)}
          </pre>
        </Section>
      ) : null}

      <Section title="gameState snapshot">
        <pre style={{ fontSize: 12, color: '#a0a0a0', overflow: 'auto' }}>
          {JSON.stringify(row.gameState, null, 2)}
        </pre>
      </Section>
    </main>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      style={{
        marginBottom: 28,
        padding: 16,
        background: '#121212',
        borderRadius: 6,
        border: '1px solid #242424',
      }}
    >
      <h2 style={{ fontSize: 14, margin: '0 0 12px', color: '#9a9a9a', textTransform: 'uppercase', letterSpacing: 1 }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  const color =
    accent === 'running'
      ? '#4caf50'
      : accent === 'waiting'
        ? '#ff9800'
        : accent === 'completed'
          ? '#9e9e9e'
          : accent === 'error'
            ? '#f44336'
            : '#e6e6e6'
  return (
    <div style={{ display: 'flex', gap: 12, padding: '2px 0' }}>
      <span style={{ color: '#7a7a7a', width: 140 }}>{label}</span>
      <span style={{ color }}>{value}</span>
    </div>
  )
}

function typeColor(type: string): string {
  if (type.startsWith('room:')) return '#4fa8ff'
  if (type.startsWith('phase:')) return '#ff9800'
  if (type.startsWith('round:')) return '#ffb74d'
  if (type.startsWith('message:')) return '#81c784'
  if (type.startsWith('token:')) return '#ba68c8'
  if (type.startsWith('agent:thinking')) return '#64b5f6'
  if (type.startsWith('agent:')) return '#9e9e9e'
  return '#a0a0a0'
}

function truncatePayload(payload: unknown): string {
  try {
    const s = JSON.stringify(payload)
    return s.length > 180 ? s.slice(0, 177) + '…' : s
  } catch {
    return '<unserializable>'
  }
}
