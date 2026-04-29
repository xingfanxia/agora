// ============================================================
// AgentSeat — one seat at the round table: avatar + bubble + label
// ============================================================
//
// Phase 5.2. Positioned absolutely by RoundTable via CSS transforms.
// Composes AgentAvatar + Bubble. Click opens AgentDetailModal (wired
// by parent via `onClick`).

'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { AgentAvatar } from './AgentAvatar'
import { Bubble, type BubbleMode } from './Bubble'
import { SeatPresenceIndicator } from '../SeatPresenceIndicator'
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
  /**
   * Phase 4.5d-3 — Postgres-truth liveness timestamp for this seat.
   * Wired in by `WerewolfView` / `RoundtableView` from `usePresenceMap`.
   * `null`/absent → never heartbeated. AI seats pass `isHuman={false}`
   * and the indicator renders as a muted dot regardless of timestamp.
   */
  lastSeenAt?: string | null
  /** Phase 4.5d-3 — true for human-controlled seats (multi-human rooms). */
  isHuman?: boolean
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
  lastSeenAt,
  isHuman = false,
  avatarSize = 56,
  onClick,
}: AgentSeatProps) {
  const tPresence = useTranslations('room.presence')
  // Stabilize the labels bag — `tPresence` is stable per-locale, so this
  // memoizes once. Otherwise SeatPresenceIndicator would see a new
  // `labels` object on every parent render (e.g. every 5s as
  // presenceMap updates), defeating its prop-equality fast paths.
  const presenceLabels = useMemo(
    () => ({
      online: tPresence('online'),
      reconnecting: tPresence('reconnecting'),
      disconnected: tPresence('disconnected'),
      neverSeen: tPresence('neverSeen'),
      aiSeat: tPresence('aiSeat'),
    }),
    [tPresence],
  )

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
        {/* Phase 4.5d-3: presence dot inline-left of the name. Only
            rendered for human seats — AI seats are always "available" so
            the muted dot would just be visual noise on a 7-AI lineup.
            Hidden once a seat is eliminated (the strikethrough already
            communicates "out of game" — a status dot is misleading). */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            lineHeight: 1.2,
          }}
        >
          {isHuman && !eliminated && (
            <SeatPresenceIndicator
              lastSeenAt={lastSeenAt ?? null}
              isHuman
              labels={presenceLabels}
            />
          )}
          <span
            style={{
              fontSize: 12,
              fontWeight: 590,
              color: color.name,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              textAlign: 'center',
              textDecoration: eliminated ? 'line-through' : 'none',
            }}
          >
            {name}
          </span>
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
