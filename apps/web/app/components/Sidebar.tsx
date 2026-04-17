// ============================================================
// Sidebar — navigation content (Linear-spec per DESIGN.md §4)
// ============================================================

'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { supabaseBrowser } from '../lib/supabase-browser'
import type { Session } from '@supabase/supabase-js'

export interface SidebarProps {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const t = useTranslations('sidebar')
  const pathname = usePathname() ?? '/'
  const router = useRouter()
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    const supabase = supabaseBrowser()
    // Initial read — getSession is cookie-only, no round-trip.
    // Authorization decisions happen server-side via getUser().
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      setUserEmail(data.session?.user.email ?? null)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
      setUserEmail(session?.user.email ?? null)
      setAuthReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function signOut() {
    const supabase = supabaseBrowser()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

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
            background: 'var(--accent-strong)',
            color: '#ffffff',
            fontSize: 14,
            fontWeight: 590,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            letterSpacing: '-0.2px',
          }}
        >
          A
        </div>
        <span
          className="agora-sidebar-label"
          style={{
            fontSize: 15,
            fontWeight: 590,
            letterSpacing: '-0.2px',
          }}
        >
          Agora
        </span>
      </Link>

      {/* + New chat CTA — primary mint button (dark text for WCAG AA) */}
      <Link
        href="/rooms/new"
        onClick={onNavigate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 12px',
          marginBottom: 20,
          borderRadius: 'var(--radius)',
          background: 'var(--accent-strong)',
          color: '#ffffff',
          textDecoration: 'none',
          fontSize: 13,
          fontWeight: 590,
          letterSpacing: '-0.13px',
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>＋</span>
        <span className="agora-sidebar-label">{t('newRoom')}</span>
      </Link>

      {/* Sections */}
      <NavSection label={t('agents.label')}>
        <NavLink
          href="/agents"
          label={t('agents.all')}
          icon="👤"
          active={isActiveParent(pathname, '/agents', ['/agents/new'])}
          onNavigate={onNavigate}
        />
        <NavLink
          href="/agents/new"
          label={t('agents.new')}
          icon="＋"
          active={pathname === '/agents/new' || pathname.startsWith('/agents/new/')}
          onNavigate={onNavigate}
          subtle
        />
      </NavSection>

      <NavSection label={t('teams.label')}>
        <NavLink
          href="/teams"
          label={t('teams.all')}
          icon="👥"
          active={isActiveParent(pathname, '/teams', ['/teams/new'])}
          onNavigate={onNavigate}
        />
        <NavLink
          href="/teams/new"
          label={t('teams.new')}
          icon="＋"
          active={pathname === '/teams/new' || pathname.startsWith('/teams/new/')}
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

      {/* Auth footer — only render after first auth read to avoid flash */}
      {authReady && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: '10px 8px 4px',
            marginBottom: 4,
          }}
        >
          {userEmail ? (
            <div
              className="agora-sidebar-label"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
              }}
            >
              <div
                title={userEmail}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'var(--accent-strong)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 590,
                  textTransform: 'uppercase',
                  flexShrink: 0,
                }}
              >
                {userEmail.charAt(0)}
              </div>
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--foreground-secondary)',
                }}
              >
                {userEmail}
              </span>
              <button
                type="button"
                onClick={signOut}
                aria-label="Sign out"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: 4,
                }}
              >
                ↪
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              onClick={onNavigate}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 'var(--radius-sm)',
                textDecoration: 'none',
                fontSize: 13,
                fontWeight: 510,
                color: 'var(--foreground-secondary)',
              }}
            >
              <span style={{ width: 18, textAlign: 'center', fontSize: 13 }}>↪</span>
              <span className="agora-sidebar-label">{t('signIn')}</span>
            </Link>
          )}
        </div>
      )}

      <div
        style={{
          fontSize: 11,
          color: 'var(--muted-strong)',
          textAlign: 'center',
          padding: '8px 0',
          letterSpacing: '0.02em',
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

function isActiveParent(
  pathname: string,
  base: string,
  excludePrefixes: readonly string[],
): boolean {
  if (pathname === base) return true
  if (!pathname.startsWith(base + '/')) return false
  return !excludePrefixes.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
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
    <div style={{ marginBottom: 18 }}>
      <div
        className="agora-sidebar-label"
        style={{
          fontSize: 11,
          fontWeight: 590,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--muted-strong)',
          padding: '4px 12px 8px',
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>{children}</div>
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
        padding: '7px 12px',
        borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
        marginLeft: -3,
        paddingLeft: 9,
        borderRadius: `0 var(--radius) var(--radius) 0`,
        textDecoration: 'none',
        fontSize: subtle ? 13 : 14,
        fontWeight: subtle ? 400 : 510,
        letterSpacing: '-0.13px',
        color: active
          ? 'var(--accent-bright)'
          : subtle
          ? 'var(--muted)'
          : 'var(--foreground-secondary)',
        background: active ? 'var(--accent-tint)' : 'transparent',
        transition: 'background 0.1s ease, color 0.1s ease',
      }}
    >
      <span style={{ width: 18, textAlign: 'center', fontSize: 13, flexShrink: 0 }}>{icon}</span>
      <span className="agora-sidebar-label">{label}</span>
    </Link>
  )
}
