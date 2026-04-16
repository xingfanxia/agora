'use client'

import { useEffect, useRef, useState } from 'react'
import type { MessageData, PollResponse } from '../components/theme'

/**
 * Polls the room messages endpoint. Returns the full room snapshot
 * and appends new messages to local state as they arrive.
 */
export function useRoomPoll(roomId: string) {
  const [messages, setMessages] = useState<MessageData[]>([])
  const [snapshot, setSnapshot] = useState<Omit<PollResponse, 'messages'> | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const lastTimestampRef = useRef(0)
  const statusRef = useRef<'running' | 'waiting' | 'completed' | 'error'>('running')

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const after = lastTimestampRef.current
        const res = await fetch(`/api/rooms/${roomId}/messages?after=${after}`)

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
        // Poll fast when running or waiting (human may submit any moment)
        const delay = statusRef.current === 'running' || statusRef.current === 'waiting' ? 1000 : 5000
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
