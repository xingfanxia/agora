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
        // Phase 4.5c perf: templates+members in ONE request (previously 5).
        // CDN-cached for 5min; 'mine' scopes are not cacheable (per-user).
        const [tplRes, mineTeamRes, mineAgentRes] = await Promise.all([
          fetch('/api/teams?scope=templates&include=members'),
          fetch('/api/teams?scope=mine'),
          fetch('/api/agents?scope=mine'),
        ])
        type TemplateWithMembers = {
          team: TeamRow
          members: Array<{ agentId: string; agent: { avatarSeed: string; name: string } }>
        }
        const tpl = (await tplRes.json()) as { teams: TemplateWithMembers[] }
        const mineTeam = (await mineTeamRes.json()) as { teams: TeamRow[] }
        const mineAgent = (await mineAgentRes.json()) as { agents: AgentRow[] }
        if (cancelled) return
        const templateRows = (tpl.teams ?? []).map((t) => t.team)
        setTemplates(templateRows)
        setMyTeams((mineTeam.teams ?? []).slice(0, 6))
        setMyAgents((mineAgent.agents ?? []).slice(0, 6))

        // Members already arrived with the templates — no fan-out needed.
        const next: Record<string, TeamCardMember[]> = {}
        for (const row of tpl.teams ?? []) {
          next[row.team.id] = row.members.map((m) => ({
            agentId: m.agentId,
            avatarSeed: m.agent.avatarSeed,
            name: m.agent.name,
          }))
        }
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
      <section className="agora-hero" style={{ padding: '56px 0 48px', textAlign: 'center' }}>
        <h1
          style={{
            fontSize: 48,
            fontWeight: 510,
            letterSpacing: '-1.056px',
            lineHeight: 1.0,
            marginBottom: 20,
            color: 'var(--foreground)',
          }}
        >
          {t('hero.line1')}
        </h1>
        <p
          style={{
            fontSize: 18,
            fontWeight: 400,
            letterSpacing: '-0.165px',
            color: 'var(--muted)',
            lineHeight: 1.6,
            maxWidth: 640,
            margin: '0 auto',
          }}
        >
          {t('hero.subtitle')}
        </p>
        <div style={{ marginTop: 28 }}>
          <Link
            href="/teams"
            style={{
              background: 'var(--accent-strong)',
              color: '#ffffff',
              padding: '10px 20px',
              borderRadius: 'var(--radius-card)',
              fontSize: 15,
              fontWeight: 590,
              letterSpacing: '-0.165px',
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
              style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none', fontWeight: 510 }}
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
              style={{ color: 'var(--accent)', fontSize: 13, textDecoration: 'none', fontWeight: 510 }}
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
        <h2
          style={{
            fontSize: 20,
            fontWeight: 590,
            letterSpacing: '-0.24px',
            lineHeight: 1.33,
            marginBottom: subtitle ? 2 : 0,
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <p
            style={{
              fontSize: 13,
              fontWeight: 400,
              letterSpacing: '-0.13px',
              color: 'var(--muted)',
              margin: 0,
            }}
          >
            {subtitle}
          </p>
        )}
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
        padding: '28px 24px',
        borderRadius: 'var(--radius-card)',
        border: '1px dashed var(--border)',
        background: 'rgba(255, 255, 255, 0.02)',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          fontSize: 14,
          fontWeight: 400,
          letterSpacing: '-0.13px',
          color: 'var(--muted)',
          marginBottom: 12,
        }}
      >
        {message}
      </p>
      <Link
        href={ctaHref}
        style={{
          display: 'inline-block',
          padding: '8px 16px',
          borderRadius: 'var(--radius)',
          background: 'var(--accent-strong)',
          color: '#ffffff',
          fontSize: 13,
          fontWeight: 590,
          letterSpacing: '-0.13px',
          textDecoration: 'none',
        }}
      >
        {ctaLabel}
      </Link>
    </div>
  )
}
