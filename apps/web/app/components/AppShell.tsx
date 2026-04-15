// ============================================================
// AppShell — persistent left sidebar + main content area
// ============================================================
//
// Responsive breakpoints (media queries on the shell's root):
//   ≥1024px  — 220px fixed sidebar, always visible
//   768-1023 — 56px icon rail
//   <768     — off-canvas drawer, toggled via hamburger
//
// Certain routes (game/replay) want full viewport so they read their
// own page.tsx and opt out of the shell by returning null from
// useShowAppShell(pathname). We render the shell unconditionally and
// let child routes decide their own padding.

'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from './Sidebar'

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Room / replay views want edge-to-edge space — hide the rail too.
  const isImmersive = pathname?.startsWith('/room/') || pathname?.startsWith('/replay/')

  if (isImmersive) {
    return <div>{children}</div>
  }

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--background)',
      }}
    >
      {/* Mobile hamburger (visible < 768px) */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        style={{
          position: 'fixed',
          top: 12,
          left: 12,
          zIndex: 30,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 10px',
          cursor: 'pointer',
          fontSize: 14,
          display: 'none',
        }}
        className="agora-mobile-hamburger"
      >
        ☰
      </button>

      {/* Backdrop for mobile drawer */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.4)',
            zIndex: 40,
          }}
          className="agora-mobile-backdrop"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`agora-sidebar ${mobileOpen ? 'agora-sidebar-open' : ''}`}
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'var(--surface)',
          position: 'sticky',
          top: 0,
          alignSelf: 'flex-start',
          height: '100vh',
          overflow: 'auto',
          zIndex: 50,
        }}
      >
        <Sidebar onNavigate={() => setMobileOpen(false)} />
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, minWidth: 0 }}>{children}</main>

      <style jsx global>{`
        @media (max-width: 1023px) {
          .agora-sidebar {
            width: 56px !important;
          }
        }
        @media (max-width: 767px) {
          .agora-mobile-hamburger {
            display: block !important;
          }
          .agora-sidebar {
            position: fixed !important;
            top: 0;
            left: 0;
            height: 100vh !important;
            width: 240px !important;
            transform: translateX(-100%);
            transition: transform 0.25s ease;
            z-index: 50;
          }
          .agora-sidebar-open {
            transform: translateX(0) !important;
          }
        }
      `}</style>
    </div>
  )
}
