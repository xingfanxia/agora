'use client'

interface PhaseIndicatorProps {
  /** Current phase identifier — raw from flow controller. */
  phase: string | null
  /** Optional human-readable label map (for werewolf: "wolfDiscuss" → "Wolves conspire"). */
  labelMap?: Record<string, string>
  /** Optional accent color for the phase badge. */
  accent?: string
}

/**
 * Small phase badge — renders `null` when phase is null.
 * Used by state-machine modes (werewolf, script-kill) to signal
 * current stage of the session.
 */
export function PhaseIndicator({ phase, labelMap, accent }: PhaseIndicatorProps) {
  if (!phase) return null
  const label = labelMap?.[phase] ?? phase

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.375rem',
        padding: '0.25rem 0.625rem',
        borderRadius: '999px',
        fontSize: '0.7rem',
        fontWeight: 590,
        letterSpacing: '0.02em',
        textTransform: 'uppercase',
        background: accent ?? 'var(--surface)',
        color: accent ? '#ffffff' : 'var(--foreground)',
        border: `1px solid ${accent ? 'transparent' : 'var(--border)'}`,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: accent ? '#ffffff' : 'var(--accent)',
          opacity: 0.9,
        }}
      />
      {label}
    </span>
  )
}
