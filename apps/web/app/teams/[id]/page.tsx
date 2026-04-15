// ============================================================
// /teams/[id] — team detail
// ============================================================

'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AgentAvatarPixel } from '../../components/AgentAvatarPixel'
import { getOrCreateUserId } from '../../lib/user-id'

interface Team {
  id: string
  createdBy: string | null
  name: string
  description: string | null
  avatarSeed: string
  leaderAgentId: string | null
  defaultModeId: string | null
  isTemplate: boolean
  createdAt: string
}

interface Member {
  agentId: string
  position: number
  agent: {
    id: string
    name: string
    persona: string
    avatarSeed: string
    modelProvider: string
    modelId: string
    isTemplate: boolean
  }
}

const MODE_LABEL: Record<string, string> = {
  'open-chat': '开放对话',
  roundtable: '轮桌辩论',
  werewolf: '狼人杀',
}

export default function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const t = useTranslations('teams')
  const tCommon = useTranslations('common')
  const [team, setTeam] = useState<Team | null>(null)
  const [members, setMembers] = useState<Member[]>([])
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
        const res = await fetch(`/api/teams/${id}`)
        if (res.status === 404) {
          if (!cancelled) setNotFoundFlag(true)
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { team: Team; members: Member[] }
        if (!cancelled) {
          setTeam(data.team)
          setMembers(data.members ?? [])
        }
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
  if (!team) return null

  const isOwner = userId !== null && team.createdBy === userId

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
      <Link
        href="/teams"
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

      <div
        style={{
          display: 'flex',
          gap: 20,
          alignItems: 'flex-start',
          marginBottom: 24,
        }}
      >
        <AgentAvatarPixel seed={team.avatarSeed} size={96} />
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{team.name}</h1>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
            {members.length} 位成员
            {team.defaultModeId && <> · 默认：{MODE_LABEL[team.defaultModeId] ?? team.defaultModeId}</>}
            {team.isTemplate && (
              <span style={{ marginLeft: 8, color: 'var(--accent)' }}>· {t('templateBadge')}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link
              href={`/rooms/new?teamId=${team.id}`}
              style={{
                background: 'var(--accent)',
                color: 'white',
                padding: '8px 16px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              {t('startRoom')}
            </Link>
            {isOwner && !team.isTemplate && (
              <Link
                href={`/teams/${team.id}/edit`}
                style={{
                  padding: '8px 14px',
                  borderRadius: 999,
                  background: 'var(--surface-hover)',
                  color: 'var(--foreground)',
                  fontSize: 13,
                  fontWeight: 500,
                  textDecoration: 'none',
                  border: '1px solid var(--border)',
                }}
              >
                {t('editTeam')}
              </Link>
            )}
          </div>
        </div>
      </div>

      {team.description && (
        <section style={{ marginBottom: 24 }}>
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
            {t('detail.description')}
          </div>
          <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'var(--foreground)', margin: 0 }}>
            {team.description}
          </p>
        </section>
      )}

      <section>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--muted)',
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          {t('detail.members')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {members.map((m) => {
            const isLeader = m.agentId === team.leaderAgentId
            return (
              <Link
                key={m.agentId}
                href={`/agents/${m.agentId}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface)',
                  border: `1px solid ${isLeader ? 'rgba(34, 196, 147, 0.3)' : 'var(--border)'}`,
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <AgentAvatarPixel seed={m.agent.avatarSeed} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    {m.agent.name}
                    {isLeader && (
                      <span style={{ marginLeft: 8, color: 'var(--accent)', fontSize: 12 }}>
                        ⚜ {t('detail.leader')}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {m.agent.modelProvider} · {m.agent.modelId}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}
