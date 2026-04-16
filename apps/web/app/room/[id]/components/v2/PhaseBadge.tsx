// ============================================================
// PhaseBadge — phase + round chip (localized-label aware)
// ============================================================
//
// Phase 5.2. Replaces the legacy PhaseIndicator. Accepts a localized
// label (caller resolves i18n via useTranslations) + a mode-specific
// accent color; stays presentational.

'use client'

export interface PhaseBadgeProps {
  phase: string
  label?: string
  round?: number
  /** Light/dark hint — auto follows prefers-color-scheme via CSS vars. */
  accent?: string
}

export function PhaseBadge({ phase, label, round, accent }: PhaseBadgeProps) {
  const display = label ?? phase
  const accentColor = accent ?? 'var(--accent)'
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        borderRadius: 999,
        background: 'var(--surface)',
        border: `1.5px solid ${accentColor}`,
        color: accentColor,
        fontSize: 13,
        fontWeight: 590,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        boxShadow: 'var(--shadow-sm)',
        letterSpacing: 0.2,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: accentColor,
          animation: 'agora-pulse 2s ease-in-out infinite',
          display: 'inline-block',
        }}
      />
      <span>{display}</span>
      {typeof round === 'number' && (
        <span style={{ opacity: 0.6, fontSize: 11 }}>· round {round}</span>
      )}
    </div>
  )
}
