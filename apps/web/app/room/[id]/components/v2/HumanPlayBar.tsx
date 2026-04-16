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
import {
  VotePanel,
  WitchPanel,
  SeerPanel,
  GuardPanel,
  HunterPanel,
  SheriffElectionPanel,
  SheriffTransferPanel,
} from './WerewolfPanels'

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
    // Map phase → turnId for free-text turns
    const phase = snapshot.currentPhase ?? ''
    const turnId = phase === 'wolfDiscuss' ? 'wolf-speak' : phase === 'lastWords' ? 'last-words' : 'speak'
    try {
      const res = await fetch(`/api/rooms/${roomId}/human-input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: humanAgentId,
          turnId,
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
  }, [text, sending, roomId, humanAgentId, snapshot.currentPhase])

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
          <div style={{ fontSize: 13, lineHeight: 1.5, letterSpacing: '-0.13px' }}>
            <span style={{ fontWeight: 590 }}>
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
              fontWeight: 510,
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

  // ── My turn — dispatch to werewolf panel if applicable ───
  if (isMyTurn) {
    const phase = snapshot.currentPhase ?? ''
    const werewolfPanel = renderWerewolfPanel(phase, roomId, humanAgentId, snapshot, () => setHasActed(true))
    if (werewolfPanel) {
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
            {werewolfPanel}
          </div>
        </div>
      )
    }

    // Default: free-text speech panel (open-chat, roundtable, day/wolf discuss)
    const placeholder = getPlaceholder(phase)
    const heading = getHeading(phase)
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
          <div
            style={{
              fontSize: 13,
              fontWeight: 590,
              letterSpacing: '-0.13px',
              marginBottom: 4,
            }}
          >
            {heading}
          </div>
          {myAgent && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 510,
                color: 'var(--muted)',
                marginBottom: 8,
                letterSpacing: '0.02em',
              }}
            >
              Playing as {myName}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={3}
            style={{
              width: '100%',
              background: 'rgba(255, 255, 255, 0.02)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '10px 12px',
              fontSize: 14,
              lineHeight: 1.5,
              resize: 'vertical',
              fontFamily: 'inherit',
              outline: 'none',
              maxHeight: 200,
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 400,
                color: 'var(--muted-strong)',
                alignSelf: 'center',
              }}
            >
              Enter to send, Shift+Enter for newline
            </span>
            <button
              onClick={() => void submit()}
              disabled={!text.trim() || sending}
              style={{
                background: text.trim() && !sending ? 'var(--accent-strong)' : 'rgba(255,255,255,0.04)',
                color: text.trim() && !sending ? '#ffffff' : 'var(--muted)',
                border: 'none',
                padding: '7px 16px',
                borderRadius: 'var(--radius)',
                fontSize: 13,
                fontWeight: 590,
                letterSpacing: '-0.13px',
                cursor: text.trim() && !sending ? 'pointer' : 'not-allowed',
                transition: 'background .15s ease',
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
  borderRadius: 'var(--radius-card) var(--radius-card) 0 0',
  boxShadow: 'var(--shadow-md)',
}

// ── Phase → panel dispatch ─────────────────────────────────

function renderWerewolfPanel(
  phase: string,
  roomId: string,
  humanAgentId: string,
  snapshot: Omit<PollResponse, 'messages'>,
  onSubmitted: () => void,
): React.ReactNode | null {
  const common = { roomId, humanAgentId, snapshot, onSubmitted }
  switch (phase) {
    case 'wolfVote':
      return <VotePanel {...common} turnId="wolf-vote" />
    case 'dayVote':
      return <VotePanel {...common} turnId="day-vote" />
    case 'witchAction':
      return <WitchPanel {...common} />
    case 'seerCheck':
      return <SeerPanel {...common} />
    case 'guardProtect':
      return <GuardPanel {...common} />
    case 'hunterShoot':
      return <HunterPanel {...common} />
    case 'sheriffElection':
      return <SheriffElectionPanel {...common} />
    case 'sheriffTransfer':
      return <SheriffTransferPanel {...common} />
    // Free-text phases use the default textarea path
    case 'wolfDiscuss':
    case 'dayDiscuss':
    case 'lastWords':
    default:
      return null
  }
}

function getPlaceholder(phase: string): string {
  switch (phase) {
    case 'wolfDiscuss':
      return 'Discuss who to eliminate...'
    case 'dayDiscuss':
      return 'Defend yourself or accuse...'
    case 'lastWords':
      return 'Any final words?'
    default:
      return 'Share your thoughts...'
  }
}

function getHeading(phase: string): string {
  switch (phase) {
    case 'wolfDiscuss':
      return '🐺 Wolf discussion'
    case 'dayDiscuss':
      return '☀️ Day discussion'
    case 'lastWords':
      return '💀 Your last words'
    default:
      return '💬 Your turn to speak'
  }
}
