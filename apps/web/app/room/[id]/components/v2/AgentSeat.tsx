// ============================================================
// AgentSeat — one seat at the round table: avatar + bubble + label
// ============================================================
//
// Phase 5.2. Positioned absolutely by RoundTable via CSS transforms.
// Composes AgentAvatar + Bubble. Click opens AgentDetailModal (wired
// by parent via `onClick`).

'use client'

import { AgentAvatar } from './AgentAvatar'
import { Bubble, type BubbleMode } from './Bubble'
import type { AgentColor } from '../theme'

export interface AgentSeatProps {
  agentId: string
  name: string
  provider?: string
  color: AgentColor
  /** Latest message from this agent (for bubble content). */
  latestMessage?: { id: string; content: string }
  /** Is this agent currently being polled for a reply? */
  thinking?: boolean
  /** Did this agent just speak in the active phase? */
  speaking?: boolean
  /** Werewolf role badge, if any (e.g. 'seer', 'werewolf'). */
  role?: string
  /** Is this agent dead/eliminated? */
  eliminated?: boolean
  avatarSize?: number
  onClick?: (agentId: string) => void
}

const ROLE_EMOJI: Record<string, string> = {
  werewolf: '🐺',
  villager: '👤',
  seer: '🔮',
  witch: '🧪',
  hunter: '🎯',
  guard: '🛡️',
  idiot: '🤡',
}

export function AgentSeat({
  agentId,
  name,
  provider,
  color,
  latestMessage,
  thinking,
  speaking,
  role,
  eliminated,
  avatarSize = 56,
  onClick,
}: AgentSeatProps) {
  const bubbleMode: BubbleMode = thinking
    ? 'thinking'
    : latestMessage
      ? 'speaking'
      : 'idle'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        opacity: eliminated ? 0.4 : 1,
        filter: eliminated ? 'grayscale(80%)' : 'none',
        transition: 'opacity 250ms, filter 250ms',
      }}
    >
      {/* Bubble stacked ABOVE the avatar. Keyed by message id so a new
          message remounts the component and fires the bubble-in anim.
          Click forwards to the seat's onClick (opens the detail modal
          with full message content — never expand in-place). */}
      {bubbleMode !== 'idle' && (
        <div
          key={latestMessage?.id ?? 'thinking'}
          style={{ marginBottom: 8 }}
        >
          <Bubble
            mode={bubbleMode}
            text={latestMessage?.content}
            color={color}
            onClick={onClick ? () => onClick(agentId) : undefined}
          />
        </div>
      )}

      <AgentAvatar
        name={name}
        provider={provider}
        color={color}
        size={avatarSize}
        speaking={speaking}
        thinking={thinking}
        onClick={onClick ? () => onClick(agentId) : undefined}
      />

      {/* Name + role chip */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          maxWidth: avatarSize + 40,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 590,
            color: color.name,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            textAlign: 'center',
            lineHeight: 1.2,
            textDecoration: eliminated ? 'line-through' : 'none',
          }}
        >
          {name}
        </span>
        {role && (
          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 8,
              background: color.border,
              color: color.name,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              lineHeight: 1.3,
            }}
          >
            {ROLE_EMOJI[role] ?? ''} {role}
          </span>
        )}
      </div>
    </div>
  )
}
