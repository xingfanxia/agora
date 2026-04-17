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

interface Props {
  roomId: string
  agentId: string
  token: string
}

export function ClaimSeat({ roomId, agentId, token }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(
        `agora-seat-${roomId}`,
        JSON.stringify({ roomId, agentId, token }),
      )
    } catch {
      setError('无法写入本地存储，请开启浏览器存储权限后重试。')
      return
    }
    router.replace(`/room/${roomId}`)
  }, [roomId, agentId, token, router])

  return (
    <div style={{ maxWidth: 420, margin: '120px auto', padding: '0 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 14, color: 'var(--muted)' }}>
        {error ?? '正在加入房间…'}
      </div>
    </div>
  )
}
