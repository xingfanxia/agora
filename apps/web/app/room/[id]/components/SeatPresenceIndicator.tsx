'use client'

// ============================================================
// SeatPresenceIndicator (Phase 4.5d-1)
// ============================================================
//
// Per-seat liveness dot. Three states for human seats:
//
//   green  — last_seen within grace window (30s) → "Online"
//   amber  — within grace × 2 (30-60s) → "Reconnecting…"
//   red    — beyond 60s OR never heartbeated → "Disconnected"
//
// AI seats render a muted dot — they don't have a heartbeat by
// design. Including the dot anyway keeps row layout consistent
// across mixed AI+human tables.
//
// `now` is injected for testability (matches the discipline in
// lib/presence.ts). Pure presentational; takes timestamp + flag,
// no data fetching.
//
// Production caller (Phase 4.5d-3): `AgentSeat` (in v2/) renders this
// inline-left of the seat name when `isHuman && !eliminated`. The
// `lastSeenAt` value flows from `usePresenceMap(roomId)` in the
// containing mode view (WerewolfView / RoundtableView) through
// `RoundTableAgent` props. Localized labels come from
// `useTranslations('room.presence')` resolved in `AgentSeat`.
//
// `AgentList` (the v1 horizontal pill strip) also accepts the
// indicator via its `renderExtra` slot — kept as a documented escape
// hatch for any future caller that doesn't use the v2 RoundTable
// layout.

import type { CSSProperties } from 'react'

const GREEN_GRACE_MS = 30_000 // matches PRESENCE_GRACE_MS in lib/presence.ts
const AMBER_GRACE_MS = 60_000 // 2× green = give the user one full retry window

/**
 * Localized strings for each presence state. When omitted, the
 * component falls back to English defaults — kept so the component
 * works in isolation (Storybook, unit tests) without dragging
 * next-intl in. Production callers (e.g. `AgentSeat`) pass resolved
 * `useTranslations('room.presence')` strings.
 */
export interface SeatPresenceLabels {
  online?: string
  reconnecting?: string
  disconnected?: string
  neverSeen?: string
  aiSeat?: string
}

export interface SeatPresenceIndicatorProps {
  /**
   * ISO timestamp or Date of last heartbeat. null → never seen.
   * AI seats should always pass null (or omit the indicator).
   */
  lastSeenAt: string | Date | null

  /**
   * Only human seats heartbeat. AI seats render a muted dot.
   */
  isHuman: boolean

  /**
   * Time reference for color thresholds. Defaults to wall-clock.
   * Tests inject a fixed value.
   */
  now?: number

  /**
   * Optional override for the title/aria-label. Wins over `labels`
   * when both are present — useful for one-off custom text.
   */
  title?: string

  /**
   * Phase 4.5d-3 — localized strings keyed by state. Resolved by the
   * caller (room views) via `useTranslations('room.presence')`.
   */
  labels?: SeatPresenceLabels
}

export function SeatPresenceIndicator({
  lastSeenAt,
  isHuman,
  now = Date.now(),
  title,
  labels,
}: SeatPresenceIndicatorProps): React.JSX.Element {
  if (!isHuman) {
    return <PresenceDot color="var(--text-muted, #888)" title={title ?? labels?.aiSeat ?? 'AI seat'} />
  }

  if (lastSeenAt == null) {
    return (
      <PresenceDot
        color="var(--danger, #e74c3c)"
        title={title ?? labels?.neverSeen ?? 'Never seen'}
      />
    )
  }

  const seenMs =
    typeof lastSeenAt === 'string' ? Date.parse(lastSeenAt) : lastSeenAt.getTime()
  // Negative ageMs (clock skew, future timestamps) → treat as online.
  const ageMs = now - seenMs

  if (ageMs < GREEN_GRACE_MS) {
    return (
      <PresenceDot
        color="var(--success, #10b981)"
        title={title ?? labels?.online ?? 'Online'}
      />
    )
  }
  if (ageMs < AMBER_GRACE_MS) {
    return (
      <PresenceDot
        color="#f5a623"
        title={title ?? labels?.reconnecting ?? 'Reconnecting…'}
      />
    )
  }
  return (
    <PresenceDot
      color="var(--danger, #e74c3c)"
      title={title ?? labels?.disconnected ?? 'Disconnected'}
    />
  )
}

interface PresenceDotProps {
  color: string
  title: string
}

function PresenceDot({ color, title }: PresenceDotProps): React.JSX.Element {
  const style: CSSProperties = {
    display: 'inline-block',
    width: '0.5rem',
    height: '0.5rem',
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
  }
  return <span style={style} title={title} aria-label={title} role="status" />
}
