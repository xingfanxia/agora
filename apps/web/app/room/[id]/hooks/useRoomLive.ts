'use client'

// ============================================================
// useRoomLive (Phase 4.5d-1)
// ============================================================
//
// Two coupled responsibilities:
//
//   1. Maintain the seat's liveness signal in Postgres by POSTing
//      to /api/rooms/[id]/heartbeat every ~5s while the tab is
//      visible. Postgres is the source of truth for WDK step
//      decisions in 4.5d-2 (durability contract).
//
//   2. Subscribe to a Supabase Realtime presence channel for
//      cheap UI-side peer awareness (who's-here pills, typing
//      affordances). Realtime is intentionally NOT the source of
//      truth — it's a UX layer over the Postgres heartbeat.
//
// Multi-tab: each tab heartbeats independently. Server keys on
// (room_id, agent_id), so any tab's tick keeps the seat online.
//
// Mobile suspend: hidden tabs skip ticks (cost saver). On
// visibility-change to visible we fire an immediate catch-up
// tick instead of waiting for the next interval.
//
// Heartbeat failures are non-fatal — server falls back via
// last_seen_at. The hook does not surface heartbeat errors.

import { useCallback, useEffect, useState } from 'react'
import { supabaseBrowser } from '../../../lib/supabase-browser'

/** How often to POST /heartbeat while visible. */
const HEARTBEAT_INTERVAL_MS = 5_000

export interface UseRoomLiveOptions {
  /**
   * Seat (agent) the local user occupies. When set, the hook
   * sends heartbeats and broadcasts presence as this seat.
   * Spectators / room owners watching their own room can omit
   * this.
   */
  agentId?: string

  /**
   * Bearer seat-token for guest humans landing via /r/[id]?token=...
   * Logged-in room owners testing locally can omit this; the
   * heartbeat endpoint accepts the session cookie as fallback.
   */
  seatToken?: string
}

export interface PeerPresence {
  agentId: string
  /** ISO timestamp the peer joined the channel. */
  onlineAt: string
}

export interface UseRoomLiveReturn {
  /** Other seats currently joined to the Realtime channel. */
  peers: PeerPresence[]
  /** True when the Realtime channel is in SUBSCRIBED state. */
  isConnected: boolean
}

export function useRoomLive(roomId: string, options: UseRoomLiveOptions = {}): UseRoomLiveReturn {
  const { agentId, seatToken } = options
  const [peers, setPeers] = useState<PeerPresence[]>([])
  const [isConnected, setIsConnected] = useState(false)

  const sendHeartbeat = useCallback(async () => {
    if (!agentId) return
    if (typeof document !== 'undefined' && document.hidden) return
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (seatToken) headers['Authorization'] = `Bearer ${seatToken}`
      await fetch(`/api/rooms/${roomId}/heartbeat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ agentId }),
        cache: 'no-store',
      })
    } catch {
      // Heartbeat failures are non-fatal; the server falls back via
      // last_seen_at expiry. Surfacing transient errors would create
      // false-disconnect noise on every tab-suspend / network blip.
    }
  }, [roomId, agentId, seatToken])

  // Heartbeat lifecycle
  useEffect(() => {
    if (!agentId) return

    void sendHeartbeat() // immediate tick on mount
    const intervalId = setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS)

    const onVisibility = () => {
      if (!document.hidden) void sendHeartbeat() // catch-up on resume
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [agentId, sendHeartbeat])

  // Realtime presence — UI affordances only (NOT source of truth)
  useEffect(() => {
    const supabase = supabaseBrowser()
    const channel = supabase.channel(`room:${roomId}:presence`, {
      config: { presence: { key: agentId ?? 'spectator' } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, PeerPresence[]>
        const flat: PeerPresence[] = []
        for (const seatId of Object.keys(state)) {
          for (const entry of state[seatId] ?? []) flat.push(entry)
        }
        setPeers(flat)
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true)
          if (agentId) {
            void channel.track({ agentId, onlineAt: new Date().toISOString() })
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setIsConnected(false)
        }
      })

    return () => {
      void channel.unsubscribe()
      void supabase.removeChannel(channel)
    }
  }, [roomId, agentId])

  return { peers, isConnected }
}
