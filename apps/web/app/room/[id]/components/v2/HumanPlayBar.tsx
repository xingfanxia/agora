// ============================================================
// HumanPlayBar — bottom bar for human-controlled agents
// ============================================================
//
// Phase 4.5c — Shows different states based on room status:
//   1. Between-turns status bar ("X is speaking... 3 of 9")
//   2. "You're up next" preview
//   3. Full text input panel (when it's the human's turn)
//   4. First-turn onboarding (one-time welcome)
//
// Only renders when the viewer has a valid seat token.

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PollResponse, AgentData } from '../theme'

export interface HumanPlayBarProps {
  roomId: string
  /** The agent ID the human is playing as (from localStorage seat token) */
  humanAgentId: string
  snapshot: Omit<PollResponse, 'messages'>
  /** Total messages so far (used for turn position calculation) */
  messageCount: number
}

export function HumanPlayBar({ roomId, humanAgentId, snapshot, messageCount }: HumanPlayBarProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const gs = snapshot.gameState ?? {}
  const waitingForHuman = gs['waitingForHuman'] as string | undefined
  const isMyTurn = snapshot.status === 'waiting' && waitingForHuman === humanAgentId

  const myAgent = snapshot.agents.find((a: AgentData) => a.id === humanAgentId)
  const myName = myAgent?.name ?? 'You'

  // Total agents in the room
  const agentCount = snapshot.agents.length
  // Current position in the round (for open-chat round-robin)
  const positionInRound = agentCount > 0 ? (messageCount % agentCount) + 1 : 0

  // Who's currently thinking (not me)
  const thinkingAgent = snapshot.thinkingAgentId
    ? snapshot.agents.find((a: AgentData) => a.id === snapshot.thinkingAgentId)
    : null

  // First turn onboarding — show once until first submission
  const [hasActed, setHasActed] = useState(false)
  const showOnboarding = !hasActed && !dismissed && !isMyTurn && snapshot.status === 'running'

  // Auto-focus textarea when it's my turn
  useEffect(() => {
    if (isMyTurn) {
      setTimeout(() => textareaRef.current?.focus(), 350) // after slide-in animation
    }
  }, [isMyTurn])

  const submit = useCallback(async () => {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/rooms/${roomId}/human-input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: humanAgentId,
          turnId: 'speak',
          payload: { content: text.trim() },
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        console.error('[HumanPlayBar] submit failed:', (err as { error?: string }).error)
      } else {
        setText('')
        setHasActed(true)
      }
    } catch (e) {
      console.error('[HumanPlayBar] submit error:', e)
    } finally {
      setSending(false)
    }
  }, [text, sending, roomId, humanAgentId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void submit()
      }
    },
    [submit],
  )

  // Room completed or errored — don't show bar
  if (snapshot.status === 'completed' || snapshot.status === 'error') return null

  // ── First-turn onboarding ────────────────────────────────
  if (showOnboarding) {
    return (
      <div style={barContainerStyle}>
        <div style={{ ...barStyle, padding: '12px 16px' }}>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600 }}>
              {'👋 '}Welcome! You&apos;re playing as {myName}.
            </span>
            <br />
            <span style={{ color: 'var(--muted)' }}>
              Watch the conversation — your turn will come at position{' '}
              {snapshot.agents.findIndex((a: AgentData) => a.id === humanAgentId) + 1} of{' '}
              {agentCount} in the round.
            </span>
          </div>
          <button
            onClick={() => setDismissed(true)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--muted)',
              fontSize: 12,
              cursor: 'pointer',
              marginTop: 4,
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    )
  }

  // ── My turn — show input panel ───────────────────────────
  if (isMyTurn) {
    return (
      <div style={barContainerStyle}>
        <div
          style={{
            ...barStyle,
            padding: '12px 16px',
            borderLeft: '3px solid var(--accent)',
            animation: 'slideUp 300ms ease-out',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            {'💬 '}Your turn to speak
          </div>
          {myAgent && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
              Playing as {myName}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Share your thoughts..."
            rows={3}
            style={{
              width: '100%',
              background: 'var(--background)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm, 6px)',
              padding: '8px 12px',
              fontSize: 14,
              lineHeight: 1.5,
              resize: 'vertical',
              fontFamily: 'inherit',
              outline: 'none',
              maxHeight: 200,
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>
              Enter to send, Shift+Enter for newline
            </span>
            <button
              onClick={() => void submit()}
              disabled={!text.trim() || sending}
              style={{
                background: text.trim() && !sending ? 'var(--accent)' : 'var(--surface-hover)',
                color: text.trim() && !sending ? 'white' : 'var(--muted)',
                border: 'none',
                padding: '6px 16px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                cursor: text.trim() && !sending ? 'pointer' : 'not-allowed',
              }}
            >
              {sending ? '...' : 'Send ↵'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Between turns — status bar ───────────────────────────
  return (
    <div style={barContainerStyle}>
      <div style={{ ...barStyle, padding: '10px 16px', minHeight: 40 }}>
        {thinkingAgent ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {'⏳ '}{thinkingAgent.name} is speaking...
            <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.7 }}>
              ({positionInRound} of {agentCount})
            </span>
          </div>
        ) : snapshot.status === 'waiting' && waitingForHuman && waitingForHuman !== humanAgentId ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {'⏳ '}Waiting for {snapshot.agents.find((a: AgentData) => a.id === waitingForHuman)?.name ?? 'someone'}...
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {'⏳ '}Processing...
          </div>
        )}
      </div>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────

const barContainerStyle: React.CSSProperties = {
  position: 'sticky',
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: 10,
  padding: '0 0 0 0',
}

const barStyle: React.CSSProperties = {
  background: 'var(--surface)',
  borderTop: '1px solid var(--border)',
  borderRadius: '8px 8px 0 0',
}
