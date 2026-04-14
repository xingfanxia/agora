'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fmtTokens, fmtUSD, modelLabel } from '../room/[id]/components/theme'

interface AgentInfo {
  id: string
  name: string
  model: string
  provider: string
}

interface ReplayListItem {
  id: string
  modeId: string
  topic: string | null
  agents: AgentInfo[]
  currentPhase: string | null
  gameState: Record<string, unknown> | null
  totalCost: number
  totalTokens: number
  callCount: number
  messageCount: number
  createdAt: string
  startedAt: string | null
  endedAt: string | null
}

const MODE_BADGES: Record<string, { label: string; accent: string }> = {
  roundtable: { label: 'Debate', accent: 'var(--accent)' },
  werewolf: { label: 'Werewolf', accent: '#7f6df2' },
}

export default function ReplaysPage() {
  const [rooms, setRooms] = useState<ReplayListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    fetch('/api/rooms')
      .then((res) => res.json())
      .then((data: { rooms: ReplayListItem[] }) => {
        setRooms(data.rooms ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const filtered = filter === 'all' ? rooms : rooms.filter((r) => r.modeId === filter)

  return (
    <div style={{ minHeight: '100vh', padding: '2rem', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <Link href="/" style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
          Agora
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Replays</span>
      </div>

      <h1
        style={{
          fontSize: '2rem',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          marginBottom: '0.5rem',
        }}
      >
        Replays
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
        Every completed game and debate, replayable with full event timeline.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {(['all', 'roundtable', 'werewolf'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setFilter(m)}
            style={{
              padding: '0.375rem 0.875rem',
              fontSize: '0.8rem',
              fontWeight: 500,
              borderRadius: '999px',
              border: `1px solid ${filter === m ? 'var(--accent)' : 'var(--border)'}`,
              background: filter === m ? 'var(--accent)' : 'transparent',
              color: filter === m ? '#fff' : 'var(--foreground)',
              cursor: 'pointer',
            }}
          >
            {m === 'all' ? 'All' : MODE_BADGES[m]?.label ?? m}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>Loading...</p>}

      {!loading && filtered.length === 0 && (
        <div
          style={{
            padding: '3rem',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius)',
            textAlign: 'center',
            color: 'var(--muted)',
          }}
        >
          <p style={{ fontSize: '0.95rem', marginBottom: '1rem' }}>No replays yet.</p>
          <Link
            href="/"
            style={{
              display: 'inline-block',
              padding: '0.5rem 1rem',
              background: 'var(--foreground)',
              color: 'var(--background)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              textDecoration: 'none',
            }}
          >
            Start a new game
          </Link>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {filtered.map((room) => {
          const badge = MODE_BADGES[room.modeId] ?? { label: room.modeId, accent: 'var(--muted)' }
          const winResult = (room.gameState as { winResult?: string } | null)?.winResult
          const started = room.startedAt ? new Date(room.startedAt) : null
          const ended = room.endedAt ? new Date(room.endedAt) : null
          const durationSec =
            started && ended ? Math.round((ended.getTime() - started.getTime()) / 1000) : null

          const modelList = [...new Set(room.agents.map((a) => modelLabel(a.model)))]

          return (
            <Link
              key={room.id}
              href={`/replay/${room.id}`}
              style={{
                display: 'block',
                padding: '1rem 1.25rem',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                textDecoration: 'none',
                color: 'var(--foreground)',
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'start', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <span
                  style={{
                    padding: '0.2rem 0.625rem',
                    borderRadius: '999px',
                    background: badge.accent,
                    color: '#fff',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                    flexShrink: 0,
                  }}
                >
                  {badge.label}
                </span>
                <h3
                  style={{
                    fontSize: '1rem',
                    fontWeight: 600,
                    lineHeight: 1.3,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {room.topic ?? 'Untitled'}
                </h3>
                {winResult && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      padding: '0.15rem 0.5rem',
                      borderRadius: '999px',
                      background:
                        winResult === 'village_wins'
                          ? 'color-mix(in srgb, #22c55e 15%, transparent)'
                          : 'color-mix(in srgb, var(--danger) 15%, transparent)',
                      color: winResult === 'village_wins' ? '#15803d' : 'var(--danger)',
                      fontWeight: 600,
                    }}
                  >
                    {winResult === 'village_wins' ? '🎉 Village' : '🐺 Wolves'}
                  </span>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.75rem 1.25rem',
                  fontSize: '0.75rem',
                  color: 'var(--muted)',
                }}
              >
                <span>{room.agents.length} agents</span>
                <span>{room.messageCount} messages</span>
                <span>{room.callCount} calls</span>
                <span>{fmtTokens(room.totalTokens)} tokens</span>
                <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>
                  {fmtUSD(room.totalCost)}
                </span>
                {durationSec != null && <span>{durationSec}s</span>}
                <span style={{ marginLeft: 'auto' }}>
                  {ended ? ended.toLocaleString() : 'Unknown'}
                </span>
              </div>

              {modelList.length > 0 && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    fontSize: '0.7rem',
                    color: 'var(--muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {modelList.join(' · ')}
                </div>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
