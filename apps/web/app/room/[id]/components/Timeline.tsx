'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { AgentData, AgentColor } from './theme'
import { fmtTokens, fmtUSD, modelLabel } from './theme'

// ── Event types (mirrors PlatformEvent from @agora/shared) ──

type AnyEvent = Record<string, unknown> & { type: string }

interface TimelineEntry {
  index: number
  timestamp: number
  event: AnyEvent
}

interface TimelineProps {
  entries: readonly TimelineEntry[]
  agents: readonly AgentData[]
  colorFor: (agentId: string) => AgentColor
}

type FilterType = 'all' | 'messages' | 'phases' | 'tokens' | 'thinking'

export function Timeline({ entries, agents, colorFor }: TimelineProps) {
  const tObs = useTranslations('observability')
  const [filter, setFilter] = useState<FilterType>('all')
  const [agentFilter, setAgentFilter] = useState<string>('all')

  const agentNameById = useMemo(() => {
    const m = new Map<string, string>()
    agents.forEach((a) => m.set(a.id, a.name))
    return m
  }, [agents])

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      const ev = e.event
      if (filter !== 'all') {
        const matchType = filterMatches(filter, ev.type)
        if (!matchType) return false
      }
      if (agentFilter !== 'all') {
        const agentId = extractAgentId(ev)
        if (agentId !== agentFilter) return false
      }
      return true
    })
  }, [entries, filter, agentFilter])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <FilterBar
        filter={filter}
        setFilter={setFilter}
        agentFilter={agentFilter}
        setAgentFilter={setAgentFilter}
        agents={agents}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        {filtered.length === 0 && (
          <div style={{ padding: '1rem', color: 'var(--muted)', fontSize: '0.85rem', textAlign: 'center' }}>
            {tObs('empty')}
          </div>
        )}
        {filtered.map((entry) => (
          <TimelineRow
            key={entry.index}
            entry={entry}
            colorFor={colorFor}
            agentNameById={agentNameById}
          />
        ))}
      </div>
    </div>
  )
}

// ── Filter bar ───────────────────────────────────────────────

function FilterBar({
  filter,
  setFilter,
  agentFilter,
  setAgentFilter,
  agents,
}: {
  filter: FilterType
  setFilter: (f: FilterType) => void
  agentFilter: string
  setAgentFilter: (a: string) => void
  agents: readonly AgentData[]
}) {
  const t = useTranslations('observability')
  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: t('filters.all') },
    { key: 'messages', label: t('filters.messages') },
    { key: 'phases', label: t('filters.phases') },
    { key: 'tokens', label: t('filters.tokens') },
    { key: 'thinking', label: t('filters.thinking') },
  ]

  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center',
        padding: '0.5rem 0',
        borderBottom: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', gap: '0.25rem' }}>
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            style={{
              padding: '0.3rem 0.625rem',
              fontSize: '0.75rem',
              fontWeight: 500,
              borderRadius: '999px',
              border: `1px solid ${filter === f.key ? 'var(--accent)' : 'var(--border)'}`,
              background: filter === f.key ? 'var(--accent)' : 'transparent',
              color: filter === f.key ? '#fff' : 'var(--foreground)',
              cursor: 'pointer',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      <select
        value={agentFilter}
        onChange={(e) => setAgentFilter(e.target.value)}
        style={{
          marginLeft: 'auto',
          padding: '0.3rem 0.5rem',
          fontSize: '0.75rem',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          background: 'var(--surface)',
          color: 'var(--foreground)',
        }}
      >
        <option value="all">{t('filters.allAgents')}</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  )
}

// ── Row rendering ────────────────────────────────────────────

function TimelineRow({
  entry,
  colorFor,
  agentNameById,
}: {
  entry: TimelineEntry
  colorFor: (agentId: string) => AgentColor
  agentNameById: Map<string, string>
}) {
  const { event } = entry
  const timeLabel = entry.timestamp > 0 ? new Date(entry.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) : '—'

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '2.25rem 6rem 1fr',
        gap: '0.5rem',
        alignItems: 'start',
        padding: '0.5rem 0.625rem',
        borderRadius: '6px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        fontSize: '0.8rem',
        lineHeight: 1.4,
      }}
    >
      <span
        style={{
          fontSize: '0.6rem',
          color: 'var(--muted)',
          fontFamily: 'var(--font-geist-mono), monospace',
          textAlign: 'right',
        }}
      >
        #{entry.index}
      </span>
      <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-geist-mono), monospace' }}>
        {timeLabel}
      </span>
      <div style={{ minWidth: 0 }}>
        <EventBody event={event} colorFor={colorFor} agentNameById={agentNameById} />
      </div>
    </div>
  )
}

function EventBody({
  event,
  colorFor,
  agentNameById,
}: {
  event: AnyEvent
  colorFor: (agentId: string) => AgentColor
  agentNameById: Map<string, string>
}) {
  const tCommon = useTranslations('common')
  const tObs = useTranslations('observability')
  switch (event.type) {
    case 'message:created': {
      const msg = (event as { message?: Record<string, unknown> }).message ?? {}
      const senderId = String(msg['senderId'] ?? '')
      const senderName = String(msg['senderName'] ?? 'Unknown')
      const channelId = String(msg['channelId'] ?? 'main')
      const content = String(msg['content'] ?? '')
      const metadata = msg['metadata'] as Record<string, unknown> | undefined
      const hasDecision = metadata?.['decision'] !== undefined
      const colors = senderId === 'system' ? null : colorFor(senderId)

      return (
        <div>
          <EventLabel
            type="message"
            label={
              <>
                <span style={{ color: colors?.name, fontWeight: 600 }}>{senderName}</span>
                {channelId !== 'main' && (
                  <span style={{ color: 'var(--muted)', fontSize: '0.7rem', marginLeft: '0.375rem' }}>
                    #{channelId}
                  </span>
                )}
                {hasDecision && <TagDecision />}
              </>
            }
          />
          <div
            style={{
              marginTop: '0.25rem',
              color: 'var(--foreground)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontSize: '0.75rem',
            }}
            title={content}
          >
            {hasDecision ? (
              <code style={{ fontSize: '0.7rem' }}>
                {JSON.stringify(metadata?.['decision']).slice(0, 160)}
              </code>
            ) : (
              content.slice(0, 160)
            )}
          </div>
        </div>
      )
    }
    case 'phase:changed': {
      const phase = String(event['phase'] ?? '')
      const previousPhase = event['previousPhase']
      return (
        <EventLabel
          type="phase"
          label={
            <>
              <span style={{ fontWeight: 600 }}>{phase}</span>
              {previousPhase && (
                <span style={{ color: 'var(--muted)', fontSize: '0.7rem', marginLeft: '0.375rem' }}>
                  from {String(previousPhase)}
                </span>
              )}
            </>
          }
        />
      )
    }
    case 'round:changed': {
      const round = Number(event['round'] ?? 0)
      return <EventLabel type="round" label={`Round ${round}`} />
    }
    case 'agent:thinking': {
      const agentId = String(event['agentId'] ?? '')
      const name = agentNameById.get(agentId) ?? agentId.slice(0, 8)
      const colors = colorFor(agentId)
      return (
        <EventLabel
          type="thinking"
          label={
            <>
              <span style={{ color: colors.name, fontWeight: 600 }}>{name}</span>
              <span style={{ color: 'var(--muted)' }}> {tCommon('isThinking')}</span>
            </>
          }
        />
      )
    }
    case 'agent:done': {
      const agentId = String(event['agentId'] ?? '')
      const name = agentNameById.get(agentId) ?? agentId.slice(0, 8)
      return (
        <EventLabel
          type="done"
          label={
            <>
              <span style={{ fontWeight: 600 }}>{name}</span>
              <span style={{ color: 'var(--muted)' }}> {tCommon('finished')}</span>
            </>
          }
        />
      )
    }
    case 'token:recorded': {
      const agentId = String(event['agentId'] ?? '')
      const name = agentNameById.get(agentId) ?? agentId.slice(0, 8)
      const modelId = String(event['modelId'] ?? '')
      const cost = Number(event['cost'] ?? 0)
      const usage = (event['usage'] as Record<string, number>) ?? {}
      const totalTokens = Number(usage['totalTokens'] ?? 0)
      const colors = colorFor(agentId)
      return (
        <EventLabel
          type="token"
          label={
            <>
              <span style={{ color: colors.name, fontWeight: 600 }}>{name}</span>
              <span style={{ color: 'var(--muted)' }}>
                {' '}
                {modelLabel(modelId)} · {fmtTokens(totalTokens)} tokens · {fmtUSD(cost)}
              </span>
            </>
          }
        />
      )
    }
    case 'room:started':
      return <EventLabel type="lifecycle" label={tObs('events.roomStarted')} />
    case 'room:ended':
      return <EventLabel type="lifecycle" label={tObs('events.roomEnded')} />
    default:
      return <EventLabel type="other" label={event.type} />
  }
}

// ── Utility ───────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  message: '#3b82f6',
  phase: '#a855f7',
  round: '#a855f7',
  thinking: '#f59e0b',
  done: '#64748b',
  token: '#10b981',
  lifecycle: '#ef4444',
  other: '#64748b',
}

function EventLabel({
  type,
  label,
}: {
  type: keyof typeof TYPE_COLORS
  label: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span
        style={{
          display: 'inline-block',
          width: '0.625rem',
          height: '0.625rem',
          borderRadius: '50%',
          background: TYPE_COLORS[type],
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: '0.78rem' }}>{label}</span>
    </div>
  )
}

function TagDecision() {
  const t = useTranslations('common')
  return (
    <span
      style={{
        marginLeft: '0.375rem',
        fontSize: '0.6rem',
        padding: '0.075rem 0.375rem',
        borderRadius: '999px',
        border: '1px solid var(--border)',
        color: 'var(--muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {t('decision')}
    </span>
  )
}

function filterMatches(filter: FilterType, eventType: string): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'messages':
      return eventType === 'message:created'
    case 'phases':
      return eventType === 'phase:changed' || eventType === 'round:changed'
    case 'tokens':
      return eventType === 'token:recorded'
    case 'thinking':
      return eventType === 'agent:thinking' || eventType === 'agent:done'
  }
}

function extractAgentId(event: AnyEvent): string | undefined {
  if (typeof event['agentId'] === 'string') return event['agentId']
  const msg = event['message']
  if (msg && typeof msg === 'object') {
    const senderId = (msg as { senderId?: unknown }).senderId
    if (typeof senderId === 'string') return senderId
  }
  return undefined
}
