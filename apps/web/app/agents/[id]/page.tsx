// ============================================================
// /agents/[id] — read-only agent detail
// ============================================================

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { use } from 'react'
import { useTranslations } from 'next-intl'
import { AgentAvatarPixel } from '../../components/AgentAvatarPixel'
import { getOrCreateUserId } from '../../lib/user-id'

interface Agent {
  id: string
  createdBy: string | null
  name: string
  persona: string
  systemPrompt: string | null
  modelProvider: string
  modelId: string
  style: Record<string, unknown>
  avatarSeed: string
  isTemplate: boolean
  createdAt: string
  updatedAt: string
}

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useTranslations('agents')
  const tCommon = useTranslations('common')
  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFoundFlag, setNotFoundFlag] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    setUserId(getOrCreateUserId())
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/agents/${id}`)
        if (res.status === 404) {
          if (!cancelled) setNotFoundFlag(true)
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { agent: Agent }
        if (!cancelled) setAgent(data.agent)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (notFoundFlag) notFound()
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
        {tCommon('loading')}
      </div>
    )
  }
  if (!agent) return null

  const isOwner = userId !== null && agent.createdBy === userId

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px' }}>
      <Link
        href="/agents"
        style={{
          color: 'var(--muted)',
          fontSize: 13,
          textDecoration: 'none',
          marginBottom: 16,
          display: 'inline-block',
        }}
      >
        ← {t('backToList')}
      </Link>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 24 }}>
        <AgentAvatarPixel seed={agent.avatarSeed} size={96} />
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{agent.name}</h1>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
            {agent.modelProvider} · {agent.modelId}
            {agent.isTemplate && (
              <span style={{ marginLeft: 8, color: 'var(--accent)' }}>· {t('templateBadge')}</span>
            )}
          </div>
          {isOwner && !agent.isTemplate && (
            <Link
              href={`/agents/${agent.id}/edit`}
              style={{
                display: 'inline-block',
                padding: '6px 14px',
                borderRadius: 999,
                background: 'var(--surface-hover)',
                color: 'var(--foreground)',
                fontSize: 13,
                fontWeight: 500,
                textDecoration: 'none',
                border: '1px solid var(--border)',
              }}
            >
              {t('editAgent')}
            </Link>
          )}
        </div>
      </div>

      <Section label={t('detail.personaLabel')}>
        <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'var(--foreground)' }}>
          {agent.persona}
        </p>
      </Section>

      <Section label={t('detail.styleLabel')}>
        <StyleTable style={agent.style} />
      </Section>

      {agent.systemPrompt && (
        <Section label={t('detail.promptLabel')}>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 13,
              lineHeight: 1.55,
              padding: 16,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-hover)',
              color: 'var(--foreground)',
              margin: 0,
            }}
          >
            {agent.systemPrompt}
          </pre>
        </Section>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--muted)',
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function StyleTable({ style }: { style: Record<string, unknown> }) {
  const entries = Object.entries(style)
  if (entries.length === 0) {
    return <div style={{ color: 'var(--muted)', fontSize: 14 }}>—</div>
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>{k}</div>
          <div style={{ fontSize: 13, color: 'var(--foreground)' }}>{String(v)}</div>
        </div>
      ))}
    </div>
  )
}
