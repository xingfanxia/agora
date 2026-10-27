// ============================================================
// ClaimSeat — client-only localStorage writer + redirect
// ============================================================
//
// Stashes {roomId, agentId, token} at key `agora-seat-{roomId}`
// so the /room/[id] page reads it as the viewer's seat. Then
// replaces the URL with /room/[id] so the invite token doesn't
// linger in browser history.

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

interface Props {
  roomId: string
  agentId: string
  token: string
}

export function ClaimSeat({ roomId, agentId, token }: Props) {
  const router = useRouter()
  const t = useTranslations('invite')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(
        `agora-seat-${roomId}`,
        JSON.stringify({ roomId, agentId, token }),
      )
    } catch {
      setError(t('storageError'))
      return
    }
    router.replace(`/room/${roomId}`)
  }, [roomId, agentId, token, router, t])

  return (
    <div style={{ maxWidth: 420, margin: '120px auto', padding: '0 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 14, color: 'var(--muted)' }}>
        {error ?? t('joining')}
      </div>
    </div>
  )
}
