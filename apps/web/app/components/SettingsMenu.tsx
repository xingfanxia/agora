'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'

type Locale = 'en' | 'zh'
type AgentPref = 'auto' | 'en' | 'zh'

const AGENT_LANG_COOKIE = 'agora-agent-lang'

function readAgentPref(): AgentPref {
  if (typeof document === 'undefined') return 'auto'
  const match = document.cookie.match(new RegExp(`(^|; )${AGENT_LANG_COOKIE}=([^;]+)`))
  const v = match?.[2]
  if (v === 'en' || v === 'zh') return v
  return 'auto'
}

export function SettingsMenu() {
  const locale = useLocale() as Locale
  const t = useTranslations('common.settings')
  const [open, setOpen] = useState(false)
  const [agentPref, setAgentPref] = useState<AgentPref>('auto')
  const [isPending, startTransition] = useTransition()
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setAgentPref(readAgentPref())
  }, [])

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function switchUiLocale(next: Locale) {
    if (next === locale || isPending) return
    startTransition(async () => {
      await fetch('/api/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: next }),
      })
      window.location.reload()
    })
  }

  function switchAgentPref(next: AgentPref) {
    if (next === agentPref || isPending) return
    startTransition(async () => {
      await fetch('/api/agent-language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: next }),
      })
      setAgentPref(next)
    })
  }

  const label = locale === 'zh' ? '中文' : 'EN'

  return (
    <div ref={popRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: '0.4rem 0.7rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--surface)',
          color: 'var(--foreground)',
          fontSize: '0.75rem',
          fontWeight: 500,
          cursor: 'pointer',
          opacity: isPending ? 0.6 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        <span>{label}</span>
        <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>▾</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('title')}
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.5rem)',
            right: 0,
            width: 240,
            padding: '0.9rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--surface)',
            boxShadow: '0 10px 32px rgba(0,0,0,0.12)',
            zIndex: 50,
            fontSize: '0.8rem',
            color: 'var(--foreground)',
          }}
        >
          <Section label={t('uiLanguage')}>
            <Pill active={locale === 'en'} onClick={() => switchUiLocale('en')}>
              EN
            </Pill>
            <Pill active={locale === 'zh'} onClick={() => switchUiLocale('zh')}>
              中文
            </Pill>
          </Section>

          <div style={{ height: '0.75rem' }} />

          <Section label={t('agentLanguage')}>
            <Pill active={agentPref === 'auto'} onClick={() => switchAgentPref('auto')}>
              {t('followUi')}
            </Pill>
            <Pill active={agentPref === 'en'} onClick={() => switchAgentPref('en')}>
              EN
            </Pill>
            <Pill active={agentPref === 'zh'} onClick={() => switchAgentPref('zh')}>
              中文
            </Pill>
          </Section>

          <p
            style={{
              marginTop: '0.75rem',
              fontSize: '0.65rem',
              color: 'var(--muted)',
              lineHeight: 1.4,
            }}
          >
            {t('hint')}
          </p>
        </div>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: '0.65rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--muted)',
          marginBottom: '0.4rem',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>{children}</div>
    </div>
  )
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        padding: '0.3rem 0.6rem',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '999px',
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : 'var(--foreground)',
        fontSize: '0.7rem',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  )
}
