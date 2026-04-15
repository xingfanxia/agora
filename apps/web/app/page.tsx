'use client'

// ============================================================
// Landing — hero + template gallery + my teams + my agents
// ============================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { SettingsMenu } from './components/SettingsMenu'
import { TeamCard, type TeamCardTeam, type TeamCardMember } from './components/TeamCard'
import { AgentCard, type AgentCardAgent } from './components/AgentCard'
import { getOrCreateUserId } from './lib/user-id'

interface TeamRow extends TeamCardTeam {
  createdBy: string | null
}
interface AgentRow extends AgentCardAgent {
  createdBy: string | null
}

export default function Home() {
  const t = useTranslations('landing')
  const tCommon = useTranslations('common')
  const [templates, setTemplates] = useState<TeamRow[]>([])
  const [templatesMembers, setTemplatesMembers] = useState<Record<string, TeamCardMember[]>>({})
  const [myTeams, setMyTeams] = useState<TeamRow[]>([])
  const [myAgents, setMyAgents] = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getOrCreateUserId()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [tplRes, mineTeamRes, mineAgentRes] = await Promise.all([
          fetch('/api/teams?scope=templates'),
          fetch('/api/teams?scope=mine'),
          fetch('/api/agents?scope=mine'),
        ])
        const tpl = (await tplRes.json()) as { teams: TeamRow[] }
        const mineTeam = (await mineTeamRes.json()) as { teams: TeamRow[] }
        const mineAgent = (await mineAgentRes.json()) as { agents: AgentRow[] }
        if (cancelled) return
        setTemplates(tpl.teams ?? [])
        setMyTeams((mineTeam.teams ?? []).slice(0, 6))
        setMyAgents((mineAgent.agents ?? []).slice(0, 6))

        // Fetch members for the 4 templates (small, fine to serial-fanout)
        const memberResults = await Promise.all(
          (tpl.teams ?? []).map((row) =>
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
        setTemplatesMembers(next)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 24px 80px', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 16, right: 24 }}>
        <SettingsMenu />
      </div>

      {/* Hero */}
      <section style={{ padding: '48px 0 40px', textAlign: 'center' }}>
        <h1
          style={{
            fontSize: 48,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            marginBottom: 16,
            color: 'var(--foreground)',
          }}
        >
          {t('hero.line1')}
        </h1>
        <p
          style={{
            fontSize: 18,
            color: 'var(--muted)',
            lineHeight: 1.55,
            maxWidth: 640,
            margin: '0 auto',
          }}
        >
          {t('hero.subtitle')}
        </p>
        <div style={{ marginTop: 24 }}>
          <Link
            href="/teams"
            style={{
              background: 'var(--accent)',
              color: 'white',
              padding: '12px 24px',
              borderRadius: 999,
              fontSize: 15,
              fontWeight: 600,
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            {t('hero.ctaTemplates')}
          </Link>
        </div>
      </section>

      {/* Templates */}
      <section style={{ marginBottom: 48 }}>
        <SectionHeader title={t('sections.templatesTitle')} subtitle={t('sections.templatesSubtitle')} />
        {loading && <p style={{ color: 'var(--muted)', fontSize: 14 }}>{tCommon('loading')}</p>}
        {!loading && templates.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 16,
            }}
          >
            {templates.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                members={templatesMembers[team.id] ?? []}
              />
            ))}
          </div>
        )}
      </section>

      {/* My teams */}
      <section style={{ marginBottom: 48 }}>
        <SectionHeader
          title={t('sections.myTeamsTitle')}
          subtitle={t('sections.myTeamsSubtitle')}
          action={
            <Link
              href="/teams"
              style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none', fontWeight: 500 }}
            >
              {t('sections.seeAll')} →
            </Link>
          }
        />
        {myTeams.length === 0 ? (
          <EmptyStrip
            message={t('sections.myTeamsEmpty')}
            ctaLabel={t('sections.myTeamsEmptyCta')}
            ctaHref="/teams/new"
          />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 16,
            }}
          >
            {myTeams.map((team) => (
              <TeamCard key={team.id} team={team} />
            ))}
            <Link
              href="/teams/new"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 140,
                borderRadius: 'var(--radius)',
                border: '1px dashed var(--border)',
                color: 'var(--muted)',
                fontSize: 14,
                textDecoration: 'none',
                background: 'var(--surface)',
              }}
            >
              + {t('sections.newTeam')}
            </Link>
          </div>
        )}
      </section>

      {/* My agents */}
      <section style={{ marginBottom: 48 }}>
        <SectionHeader
          title={t('sections.myAgentsTitle')}
          subtitle={t('sections.myAgentsSubtitle')}
          action={
            <Link
              href="/agents"
              style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none', fontWeight: 500 }}
            >
              {t('sections.seeAll')} →
            </Link>
          }
        />
        {myAgents.length === 0 ? (
          <EmptyStrip
            message={t('sections.myAgentsEmpty')}
            ctaLabel={t('sections.myAgentsEmptyCta')}
            ctaHref="/agents/new"
          />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 16,
            }}
          >
            {myAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
            <Link
              href="/agents/new"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 140,
                borderRadius: 'var(--radius)',
                border: '1px dashed var(--border)',
                color: 'var(--muted)',
                fontSize: 14,
                textDecoration: 'none',
                background: 'var(--surface)',
              }}
            >
              + {t('sections.newAgent')}
            </Link>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer style={{ textAlign: 'center', padding: '24px 0', borderTop: '1px solid var(--border)' }}>
        <Link
          href="/replays"
          style={{
            fontSize: 13,
            color: 'var(--muted)',
            textDecoration: 'none',
          }}
        >
          {t('browseReplays')} →
        </Link>
      </footer>
    </div>
  )
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: 16,
      }}
    >
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: subtitle ? 2 : 0 }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

function EmptyStrip({
  message,
  ctaLabel,
  ctaHref,
}: {
  message: string
  ctaLabel: string
  ctaHref: string
}) {
  return (
    <div
      style={{
        padding: '32px 24px',
        borderRadius: 'var(--radius)',
        border: '1px dashed var(--border)',
        background: 'var(--surface)',
        textAlign: 'center',
      }}
    >
      <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 12 }}>{message}</p>
      <Link
        href={ctaHref}
        style={{
          display: 'inline-block',
          padding: '8px 18px',
          borderRadius: 999,
          background: 'var(--accent)',
          color: 'white',
          fontSize: 13,
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        {ctaLabel}
      </Link>
    </div>
  )
}
