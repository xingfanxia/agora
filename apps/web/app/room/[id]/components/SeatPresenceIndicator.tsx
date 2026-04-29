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
// Usage with the existing AgentList renderExtra slot:
//
//   <AgentList
//     agents={agents}
//     renderExtra={(a) => (
//       <SeatPresenceIndicator
//         lastSeenAt={presenceMap[a.id] ?? null}
//         isHuman={a.isHuman ?? false}
//       />
//     )}
//   />

import type { CSSProperties } from 'react'

const GREEN_GRACE_MS = 30_000 // matches PRESENCE_GRACE_MS in lib/presence.ts
const AMBER_GRACE_MS = 60_000 // 2× green = give the user one full retry window

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

  /** Optional override for the title/aria-label. */
  title?: string
}

export function SeatPresenceIndicator({
  lastSeenAt,
  isHuman,
  now = Date.now(),
  title,
}: SeatPresenceIndicatorProps): React.JSX.Element {
  if (!isHuman) {
    return <PresenceDot color="var(--text-muted, #888)" title={title ?? 'AI seat'} />
  }

  if (lastSeenAt == null) {
    return <PresenceDot color="var(--danger, #e74c3c)" title={title ?? 'Never seen'} />
  }

  const seenMs =
    typeof lastSeenAt === 'string' ? Date.parse(lastSeenAt) : lastSeenAt.getTime()
  // Negative ageMs (clock skew, future timestamps) → treat as online.
  const ageMs = now - seenMs

  if (ageMs < GREEN_GRACE_MS) {
    return <PresenceDot color="var(--success, #10b981)" title={title ?? 'Online'} />
  }
  if (ageMs < AMBER_GRACE_MS) {
    return <PresenceDot color="#f5a623" title={title ?? 'Reconnecting…'} />
  }
  return <PresenceDot color="var(--danger, #e74c3c)" title={title ?? 'Disconnected'} />
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
