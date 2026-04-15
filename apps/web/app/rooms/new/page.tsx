// ============================================================
// /rooms/new — unified creator: team → mode → config → start
// ============================================================

'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AgentAvatarPixel } from '../../components/AgentAvatarPixel'
import { getOrCreateUserId } from '../../lib/user-id'

type ModeId = 'open-chat' | 'roundtable' | 'werewolf'

interface Team {
  id: string
  name: string
  description: string | null
  avatarSeed: string
  defaultModeId: string | null
  leaderAgentId: string | null
  isTemplate: boolean
}

interface Member {
  agentId: string
  position: number
  agent: {
    id: string
    name: string
    avatarSeed: string
    modelProvider: string
    modelId: string
  }
}

export default function NewRoomPageWrapper() {
  // useSearchParams requires Suspense boundary in App Router.
  return (
    <Suspense fallback={<LoadingState />}>
      <NewRoomPage />
    </Suspense>
  )
}

function LoadingState() {
  const tCommon = useTranslations('common')
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
      {tCommon('loading')}
    </div>
  )
}

function NewRoomPage() {
  const search = useSearchParams()
  const router = useRouter()
  const t = useTranslations('newRoom')
  const tCommon = useTranslations('common')
  const teamId = search.get('teamId')
  const [team, setTeam] = useState<Team | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<ModeId>('open-chat')
  const [topic, setTopic] = useState('')
  const [rounds, setRounds] = useState(3)
  const [advancedRules, setAdvancedRules] = useState({
    guard: false,
    idiot: false,
    sheriff: false,
    lastWords: false,
  })
  const [language, setLanguage] = useState<'zh' | 'en'>('zh')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getOrCreateUserId()
  }, [])

  useEffect(() => {
    if (!teamId) {
      setLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      const res = await fetch(`/api/teams/${teamId}`)
      if (!res.ok) {
        if (!cancelled) setError(`Team ${teamId} not found`)
        setLoading(false)
        return
      }
      const data = (await res.json()) as { team: Team; members: Member[] }
      if (cancelled) return
      setTeam(data.team)
      setMembers(data.members ?? [])
      if (data.team.defaultModeId) {
        const m = data.team.defaultModeId
        if (m === 'open-chat' || m === 'roundtable' || m === 'werewolf') {
          setMode(m)
        }
      }
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [teamId])

  const modeValid = useMemo(() => {
    if (mode === 'werewolf') {
      return members.length >= 6 && members.length <= 12
    }
    if (mode === 'open-chat') {
      return members.length >= 1 && members.length <= 12 && topic.trim().length > 0
    }
    if (mode === 'roundtable') {
      return members.length >= 2 && members.length <= 8 && topic.trim().length > 0
    }
    return false
  }, [mode, members.length, topic])

  async function start() {
    if (!modeValid || !teamId) return
    setSaving(true)
    setError(null)
    try {
      let url: string
      let body: Record<string, unknown>
      if (mode === 'open-chat') {
        url = '/api/rooms/open-chat'
        body = { teamId, topic: topic.trim(), rounds, language }
      } else if (mode === 'roundtable') {
        url = '/api/rooms'
        body = { teamId, topic: topic.trim(), rounds, language }
      } else {
        url = '/api/rooms/werewolf'
        body = { teamId, advancedRules, language }
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as { roomId: string }
      router.push(`/room/${data.roomId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  if (!teamId) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>{t('pickTeamTitle')}</h1>
        <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24 }}>
          {t('pickTeamSubtitle')}
        </p>
        <Link
          href="/teams"
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
          {t('browseTeams')}
        </Link>
      </div>
    )
  }

  if (loading) return <LoadingState />
  if (!team) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--danger)' }}>
        {error ?? tCommon('loading')}
      </div>
    )
  }

  const modeCards: { id: ModeId; title: string; description: string; allowed: boolean }[] = [
    {
      id: 'open-chat',
      title: t('modes.openChat.title'),
      description: t('modes.openChat.description'),
      allowed: members.length >= 1 && members.length <= 12,
    },
    {
      id: 'roundtable',
      title: t('modes.roundtable.title'),
      description: t('modes.roundtable.description'),
      allowed: members.length >= 2 && members.length <= 8,
    },
    {
      id: 'werewolf',
      title: t('modes.werewolf.title'),
      description: t('modes.werewolf.description'),
      allowed: members.length >= 6 && members.length <= 12,
    },
  ]

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '32px 24px 120px' }}>
      <Link
        href={`/teams/${team.id}`}
        style={{
          color: 'var(--muted)',
          fontSize: 13,
          textDecoration: 'none',
          marginBottom: 16,
          display: 'inline-block',
        }}
      >
        ← {t('backToTeam')}
      </Link>

      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{t('title')}</h1>
      <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24 }}>{t('subtitle')}</p>

      {/* Team preview */}
      <section
        style={{
          padding: 16,
          marginBottom: 24,
          borderRadius: 'var(--radius)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <AgentAvatarPixel seed={team.avatarSeed} size={40} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{team.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {members.length} 位成员
              {team.leaderAgentId && <> · 队长 {members.find((m) => m.agentId === team.leaderAgentId)?.agent.name}</>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {members.map((m) => (
            <div
              key={m.agentId}
              title={m.agent.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px',
                borderRadius: 999,
                background: 'var(--surface-hover)',
                fontSize: 12,
              }}
            >
              <AgentAvatarPixel seed={m.agent.avatarSeed} size={18} />
              <span>{m.agent.name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Mode picker */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{t('pickMode')}</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        {modeCards.map((c) => {
          const selected = mode === c.id
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => c.allowed && setMode(c.id)}
              disabled={!c.allowed}
              style={{
                padding: 16,
                borderRadius: 'var(--radius)',
                background: selected ? 'rgba(34, 196, 147, 0.08)' : 'var(--surface)',
                border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                textAlign: 'left',
                cursor: c.allowed ? 'pointer' : 'not-allowed',
                color: c.allowed ? 'inherit' : 'var(--muted)',
                opacity: c.allowed ? 1 : 0.5,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: selected ? 'var(--accent)' : 'var(--foreground)',
                  marginBottom: 4,
                }}
              >
                {c.title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                {c.description}
              </div>
              {!c.allowed && (
                <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>
                  {t('modes.incompatible', {
                    min:
                      c.id === 'werewolf'
                        ? 6
                        : c.id === 'roundtable'
                          ? 2
                          : 1,
                    max: c.id === 'roundtable' ? 8 : 12,
                  })}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Mode-specific config */}
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{t('configTitle')}</h2>
      <div
        style={{
          padding: 16,
          borderRadius: 'var(--radius)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {(mode === 'open-chat' || mode === 'roundtable') && (
          <>
            <Field label={t('config.topicLabel')}>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={
                  mode === 'open-chat'
                    ? t('config.topicPlaceholderOpenChat')
                    : t('config.topicPlaceholderRoundtable')
                }
                maxLength={500}
                rows={3}
                style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.55 }}
              />
            </Field>
            <Field label={t('config.roundsLabel', { rounds })}>
              <input
                type="range"
                min={1}
                max={mode === 'roundtable' ? 10 : 5}
                step={1}
                value={rounds}
                onChange={(e) => setRounds(parseInt(e.target.value, 10))}
                style={{ width: '100%' }}
              />
            </Field>
          </>
        )}

        {mode === 'werewolf' && (
          <>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55 }}>
              {t('config.werewolfIntro', { playerCount: members.length })}
            </div>
            <Field label={t('config.advancedRules')}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(['guard', 'idiot', 'sheriff', 'lastWords'] as const).map((rule) => (
                  <button
                    key={rule}
                    type="button"
                    onClick={() => setAdvancedRules({ ...advancedRules, [rule]: !advancedRules[rule] })}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 999,
                      background: advancedRules[rule] ? 'rgba(34, 196, 147, 0.08)' : 'var(--surface-hover)',
                      border: `1px solid ${advancedRules[rule] ? 'var(--accent)' : 'var(--border)'}`,
                      color: advancedRules[rule] ? 'var(--accent)' : 'var(--foreground)',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {t(`config.rules.${rule}`)}
                  </button>
                ))}
              </div>
            </Field>
          </>
        )}

        <Field label={t('config.languageLabel')}>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['zh', 'en'] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setLanguage(lang)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${language === lang ? 'var(--accent)' : 'var(--border)'}`,
                  background: language === lang ? 'rgba(34, 196, 147, 0.08)' : 'var(--surface)',
                  color: language === lang ? 'var(--accent)' : 'var(--foreground)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {lang === 'zh' ? '中文' : 'English'}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(220, 53, 69, 0.08)',
            color: 'var(--danger)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
        <Link
          href={`/teams/${team.id}`}
          style={{
            background: 'transparent',
            color: 'var(--muted-strong, var(--muted))',
            border: 'none',
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          {t('cancel')}
        </Link>
        <button
          type="button"
          onClick={start}
          disabled={!modeValid || saving}
          style={{
            background: modeValid && !saving ? 'var(--accent)' : 'var(--surface-hover)',
            color: modeValid && !saving ? 'white' : 'var(--muted)',
            border: 'none',
            padding: '10px 24px',
            borderRadius: 999,
            fontSize: 14,
            fontWeight: 600,
            cursor: modeValid && !saving ? 'pointer' : 'not-allowed',
            minWidth: 140,
          }}
        >
          {saving ? t('starting') : t('start')}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)', marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--foreground)',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}
