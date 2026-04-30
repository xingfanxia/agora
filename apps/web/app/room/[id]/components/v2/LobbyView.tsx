'use client'

// LobbyView — pre-start gate UI for rooms with human seats.
//
// Shows the human seats and their ready state. The viewer's own seat
// (read from localStorage[agora-seat-${roomId}]) gets a "ready" button.
// The room owner gets a "force start" button (visible to everyone, but
// the server-side check rejects non-owners).
//
// Cross-mode: same component works for werewolf, roundtable, open-chat
// because the lobby gate is mode-agnostic — only the workflow that
// fires AFTER lobby resolution is mode-specific.
//
// Polling: uses the parent useRoomPoll snapshot. When the workflow
// flips status='running', the parent re-renders and routes away from
// LobbyView automatically.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { AgentData } from '../theme'

interface Props {
  roomId: string
  agents: readonly AgentData[]
  gameState: Record<string, unknown> | null
  /** Human seat the viewer holds, from localStorage. Null = spectator. */
  humanAgentId: string | null
  /**
   * Bearer seat-token (from invite flow). Null = use cookie session
   * (owner-as-player path; the ready endpoint will fall back to the
   * authed-user check).
   */
  seatToken: string | null
  /** True if the auth-user matches room.createdBy. */
  isOwner: boolean
}

export function LobbyView({
  roomId,
  agents,
  gameState,
  humanAgentId,
  seatToken,
  isOwner,
}: Props) {
  const t = useTranslations('room.lobby')
  const tCommon = useTranslations('common')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const seatReady = readSeatReady(gameState)
  const humans = agents.filter((a) => a.isHuman === true)
  const totalHumans = humans.length
  const readyHumans = humans.filter((a) => seatReady[a.id] === true).length
  const ownReady =
    humanAgentId !== null && seatReady[humanAgentId] === true

  async function postReady() {
    if (!humanAgentId) return
    setSubmitting(true)
    setError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (seatToken) headers['Authorization'] = `Bearer ${seatToken}`
      const res = await fetch(
        `/api/rooms/${roomId}/seats/${humanAgentId}/ready`,
        { method: 'POST', headers, body: '{}' },
      )
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      // Snapshot will refresh via useRoomPoll; no local state to set.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function postForceStart() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/rooms/${roomId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        maxWidth: 640,
        margin: '80px auto',
        padding: '0 24px',
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 590, marginBottom: 8 }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.55 }}>
        {t('subtitle', { ready: readyHumans, total: totalHumans })}
      </p>

      <section
        style={{
          padding: 16,
          marginBottom: 16,
          borderRadius: 'var(--radius)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 590, marginBottom: 12 }}>
          {t('humanSeats')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {humans.map((a) => {
            const ready = seatReady[a.id] === true
            const isOwn = humanAgentId === a.id
            return (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: ready ? 'color-mix(in srgb, #22c55e 10%, transparent)' : 'var(--surface-hover)',
                  border: `1px solid ${ready ? 'color-mix(in srgb, #22c55e 35%, var(--border))' : 'var(--border)'}`,
                }}
              >
                <span style={{ flex: 1, fontSize: 14 }}>{a.name}</span>
                {isOwn && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: 'var(--accent-strong)',
                      color: '#fff',
                      fontWeight: 590,
                    }}
                  >
                    {t('youBadge')}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 510,
                    color: ready ? '#22c55e' : 'var(--muted)',
                  }}
                >
                  {ready ? `✓ ${t('readyBadge')}` : t('notReadyBadge')}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
            color: 'var(--danger)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {humanAgentId && !ownReady && (
          <button
            type="button"
            onClick={postReady}
            disabled={submitting}
            style={primaryButton(submitting)}
          >
            {submitting ? tCommon('loading') : t('readyButton')}
          </button>
        )}
        {humanAgentId && ownReady && (
          <div
            style={{
              padding: '10px 16px',
              fontSize: 13,
              color: 'var(--muted)',
            }}
          >
            {t('youReadyHint')}
          </div>
        )}
        {isOwner && (
          <button
            type="button"
            onClick={postForceStart}
            disabled={submitting}
            style={secondaryButton(submitting)}
            title={t('forceStartHint')}
          >
            {t('forceStartButton')}
          </button>
        )}
      </div>

      {!humanAgentId && !isOwner && (
        <div style={{ marginTop: 24, fontSize: 13, color: 'var(--muted)', lineHeight: 1.55 }}>
          {t('spectatorHint')}
        </div>
      )}
    </div>
  )
}

function readSeatReady(gameState: Record<string, unknown> | null): Record<string, boolean> {
  if (!gameState) return {}
  const raw = gameState['seatReady']
  if (raw === null || typeof raw !== 'object') return {}
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === true) out[k] = true
  }
  return out
}

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? 'rgba(255,255,255,0.04)' : 'var(--accent-strong)',
    color: disabled ? 'var(--muted)' : '#ffffff',
    border: 'none',
    padding: '10px 24px',
    borderRadius: 'var(--radius-card)',
    fontSize: 14,
    fontWeight: 590,
    cursor: disabled ? 'not-allowed' : 'pointer',
    minWidth: 140,
  }
}

function secondaryButton(disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    color: 'var(--accent)',
    border: '1px solid var(--accent)',
    padding: '10px 18px',
    borderRadius: 'var(--radius-card)',
    fontSize: 14,
    fontWeight: 510,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}
