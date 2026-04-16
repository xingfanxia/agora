// ============================================================
// AgentCard — grid card for the /agents list + team composer
// ============================================================

'use client'

import Link from 'next/link'
import { AgentAvatarPixel } from './AgentAvatarPixel'

export interface AgentCardAgent {
  id: string
  name: string
  persona: string
  modelProvider: string
  modelId: string
  avatarSeed: string
  isTemplate: boolean
}

export interface AgentCardProps {
  agent: AgentCardAgent
  /** Optional click handler. When provided, renders as a button. Otherwise links to /agents/[id]. */
  onClick?: (agent: AgentCardAgent) => void
  /** Optional CTA at bottom-right ("+ 添加" etc.). Supplying it renders a secondary action row. */
  actionLabel?: string
  onAction?: (agent: AgentCardAgent) => void
  /** Visually dimmed when true (e.g. already in composer). */
  disabled?: boolean
  /** When true, the action row is hidden and the card acts as a non-interactive preview. */
  readOnly?: boolean
}

const PROVIDER_BADGE: Record<string, { short: string; color: string }> = {
  anthropic: { short: 'A', color: '#d97757' },
  openai: { short: 'O', color: '#10a37f' },
  google: { short: 'G', color: '#4285f4' },
  deepseek: { short: 'D', color: '#555' },
}

function providerBadgeFor(provider: string) {
  return PROVIDER_BADGE[provider] ?? { short: provider.charAt(0).toUpperCase(), color: '#777' }
}

function truncate(text: string, max = 120): string {
  if (text.length <= max) return text
  return text.slice(0, max).trimEnd() + '…'
}

export function AgentCard({
  agent,
  onClick,
  actionLabel,
  onAction,
  disabled = false,
  readOnly = false,
}: AgentCardProps) {
  const badge = providerBadgeFor(agent.modelProvider)
  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <AgentAvatarPixel seed={agent.avatarSeed} size={52} />
          <div
            title={agent.modelProvider}
            style={{
              position: 'absolute',
              right: -2,
              bottom: -2,
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: badge.color,
              color: 'white',
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid var(--background)',
            }}
          >
            {badge.short}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 510,
              fontSize: 16,
              letterSpacing: '-0.165px',
              color: 'var(--foreground)',
              marginBottom: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {agent.name}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 400,
              color: 'var(--muted)',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.13px',
            }}
          >
            {agent.modelId}
            {agent.isTemplate ? ' · 模板' : ''}
          </div>
        </div>
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          letterSpacing: '-0.13px',
          color: 'var(--foreground-secondary)',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: 60,
        }}
      >
        {truncate(agent.persona, 200)}
      </div>
      {!readOnly && actionLabel && onAction && (
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onAction(agent)
            }}
            disabled={disabled}
            style={{
              background: disabled ? 'rgba(255,255,255,0.04)' : 'var(--accent)',
              color: disabled ? 'var(--muted)' : '#ffffff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 'var(--radius)',
              fontSize: 12,
              fontWeight: 590,
              letterSpacing: '-0.12px',
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {actionLabel}
          </button>
        </div>
      )}
    </>
  )

  const cardStyle: React.CSSProperties = {
    display: 'block',
    padding: 16,
    borderRadius: 'var(--radius-card)',
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid var(--border)',
    transition: 'background .15s ease, border-color .15s ease',
    textDecoration: 'none',
    color: 'inherit',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : onClick || !readOnly ? 'pointer' : 'default',
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => !disabled && onClick(agent)}
        style={{ ...cardStyle, textAlign: 'left', width: '100%' }}
      >
        {body}
      </button>
    )
  }

  if (readOnly) {
    return <div style={cardStyle}>{body}</div>
  }

  return (
    <Link href={`/agents/${agent.id}`} style={cardStyle}>
      {body}
    </Link>
  )
}
