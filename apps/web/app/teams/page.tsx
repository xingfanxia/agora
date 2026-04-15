// ============================================================
// /teams — team list with Templates / Mine tabs
// ============================================================

'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { TeamCard, type TeamCardTeam, type TeamCardMember } from '../components/TeamCard'
import { getOrCreateUserId } from '../lib/user-id'

interface TeamRow extends TeamCardTeam {
  createdBy: string | null
  createdAt: string
}

type Tab = 'templates' | 'mine'

export default function TeamsListPage() {
  const t = useTranslations('teams')
  const [tab, setTab] = useState<Tab>('templates')
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [membersByTeam, setMembersByTeam] = useState<Record<string, TeamCardMember[]>>({})
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
        const res = await fetch(`/api/teams?scope=${tab}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { teams: TeamRow[] }
        const rows = data.teams ?? []
        if (cancelled) return
        setTeams(rows)

        // Fetch members per team in parallel (small N — 4 templates + user's own).
        const memberResults = await Promise.all(
          rows.map((row) =>
            fetch(`/api/teams/${row.id}/members`)
              .then((r) => (r.ok ? r.json() : { members: [] }))
              .then((d: { members: Array<{ agentId: string; agent: { avatarSeed: string; name: string } }> }) => ({
                teamId: row.id,
                members: d.members.map((m) => ({
                  agentId: m.agentId,
                  avatarSeed: m.agent.avatarSeed,
                  name: m.agent.name,
                })),
              }))
              .catch(() => ({ teamId: row.id, members: [] as TeamCardMember[] })),
          ),
        )
        if (cancelled) return
        const next: Record<string, TeamCardMember[]> = {}
        for (const r of memberResults) next[r.teamId] = r.members
        setMembersByTeam(next)
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

  const count = useMemo(() => teams.length, [teams])

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
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{t('title')}</h1>
          <p style={{ fontSize: 14, color: 'var(--muted)' }}>{t('subtitle')}</p>
        </div>
        <Link
          href="/teams/new"
          style={{
            background: 'var(--accent)',
            color: 'white',
            padding: '10px 18px',
            borderRadius: 999,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          {t('newTeam')}
        </Link>
      </div>

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
              fontWeight: 500,
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
      {error && <p style={{ color: 'var(--danger)', fontSize: 14 }}>{t('loadError', { error })}</p>}

      {!loading && !error && teams.length === 0 && (
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

      {!loading && teams.length > 0 && (
        <>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            {t('countLabel', { count })}
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: 16,
            }}
          >
            {teams.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                members={membersByTeam[team.id] ?? []}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
