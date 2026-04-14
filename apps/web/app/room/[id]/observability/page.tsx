'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Timeline } from '../components/Timeline'
import { TokenCostPanel } from '../components/TokenCostPanel'
import type { AgentData, PollResponse, TokenSummary } from '../components/theme'
import { createAgentColorMap, prefersDark } from '../components/theme'

interface EventEnvelope {
  index: number
  timestamp: number
  event: { type: string; [k: string]: unknown }
}

export default function ObservabilityPage() {
  const t = useTranslations('observability')
  const tCommon = useTranslations('common')
  const params = useParams()
  const roomId = params.id as string

  const [events, setEvents] = useState<EventEnvelope[]>([])
  const [agents, setAgents] = useState<AgentData[]>([])
  const [tokenSummary, setTokenSummary] = useState<TokenSummary | null>(null)
  const [status, setStatus] = useState<'running' | 'completed' | 'error'>('running')
  const [isDark, setIsDark] = useState(false)

  const nextAfterRef = useRef(-1)
  const statusRef = useRef<'running' | 'completed' | 'error'>('running')

  useEffect(() => {
    setIsDark(prefersDark())
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Poll both endpoints in parallel — events for timeline, messages for agents/tokens snapshot
  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const [eventsRes, msgRes] = await Promise.all([
          fetch(`/api/rooms/${roomId}/events?after=${nextAfterRef.current}`),
          fetch(`/api/rooms/${roomId}/messages`),
        ])

        const eventsData = (await eventsRes.json()) as {
          events: EventEnvelope[]
          total: number
          status: 'running' | 'completed' | 'error'
        }
        const msgData = (await msgRes.json()) as PollResponse

        if (!cancelled) {
          if (eventsData.events.length > 0) {
            setEvents((prev) => {
              const lastIndex = eventsData.events[eventsData.events.length - 1]!.index
              nextAfterRef.current = lastIndex
              return [...prev, ...eventsData.events]
            })
          }
          setAgents(msgData.agents)
          setTokenSummary(msgData.tokenSummary)
          setStatus(msgData.status)
          statusRef.current = msgData.status
        }
      } catch {
        // quiet — retry next tick
      }

      if (!cancelled) {
        const delay = statusRef.current === 'running' ? 1500 : 5000
        setTimeout(poll, delay)
      }
    }

    poll()

    return () => {
      cancelled = true
    }
  }, [roomId])

  const colorFor = useMemo(() => createAgentColorMap(agents, isDark), [agents, isDark])

  return (
    <div
      style={{
        maxWidth: '960px',
        margin: '0 auto',
        padding: '1rem',
      }}
    >
      <header
        style={{
          padding: '1rem 0',
          borderBottom: '1px solid var(--border)',
          marginBottom: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <Link href="/" style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
            {tCommon('appName')}
          </Link>
          <span style={{ color: 'var(--border)', fontSize: '0.8rem' }}>/</span>
          <Link href={`/room/${roomId}`} style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
            {t('room')}
          </Link>
          <span style={{ color: 'var(--border)', fontSize: '0.8rem' }}>/</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{t('title')}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.02em' }}>
            {t('eventTimeline')}
          </h1>
          <span
            style={{
              fontSize: '0.75rem',
              color: 'var(--muted)',
              padding: '0.15rem 0.5rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '999px',
            }}
          >
            {t('eventsStatus', { count: events.length, status })}
          </span>
          <Link
            href={`/room/${roomId}`}
            style={{
              marginLeft: 'auto',
              fontSize: '0.8rem',
              color: 'var(--accent)',
              textDecoration: 'none',
            }}
          >
            {t('backToRoom')}
          </Link>
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <TokenCostPanel summary={tokenSummary} agents={agents} defaultExpanded />
        </div>
      </header>

      <Timeline entries={events} agents={agents} colorFor={colorFor} />
    </div>
  )
}
