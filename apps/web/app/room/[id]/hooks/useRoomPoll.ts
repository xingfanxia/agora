'use client'

import { useEffect, useRef, useState } from 'react'
import type { MessageData, PollResponse } from '../components/theme'

/**
 * Polls the room messages endpoint. Returns the full room snapshot
 * and appends new messages to local state as they arrive.
 *
 * If the viewer has claimed a seat (recorded in localStorage at key
 * `agora-seat-${roomId}`), it's passed as `?seat=<agentId>` so the
 * server can apply role-based channel visibility filtering. Without
 * a seat the server defaults to strict-observer scope (public
 * channels only) — non-owners can no longer read wolf chat.
 */
export function useRoomPoll(roomId: string) {
  const [messages, setMessages] = useState<MessageData[]>([])
  const [snapshot, setSnapshot] = useState<Omit<PollResponse, 'messages'> | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const lastTimestampRef = useRef(0)
  const statusRef = useRef<'lobby' | 'running' | 'waiting' | 'completed' | 'error'>('running')
  // Seat is read once on mount — same as the dispatcher in page.tsx.
  // Re-reading on every poll would let stale localStorage from another
  // tab leak through; the dispatcher controls the seat lifecycle.
  const seatRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    try {
      const raw = localStorage.getItem(`agora-seat-${roomId}`)
      if (raw) {
        const parsed = JSON.parse(raw) as { agentId?: string }
        if (parsed.agentId) seatRef.current = parsed.agentId
      }
    } catch { /* localStorage unavailable / corrupt — observer scope */ }

    async function poll() {
      try {
        const after = lastTimestampRef.current
        const seatQS = seatRef.current ? `&seat=${encodeURIComponent(seatRef.current)}` : ''
        const res = await fetch(`/api/rooms/${roomId}/messages?after=${after}${seatQS}`)

        if (!res.ok) {
          const data = (await res.json()) as { error?: string }
          if (!cancelled) {
            setErrorMsg(data.error ?? 'Failed to load room')
            setLoading(false)
          }
          return
        }

        const data = (await res.json()) as PollResponse

        if (!cancelled) {
          if (data.messages.length > 0) {
            setMessages((prev) => {
              const existingIds = new Set(prev.map((m) => m.id))
              const fresh = data.messages.filter((m) => !existingIds.has(m.id))
              if (fresh.length === 0) return prev
              const next = [...prev, ...fresh]
              lastTimestampRef.current = Math.max(...next.map((m) => m.timestamp))
              return next
            })
          }

          const { messages: _messages, ...rest } = data
          setSnapshot(rest)
          statusRef.current = data.status
          if (data.error) setErrorMsg(data.error)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setErrorMsg('Connection lost. Retrying...')
        }
      }

      if (!cancelled) {
        // Poll fast in active states. 'lobby' included so the LobbyView
        // re-renders within ~1s of the workflow flipping to 'running'
        // (without it, the gate-clear → first-message latency gets +5s
        // for no good reason). 'running' / 'waiting' for live games.
        const s = statusRef.current
        const delay = s === 'lobby' || s === 'running' || s === 'waiting' ? 1000 : 5000
        setTimeout(poll, delay)
      }
    }

    poll()

    return () => {
      cancelled = true
    }
  }, [roomId])

  return { messages, snapshot, errorMsg, loading }
}
