// ============================================================
// InvitePanel — owner-only seat invite links (Phase 4.5d)
// ============================================================
//
// Shows when the room has 2+ human seats (multi-human game). Calls
// POST /api/rooms/[id]/invites, which is owner-gated. If the caller
// isn't the owner, we quietly hide the panel — the API returns 403
// and we bail out.
//
// Hidden when there are no human seats, or when only one human seat
// exists (the owner's own seat, auto-claimed on creation).

'use client'

import { useCallback, useEffect, useState } from 'react'

interface Invite {
  agentId: string
  agentName: string
  url: string
}

interface Agent {
  id: string
  name: string
  isHuman?: boolean
}

interface Props {
  roomId: string
  agents: readonly Agent[]
}

export function InvitePanel({ roomId, agents }: Props) {
  const humanSeats = agents.filter((a) => a.isHuman)
  const [isOwner, setIsOwner] = useState<boolean | null>(null) // null = unknown
  const [open, setOpen] = useState(false)
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const fetchInvites = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/rooms/${roomId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.status === 401 || res.status === 403) {
        setIsOwner(false)
        return
      }
      const data = (await res.json()) as { invites: Invite[] }
      setInvites(data.invites ?? [])
      setIsOwner(true)
    } catch {
      setIsOwner(false)
    } finally {
      setLoading(false)
    }
  }, [roomId])

  // Probe ownership on mount — cheap, and lets us render/hide the button.
  useEffect(() => {
    if (humanSeats.length >= 2) {
      void fetchInvites()
    } else {
      setIsOwner(false)
    }
  }, [humanSeats.length, fetchInvites])

  if (!isOwner || humanSeats.length < 2) return null

  async function copy(inv: Invite) {
    try {
      await navigator.clipboard.writeText(inv.url)
      setCopiedId(inv.agentId)
      setTimeout(() => setCopiedId((cur) => (cur === inv.agentId ? null : cur)), 1800)
    } catch {
      // Clipboard permission not granted — fall back to selecting the text.
      const input = document.getElementById(`invite-url-${inv.agentId}`) as HTMLInputElement | null
      input?.select()
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Invite panel"
        style={{
          position: 'fixed',
          top: 12,
          right: 12,
          zIndex: 45,
          background: 'var(--accent-strong)',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius-card)',
          padding: '8px 14px',
          fontSize: 13,
          fontWeight: 590,
          cursor: 'pointer',
          boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        }}
      >
        邀请 · {invites.length}
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            top: 56,
            right: 12,
            width: 360,
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: 'calc(100vh - 80px)',
            overflowY: 'auto',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card)',
            padding: 16,
            zIndex: 45,
            boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 590, marginBottom: 4 }}>邀请人类玩家</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
            复制链接发送给对方。每个链接仅对一个座位有效，有效期 7 天。
          </div>

          {loading && <div style={{ fontSize: 12, color: 'var(--muted)' }}>加载中…</div>}

          {!loading && invites.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>没有人类座位。</div>
          )}

          {!loading && invites.map((inv) => (
            <div
              key={inv.agentId}
              style={{
                padding: 10,
                marginBottom: 8,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--surface-hover, rgba(255,255,255,0.03))',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 510 }}>{inv.agentName}</span>
                <button
                  type="button"
                  onClick={() => copy(inv)}
                  style={{
                    background: copiedId === inv.agentId ? 'var(--accent)' : 'var(--accent-strong)',
                    color: '#fff',
                    border: 'none',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 11,
                    fontWeight: 590,
                    cursor: 'pointer',
                  }}
                >
                  {copiedId === inv.agentId ? '已复制' : '复制'}
                </button>
              </div>
              <input
                id={`invite-url-${inv.agentId}`}
                readOnly
                value={inv.url}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--foreground-secondary)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          ))}
        </div>
      )}
    </>
  )
}
