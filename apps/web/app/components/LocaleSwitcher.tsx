'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useTransition } from 'react'

type Locale = 'en' | 'zh'

export function LocaleSwitcher() {
  const locale = useLocale() as Locale
  const t = useTranslations('common.locale')
  const [isPending, startTransition] = useTransition()

  function switchTo(next: Locale) {
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

  return (
    <div
      role="group"
      aria-label={t('label')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface)',
        overflow: 'hidden',
        fontSize: '0.75rem',
        opacity: isPending ? 0.6 : 1,
        transition: 'opacity 0.15s',
      }}
    >
      <LocaleButton active={locale === 'en'} onClick={() => switchTo('en')}>
        EN
      </LocaleButton>
      <span style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
      <LocaleButton active={locale === 'zh'} onClick={() => switchTo('zh')}>
        中文
      </LocaleButton>
    </div>
  )
}

function LocaleButton({
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
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '0.35rem 0.65rem',
        border: 'none',
        background: active ? 'var(--foreground)' : 'transparent',
        color: active ? 'var(--background)' : 'var(--muted)',
        cursor: 'pointer',
        fontWeight: active ? 600 : 500,
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {children}
    </button>
  )
}
