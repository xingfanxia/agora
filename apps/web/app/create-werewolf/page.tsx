'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { SettingsMenu } from '../components/SettingsMenu'

const DEFAULT_NAMES = [
  'Elena',
  'Marcus',
  'Yuki',
  'Dmitri',
  'Zara',
  'Kai',
  'Luna',
  'Felix',
  'Nora',
  'Oscar',
  'Ivy',
  'Ravi',
]

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic' as const },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic' as const },
  { value: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai' as const },
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', provider: 'google' as const },
]

/** Rotate claude/gpt/gemini across positions to get diverse reasoning styles. */
function defaultModelFor(index: number): string {
  const rotation = ['claude-opus-4-6', 'gpt-5.4', 'gemini-3.1-pro-preview']
  return rotation[index % rotation.length]!
}

interface PlayerFormData {
  id: string
  name: string
  model: string
}

export default function CreateWerewolf() {
  const router = useRouter()
  const t = useTranslations('werewolf')
  const tCommon = useTranslations('common')
  const [playerCount, setPlayerCount] = useState(9)
  const [players, setPlayers] = useState<PlayerFormData[]>(() =>
    DEFAULT_NAMES.slice(0, 9).map((name, i) => ({
      id: crypto.randomUUID(),
      name,
      model: defaultModelFor(i),
    })),
  )
  const [advancedRules, setAdvancedRules] = useState({
    guard: false,
    idiot: false,
    sheriff: false,
    lastWords: false,
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resizePlayerList(newCount: number) {
    setPlayerCount(newCount)
    setPlayers((prev) => {
      if (newCount > prev.length) {
        // Add players
        const next = [...prev]
        for (let i = prev.length; i < newCount; i++) {
          next.push({
            id: crypto.randomUUID(),
            name: DEFAULT_NAMES[i] ?? `Player${i + 1}`,
            model: defaultModelFor(i),
          })
        }
        return next
      }
      // Shrink list
      return prev.slice(0, newCount)
    })
  }

  function updatePlayer(id: string, field: keyof PlayerFormData, value: string) {
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    for (const p of players) {
      if (!p.name.trim()) {
        setError(t('errors.namesRequired'))
        return
      }
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/rooms/werewolf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          players: players.map((p) => {
            const opt = MODEL_OPTIONS.find((m) => m.value === p.model)
            return {
              name: p.name.trim(),
              model: p.model,
              provider: opt?.provider,
            }
          }),
          advancedRules,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || t('errors.generic'))
      }

      const data = await response.json()
      router.push(`/room/${data.roomId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
      setIsSubmitting(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', padding: '2rem', maxWidth: '820px', margin: '0 auto', position: 'relative' }}>
      <div style={{ position: 'absolute', top: '1.25rem', right: '1.25rem' }}>
        <SettingsMenu />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', paddingTop: '1rem' }}>
        <Link href="/" style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
          {tCommon('appName')}
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{t('breadcrumb')}</span>
      </div>

      <h1
        style={{
          fontSize: '2rem',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          marginBottom: '0.5rem',
        }}
      >
        {t('title')}
      </h1>
      <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2.5rem' }}>
        {t('description')}
      </p>

      <form onSubmit={handleSubmit}>
        {/* Player count slider */}
        <FieldLabel>{t('playerCountLabel', { count: playerCount })}</FieldLabel>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
          {[6, 7, 8, 9, 10, 11, 12].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => resizePlayerList(n)}
              style={{
                width: '3rem',
                height: '3rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid',
                borderColor: playerCount === n ? 'var(--accent)' : 'var(--border)',
                background: playerCount === n ? 'var(--accent)' : 'var(--surface)',
                color: playerCount === n ? '#ffffff' : 'var(--foreground)',
                fontSize: '1rem',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Advanced rules */}
        <FieldLabel>{t('advancedRulesLabel')}</FieldLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '2rem' }}>
          {(['guard', 'idiot', 'sheriff', 'lastWords'] as const).map((key) => {
            const active = advancedRules[key]
            return (
              <button
                key={key}
                type="button"
                onClick={() => setAdvancedRules((prev) => ({ ...prev, [key]: !prev[key] }))}
                style={{
                  padding: '0.5rem 0.875rem',
                  borderRadius: '999px',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'var(--accent)' : 'var(--surface)',
                  color: active ? '#ffffff' : 'var(--foreground)',
                  fontSize: '0.8rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {t(`rules.${key}`)}
              </button>
            )
          })}
        </div>

        {/* Players */}
        <FieldLabel>{t('playersLabel')}</FieldLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginBottom: '2rem' }}>
          {players.map((p, i) => (
            <div
              key={p.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '2rem 1fr 180px',
                gap: '0.625rem',
                alignItems: 'center',
                padding: '0.625rem 0.75rem',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <span style={{ color: 'var(--muted)', fontSize: '0.75rem', fontWeight: 600, textAlign: 'center' }}>
                {i + 1}
              </span>
              <input
                type="text"
                value={p.name}
                onChange={(e) => updatePlayer(p.id, 'name', e.target.value)}
                placeholder={t('playerPlaceholder', { index: i + 1 })}
                style={{
                  padding: '0.5rem 0.625rem',
                  fontSize: '0.875rem',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
                  outline: 'none',
                }}
              />
              <select
                value={p.model}
                onChange={(e) => updatePlayer(p.id, 'model', e.target.value)}
                style={{
                  padding: '0.5rem 0.625rem',
                  fontSize: '0.875rem',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  background: 'var(--background)',
                  color: 'var(--foreground)',
                  outline: 'none',
                }}
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        {error && (
          <div
            style={{
              padding: '0.75rem 1rem',
              marginBottom: '1.5rem',
              borderRadius: 'var(--radius-sm)',
              background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
              color: 'var(--danger)',
              fontSize: '0.875rem',
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            width: '100%',
            padding: '0.875rem',
            fontSize: '1rem',
            fontWeight: 600,
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            background: isSubmitting ? 'var(--muted)' : 'var(--foreground)',
            color: 'var(--background)',
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
            opacity: isSubmitting ? 0.7 : 1,
          }}
        >
          {isSubmitting ? t('submitStarting') : t('submit')}
        </button>
      </form>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '0.8rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--muted)',
        marginBottom: '0.75rem',
      }}
    >
      {children}
    </div>
  )
}
