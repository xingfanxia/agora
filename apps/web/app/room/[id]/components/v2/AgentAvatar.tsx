// ============================================================
// AgentAvatar — gradient circle + initial + provider badge
// ============================================================
//
// Phase 5.2 primitive. Used inside AgentSeat (round-table view) and
// the AgentDetailModal header. Colors derive from the shared palette
// (theme.ts) so a given agent's color matches across all room views.

'use client'

import type { AgentColor } from '../theme'

export interface AgentAvatarProps {
  name: string
  /** Provider for the corner badge; omitted = no badge. */
  provider?: string
  /** AgentColor picked by position in the room (createAgentColorMap). */
  color: AgentColor
  /** Total pixel size of the avatar. */
  size?: number
  /** Called when the avatar is clicked; makes the circle cursor: pointer. */
  onClick?: () => void
  /** When true, apply a subtle ring indicating this agent is currently speaking. */
  speaking?: boolean
  /** When true, apply a pulsing dashed ring indicating this agent is thinking. */
  thinking?: boolean
}

// Two-letter provider badge with a fixed color palette so users can
// tell Claude from GPT from Gemini at a glance without needing a real
// logo file (which would add asset dependencies).
const PROVIDER_BADGES: Record<string, { label: string; bg: string; fg: string }> = {
  anthropic: { label: 'A', bg: '#f08754', fg: '#1a1a1a' },
  openai: { label: 'O', bg: '#10a37f', fg: '#ffffff' },
  google: { label: 'G', bg: '#4285f4', fg: '#ffffff' },
  deepseek: { label: 'D', bg: '#6e59f2', fg: '#ffffff' },
  azure: { label: 'Az', bg: '#0078d4', fg: '#ffffff' },
}

function initial(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return trimmed.charAt(0).toUpperCase()
}

export function AgentAvatar({
  name,
  provider,
  color,
  size = 48,
  onClick,
  speaking,
  thinking,
}: AgentAvatarProps) {
  const badge = provider ? PROVIDER_BADGES[provider] : undefined
  const badgeSize = Math.max(16, Math.round(size * 0.36))
  const ring = thinking
    ? `3px dashed ${color.name}`
    : speaking
      ? `3px solid ${color.name}`
      : `2px solid ${color.border}`

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onClick) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      aria-label={`${name}${provider ? ` (${provider})` : ''}`}
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '50%',
        background: `linear-gradient(135deg, ${color.bg} 0%, ${color.border} 100%)`,
        border: ring,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        transition: 'border-color 150ms, transform 150ms',
        animation: thinking ? 'agora-pulse 1.4s ease-in-out infinite' : undefined,
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          fontSize: Math.round(size * 0.45),
          fontWeight: 600,
          color: color.name,
          lineHeight: 1,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {initial(name)}
      </span>
      {badge && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: badgeSize,
            height: badgeSize,
            borderRadius: '50%',
            background: badge.bg,
            color: badge.fg,
            fontSize: Math.round(badgeSize * 0.55),
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid rgba(0,0,0,0.18)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            letterSpacing: badge.label.length > 1 ? '-0.05em' : 0,
          }}
        >
          {badge.label}
        </span>
      )}
    </div>
  )
}
