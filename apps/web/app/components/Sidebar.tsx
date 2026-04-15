// ============================================================
// Sidebar — navigation content
// ============================================================

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'

export interface SidebarProps {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const t = useTranslations('sidebar')
  const pathname = usePathname() ?? '/'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '16px 12px',
      }}
    >
      {/* Brand */}
      <Link
        href="/"
        onClick={onNavigate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '4px 8px',
          marginBottom: 16,
          textDecoration: 'none',
          color: 'var(--foreground)',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent)',
            color: 'white',
            fontSize: 14,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          A
        </div>
        <span
          className="agora-sidebar-label"
          style={{
            fontSize: 15,
            fontWeight: 700,
          }}
        >
          Agora
        </span>
      </Link>

      {/* + New chat CTA */}
      <Link
        href="/rooms/new"
        onClick={onNavigate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          marginBottom: 20,
          borderRadius: 'var(--radius-sm)',
          background: 'rgba(34, 196, 147, 0.12)',
          color: 'var(--accent)',
          textDecoration: 'none',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <span style={{ fontSize: 16 }}>＋</span>
        <span className="agora-sidebar-label">{t('newRoom')}</span>
      </Link>

      {/* Sections */}
      <NavSection label={t('agents.label')}>
        <NavLink
          href="/agents"
          label={t('agents.all')}
          icon="👤"
          active={pathname === '/agents' || pathname.startsWith('/agents/')}
          onNavigate={onNavigate}
        />
        <NavLink
          href="/agents/new"
          label={t('agents.new')}
          icon="＋"
          active={pathname.startsWith('/agents/new')}
          onNavigate={onNavigate}
          subtle
        />
      </NavSection>

      <NavSection label={t('teams.label')}>
        <NavLink
          href="/teams"
          label={t('teams.all')}
          icon="👥"
          active={pathname === '/teams' || pathname.startsWith('/teams/')}
          onNavigate={onNavigate}
        />
        <NavLink
          href="/teams/new"
          label={t('teams.new')}
          icon="＋"
          active={pathname.startsWith('/teams/new')}
          onNavigate={onNavigate}
          subtle
        />
      </NavSection>

      <NavSection label={t('history.label')}>
        <NavLink
          href="/replays"
          label={t('history.replays')}
          icon="⏱"
          active={pathname.startsWith('/replays')}
          onNavigate={onNavigate}
        />
      </NavSection>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      <div
        style={{
          fontSize: 11,
          color: 'var(--muted)',
          textAlign: 'center',
          padding: '8px 0',
        }}
        className="agora-sidebar-label"
      >
        {t('tagline')}
      </div>

      <style jsx global>{`
        @media (max-width: 1023px) and (min-width: 768px) {
          .agora-sidebar-label {
            display: none !important;
          }
          .agora-sidebar a,
          .agora-sidebar > div {
            justify-content: center !important;
          }
        }
      `}</style>
    </div>
  )
}

function NavSection({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        className="agora-sidebar-label"
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--muted)',
          padding: '4px 12px 6px',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>
    </div>
  )
}

function NavLink({
  href,
  label,
  icon,
  active,
  onNavigate,
  subtle = false,
}: {
  href: string
  label: string
  icon: string
  active?: boolean
  onNavigate?: () => void
  subtle?: boolean
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderRadius: 'var(--radius-sm)',
        textDecoration: 'none',
        fontSize: subtle ? 12 : 13,
        fontWeight: subtle ? 400 : 500,
        color: active ? 'var(--foreground)' : subtle ? 'var(--muted)' : 'var(--muted-strong, var(--foreground))',
        background: active ? 'var(--surface-hover)' : 'transparent',
      }}
    >
      <span style={{ width: 18, textAlign: 'center', fontSize: 13 }}>{icon}</span>
      <span className="agora-sidebar-label">{label}</span>
    </Link>
  )
}
