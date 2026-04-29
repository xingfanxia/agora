'use client'

// ============================================================
// usePresenceMap (Phase 4.5d-3)
// ============================================================
//
// Read complement to `useRoomLive`'s heartbeat write. Polls
// GET /api/rooms/[id]/presence every ~5s and exposes the result as
// `Record<agentId, lastSeenAt: ISO8601 string>` for `SeatPresenceIndicator`
// to render green / amber / red dots.
//
// Why a separate hook (not folded into `useRoomLive`):
//
//   - `useRoomLive` heartbeats AS one seat (the local user's). It runs
//     for whoever holds a seat token. Spectators don't run it.
//   - `usePresenceMap` reads ALL seats' presence. Anyone viewing the
//     room runs it, including spectators with no seat.
//
// The shapes are also different — `useRoomLive` returns a connection
// flag + a Realtime peer list (binary in-channel/not-in-channel),
// `usePresenceMap` returns timestamp data (continuous fade across the
// 30s grace window).
//
// Visibility-aware: hidden tabs skip ticks (cost saver — same pattern as
// useRoomLive). Failures are non-fatal — we keep the last-known map so
// transient network blips don't make every dot turn red.
//
// Polling cadence (5s) matches the heartbeat interval, so the indicator
// can lag at most ~5s behind reality. Realtime broadcast on heartbeat
// could close that gap, but it would couple this hook to Supabase's
// presence channel and we already opted to keep `usePresenceMap` independent.

import { useCallback, useEffect, useRef, useState } from 'react'

/** ms between polls while the document is visible. */
const POLL_INTERVAL_MS = 5_000

export interface UsePresenceMapOptions {
  /**
   * Override poll interval (testing only — production uses the default).
   */
  intervalMs?: number
}

export type PresenceMap = Readonly<Record<string, string>>

/**
 * Polls `/api/rooms/{roomId}/presence` and returns the latest known
 * `{ agentId: ISO8601 }` map. Empty object until the first response lands.
 *
 * Pure read hook — does NOT heartbeat. Pair with `useRoomLive` on the
 * specific seat you want to mark online.
 */
export function usePresenceMap(
  roomId: string,
  options: UsePresenceMapOptions = {},
): PresenceMap {
  const { intervalMs = POLL_INTERVAL_MS } = options
  const [presence, setPresence] = useState<PresenceMap>({})
  // Lets effect-cleanup short-circuit a stale fetch's setState (avoids
  // React 18 warning + late writes after unmount).
  const aliveRef = useRef(true)

  const fetchPresence = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return
    try {
      const res = await fetch(`/api/rooms/${roomId}/presence`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = (await res.json()) as { presence: Record<string, string> }
      if (!aliveRef.current) return
      // Identity-preserve when nothing actually changed. `setPresence`
      // would otherwise allocate a new object every 5s — even on a
      // quiet room where no timestamp moved — and force every consuming
      // useMemo (e.g. tableAgents in WerewolfView/RoundtableView) to
      // invalidate, remounting the whole RoundTable for no reason.
      const next = data.presence ?? {}
      setPresence((prev) => (presenceEqual(prev, next) ? prev : next))
    } catch {
      // Non-fatal — keep last-known map. Surfacing errors here would
      // make every dot flicker red on every transient network blip.
    }
  }, [roomId])

  useEffect(() => {
    aliveRef.current = true

    void fetchPresence() // immediate tick on mount
    const intervalId = setInterval(() => void fetchPresence(), intervalMs)

    const onVisibility = () => {
      if (!document.hidden) void fetchPresence() // catch-up on resume
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      aliveRef.current = false
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetchPresence, intervalMs])

  return presence
}

/**
 * Shallow equality for presence maps. Cheap (≤10 keys per typical room)
 * and sufficient — every value is a string we compare with `===`.
 */
function presenceEqual(a: PresenceMap, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) if (a[k] !== b[k]) return false
  return true
}
