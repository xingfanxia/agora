import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { SettingsMenu } from './components/SettingsMenu'

export default async function Home() {
  const t = await getTranslations('landing')
  const tCommon = await getTranslations('common')

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '2rem',
        gap: '3rem',
        position: 'relative',
      }}
    >
      <div style={{ position: 'absolute', top: '1.25rem', right: '1.25rem' }}>
        <SettingsMenu />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1rem',
          maxWidth: '600px',
          textAlign: 'center',
        }}
      >
        <h1
          style={{
            fontSize: '4rem',
            fontWeight: 700,
            letterSpacing: '-0.04em',
            lineHeight: 1,
          }}
        >
          {tCommon('appName')}
        </h1>
        <p
          style={{
            fontSize: '1.25rem',
            color: 'var(--muted)',
            lineHeight: 1.6,
            maxWidth: '520px',
          }}
        >
          {t('tagline')}
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
          maxWidth: '560px',
          width: '100%',
        }}
      >
        <ModeCard
          href="/create"
          title={t('modes.roundtable.title')}
          description={t('modes.roundtable.description')}
          accent="var(--accent)"
        />
        <ModeCard
          href="/create-werewolf"
          title={t('modes.werewolf.title')}
          description={t('modes.werewolf.description')}
          accent="#7f6df2"
        />
      </div>

      <Link
        href="/replays"
        style={{
          fontSize: '0.8rem',
          color: 'var(--muted)',
          textDecoration: 'none',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.2rem',
        }}
      >
        {t('browseReplays')}
      </Link>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.5rem',
          padding: '2rem',
          maxWidth: '640px',
          width: '100%',
        }}
      >
        <p
          style={{
            fontSize: '0.8rem',
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            fontWeight: 500,
          }}
        >
          {t('howItWorks')}
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '1.5rem',
            width: '100%',
          }}
        >
          {(['one', 'two', 'three'] as const).map((key, index) => (
            <div
              key={key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: '0.5rem',
              }}
            >
              <div
                style={{
                  width: '2rem',
                  height: '2rem',
                  borderRadius: '50%',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                }}
              >
                {index + 1}
              </div>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                {t(`steps.${key}.title`)}
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                {t(`steps.${key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ModeCard({
  href,
  title,
  description,
  accent,
}: {
  href: string
  title: string
  description: string
  accent: string
}) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: '1.25rem',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        textDecoration: 'none',
        color: 'var(--foreground)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: accent,
        }}
      />
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.375rem' }}>{title}</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.5 }}>{description}</p>
    </Link>
  )
}
