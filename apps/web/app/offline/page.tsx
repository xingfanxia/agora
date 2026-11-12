// Offline notice. proxy.ts rewrites every page here while the offline
// switch is on (app/lib/offline.ts). Renders from i18n messages only —
// no database, provider or env var is read.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { isOffline } from '../lib/offline'

const SOURCE_URL = 'https://github.com/xingfanxia/agora'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('offline')
  return { title: t('metaTitle'), robots: { index: false, follow: true } }
}

export default async function OfflinePage() {
  if (!isOffline()) notFound()
  const t = await getTranslations('offline')

  return (
    <main
      data-testid="offline-notice"
      style={{
        minHeight: '100svh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        background: 'var(--background)',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: 480,
          padding: '32px 28px',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-panel)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div
          aria-hidden
          style={{ width: 28, height: 3, borderRadius: 2, background: 'var(--accent)', marginBottom: 20 }}
        />
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 590, color: 'var(--foreground)', letterSpacing: '-0.02em' }}>
          {t('title')}
        </h1>
        <p style={{ margin: '10px 0 0', fontSize: 15, lineHeight: 1.6, color: 'var(--foreground-secondary)' }}>
          {t('what')}
        </p>
        <p style={{ margin: '24px 0 0', fontSize: 15, fontWeight: 590, color: 'var(--foreground)' }}>{t('status')}</p>
        <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.6, color: 'var(--muted)' }}>{t('body')}</p>
        <a
          href={SOURCE_URL}
          data-testid="offline-source-link"
          style={{
            display: 'inline-block',
            marginTop: 24,
            padding: '8px 14px',
            borderRadius: 'var(--radius)',
            background: 'var(--accent-strong)',
            color: '#ffffff',
            fontSize: 14,
            fontWeight: 510,
            textDecoration: 'none',
          }}
        >
          {t('source')} →
        </a>
      </section>
    </main>
  )
}
