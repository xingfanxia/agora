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
import { useTranslations } from 'next-intl'
import type { PollResponse, AgentData } from '../theme'
import { NIGHT_THINKING_PLACEHOLDER } from '../../../../lib/werewolf-visibility'
import { seatAuthHeaders } from '../../hooks/seat-auth'
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
  const t = useTranslations('room.humanBar')
  const tRoom = useTranslations('room')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const gs = snapshot.gameState ?? {}
  const waitingForHuman = gs['waitingForHuman'] as string | undefined
  const isMyTurn = snapshot.status === 'waiting' && waitingForHuman === humanAgentId

  const myAgent = snapshot.agents.find((a: AgentData) => a.id === humanAgentId)
  const myName = myAgent?.name ?? t('you')
  // Werewolf only: the seat's role + a short instruction string for
  // the active phase. Surfaces "🐺 你是狼人 — 选择今晚的目标" so the
  // human knows what they're doing without leaving this bar.
  const myRole =
    snapshot.modeId === 'werewolf'
      ? snapshot.roleAssignments?.[humanAgentId]
      : undefined
  const roleSubline = myRole && ROLE_KEYS.has(myRole)
    ? { label: t(`roles.${myRole}.label`), hint: t(`roles.${myRole}.hint`) }
    : null

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
        headers: { 'Content-Type': 'application/json', ...seatAuthHeaders(roomId) },
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
              {t('seatIntro', { name: myName })}
              {roleSubline && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--accent)' }}>{roleSubline.label}</span>
                </>
              )}
            </span>
            <br />
            <span style={{ color: 'var(--muted)' }}>
              {roleSubline?.hint ??
                t('watchHint', {
                  position: snapshot.agents.findIndex((a: AgentData) => a.id === humanAgentId) + 1,
                  total: agentCount,
                })}
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
            {t('dismiss')}
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
    const phaseKey = FREE_TEXT_PHASES.has(phase) ? phase : 'default'
    const placeholder = t(`placeholder.${phaseKey}`)
    const heading = t(`heading.${phaseKey}`)
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
              {t('seatLabel', { name: myName })}
              {roleSubline && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--accent)' }}>{roleSubline.label}</span>
                </>
              )}
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
              {t('enterHint')}
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
              {sending ? '...' : t('send')}
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
        {snapshot.thinkingAgentId === NIGHT_THINKING_PLACEHOLDER ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{tRoom('nightActing')}</div>
        ) : thinkingAgent ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {t('speaking', { name: thinkingAgent.name })}
            <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.7 }}>
              {t('position', { position: positionInRound, total: agentCount })}
            </span>
          </div>
        ) : snapshot.status === 'waiting' && waitingForHuman && waitingForHuman !== humanAgentId ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {t('waitingFor', {
              name:
                snapshot.agents.find((a: AgentData) => a.id === waitingForHuman)?.name ??
                t('someone'),
            })}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('processing')}</div>
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

// Free-text phases with their own placeholder/heading copy
// (room.humanBar.placeholder.* / heading.*); others use 'default'.
const FREE_TEXT_PHASES: ReadonlySet<string> = new Set(['wolfDiscuss', 'dayDiscuss', 'lastWords'])

// Werewolf roles with a label + one-line orientation hint shown next
// to the seat name (room.humanBar.roles.*). The hint is a *passive*
// reminder; the active phase prompt comes from the panel renderer.
const ROLE_KEYS: ReadonlySet<string> = new Set([
  'werewolf',
  'seer',
  'witch',
  'hunter',
  'guard',
  'idiot',
  'villager',
])
