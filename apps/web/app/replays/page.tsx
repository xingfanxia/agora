'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { fmtTokens, fmtUSD, modelLabel } from '../room/[id]/components/theme'
import { SettingsMenu } from '../components/SettingsMenu'

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

const MODE_BADGE_ACCENTS: Record<string, string> = {
  roundtable: 'var(--accent)',
  werewolf: '#7f6df2',
}

export default function ReplaysPage() {
  const t = useTranslations('replays')
  const tCommon = useTranslations('common')
  const [rooms, setRooms] = useState<ReplayListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  const modeLabels: Record<string, string> = {
    roundtable: t('filters.debate'),
    werewolf: t('filters.werewolf'),
  }

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
    <div style={{ minHeight: '100vh', padding: '2rem', maxWidth: '960px', margin: '0 auto', position: 'relative' }}>
      <div style={{ position: 'absolute', top: '1.25rem', right: '1.25rem' }}>
        <SettingsMenu />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <Link href="/" style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
          {tCommon('appName')}
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: '0.875rem', fontWeight: 510 }}>{t('title')}</span>
      </div>

      <h1
        style={{
          fontSize: '2rem',
          fontWeight: 590,
          letterSpacing: '-0.03em',
          marginBottom: '0.5rem',
        }}
      >
        {t('title')}
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
        {t('description')}
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {(['all', 'roundtable', 'werewolf'] as const).map((m) => {
          const active = filter === m
          return (
            <button
              key={m}
              type="button"
              onClick={() => setFilter(m)}
              style={{
                padding: '0.375rem 0.875rem',
                fontSize: '0.8rem',
                fontWeight: 510,
                letterSpacing: '-0.13px',
                borderRadius: '999px',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? '#08090a' : 'var(--foreground-secondary)',
                cursor: 'pointer',
                transition: 'background .15s ease, color .15s ease',
              }}
            >
              {m === 'all' ? t('filters.all') : modeLabels[m] ?? m}
            </button>
          )
        })}
      </div>

      {loading && <p style={{ color: 'var(--muted)' }}>{t('loading')}</p>}

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
          <p style={{ fontSize: '0.95rem', marginBottom: '1rem' }}>{t('empty')}</p>
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
            {t('startNewGame')}
          </Link>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {filtered.map((room) => {
          const badgeLabel = modeLabels[room.modeId] ?? room.modeId
          const badgeAccent = MODE_BADGE_ACCENTS[room.modeId] ?? 'var(--muted-strong)'
          // Mint badge needs dark text for contrast; colored badges (werewolf purple, muted gray) use white.
          const badgeText = badgeAccent === 'var(--accent)' ? '#08090a' : '#ffffff'
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
                    borderRadius: 4,
                    background: badgeAccent,
                    color: badgeText,
                    fontSize: 11,
                    fontWeight: 590,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    flexShrink: 0,
                  }}
                >
                  {badgeLabel}
                </span>
                <h3
                  style={{
                    fontSize: '1rem',
                    fontWeight: 590,
                    lineHeight: 1.3,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {room.topic ?? t('untitled')}
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
                      fontWeight: 590,
                    }}
                  >
                    {winResult === 'village_wins' ? t('badges.village') : t('badges.wolves')}
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
                <span>{t('agents', { count: room.agents.length })}</span>
                <span>{t('messages', { count: room.messageCount })}</span>
                <span>{t('calls', { count: room.callCount })}</span>
                <span>{t('tokens', { count: fmtTokens(room.totalTokens) })}</span>
                <span style={{ fontWeight: 590, color: 'var(--foreground)' }}>
                  {fmtUSD(room.totalCost)}
                </span>
                {durationSec != null && <span>{t('duration', { seconds: durationSec })}</span>}
                <span style={{ marginLeft: 'auto' }}>
                  {ended ? ended.toLocaleString() : ''}
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
