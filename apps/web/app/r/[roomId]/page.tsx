// ============================================================
// /r/[roomId] — guest invite landing
// ============================================================
//
// Validates the seat token (server-side), then redirects the
// client to /room/[roomId] after stashing the claim in
// localStorage so the room page reads it as the viewer's seat.
//
// We don't set an HttpOnly cookie — the game page is client-side
// rendered and talks to APIs with the token in Authorization, so
// localStorage is simpler than juggling cookie reads there.

import { verifySeatToken } from '../../lib/seat-tokens'
import { ClaimSeat } from './ClaimSeat'

interface PageProps {
  params: Promise<{ roomId: string }>
  searchParams: Promise<{ token?: string }>
}

export default async function GuestLanding({ params, searchParams }: PageProps) {
  const { roomId } = await params
  const { token } = await searchParams

  if (!token) {
    return <InviteError title="缺少邀请令牌" body="这个链接不完整，请向邀请你的人索取新的链接。" />
  }

  const payload = await verifySeatToken(token, roomId)
  if (!payload) {
    return (
      <InviteError
        title="邀请已失效"
        body="这个邀请链接已过期或无效。请向房主索取新的链接。"
      />
    )
  }

  // Valid — hand off to a client component that writes localStorage
  // and pushes to /room/:roomId. Can't do localStorage from RSC.
  return <ClaimSeat roomId={roomId} agentId={payload.agentId} token={token} />
}

function InviteError({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ maxWidth: 480, margin: '80px auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 590, marginBottom: 8 }}>{title}</h1>
      <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6 }}>{body}</p>
    </div>
  )
}

// Never cache — tokens are short-lived.
export const dynamic = 'force-dynamic'