// ============================================================
// /agents — agent list with Mine / Templates tabs
// ============================================================

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AgentCard, type AgentCardAgent } from '../components/AgentCard'
import { getOrCreateUserId } from '../lib/user-id'

interface AgentRow extends AgentCardAgent {
  createdBy: string | null
  createdAt: string
}

type Tab = 'mine' | 'templates'

export default function AgentsListPage() {
  const t = useTranslations('agents')
  const [tab, setTab] = useState<Tab>('templates')
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getOrCreateUserId()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/agents?scope=${tab}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { agents: AgentRow[] }
        if (!cancelled) setAgents(data.agents ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [tab])

  const count = useMemo(() => agents.length, [agents])

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 24px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 590, marginBottom: 4, color: 'var(--foreground)' }}>
            {t('title')}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--muted)' }}>{t('subtitle')}</p>
        </div>
        <Link
          href="/agents/new"
          style={{
            background: 'var(--accent-strong)',
            color: '#ffffff',
            padding: '10px 18px',
            borderRadius: 'var(--radius-card)',
            fontSize: 14,
            fontWeight: 590,
            textDecoration: 'none',
          }}
        >
          {t('newAgent')}
        </Link>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--border)',
          marginBottom: 24,
        }}
      >
        {(['templates', 'mine'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: 510,
              color: tab === k ? 'var(--foreground)' : 'var(--muted)',
              borderBottom: `2px solid ${tab === k ? 'var(--accent)' : 'transparent'}`,
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {k === 'templates' ? t('tabs.templates') : t('tabs.mine')}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--muted)', fontSize: 14 }}>{t('loading')}</p>}
      {error && (
        <p style={{ color: 'var(--danger)', fontSize: 14 }}>{t('loadError', { error })}</p>
      )}

      {!loading && !error && agents.length === 0 && (
        <div
          style={{
            padding: '40px 24px',
            textAlign: 'center',
            color: 'var(--muted)',
            background: 'var(--surface)',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius)',
          }}
        >
          {tab === 'mine' ? t('empty.mine') : t('empty.templates')}
        </div>
      )}

      {!loading && agents.length > 0 && (
        <>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            {t('countLabel', { count })}
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 16,
            }}
          >
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
