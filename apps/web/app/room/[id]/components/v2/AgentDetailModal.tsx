// ============================================================
// AgentDetailModal — click-to-view agent details + message history
// ============================================================
//
// Phase 5.3. Two internal views:
//   overview — avatar, role, model, persona, system prompt, stats
//   all-messages — scrollable list of every message from this agent
//                  across every channel, decisions included.
//
// Stats (calls, cost, tokens) come from existing tokenSummary.byAgent.
// Messages are filtered client-side from the full room transcript.

'use client'

import { useEffect, useState } from 'react'
import type { AgentColor } from '../theme'
import { AgentAvatar } from './AgentAvatar'

export interface AgentDetailModalProps {
  open: boolean
  onClose: () => void
  agent: {
    id: string
    name: string
    model: string
    provider?: string
    persona?: { description?: string }
    systemPrompt?: string
    role?: string
    channels?: readonly string[]
  }
  color: AgentColor
  totals?: {
    callCount: number
    totalTokens: number
    inputTokens: number
    outputTokens: number
    cost: number
  }
  /** Full message transcript — modal filters by senderId = agent.id. */
  allMessages: readonly {
    id: string
    senderId: string
    channelId: string
    content: string
    timestamp: number
  }[]
}

type View = 'overview' | 'messages'

const ROLE_EMOJI: Record<string, string> = {
  werewolf: '🐺',
  villager: '👤',
  seer: '🔮',
  witch: '🧪',
  hunter: '🎯',
  guard: '🛡️',
  idiot: '🤡',
}

export function AgentDetailModal({
  open,
  onClose,
  agent,
  color,
  totals,
  allMessages,
}: AgentDetailModalProps) {
  const [view, setView] = useState<View>('overview')
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)

  // Reset view when modal closes so re-open always starts at overview.
  useEffect(() => {
    if (!open) {
      setView('overview')
      setShowSystemPrompt(false)
    }
  }, [open])

  // Esc to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const mine = allMessages.filter((m) => m.senderId === agent.id)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="agora-agent-modal-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          color: 'var(--foreground)',
          borderRadius: 16,
          maxWidth: 540,
          width: '100%',
          maxHeight: '85vh',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            padding: 20,
            borderBottom: '1px solid var(--border)',
            alignItems: 'center',
          }}
        >
          <AgentAvatar name={agent.name} provider={agent.provider} color={color} size={64} />
          <div style={{ flex: 1 }}>
            <h2
              id="agora-agent-modal-title"
              style={{ margin: 0, fontSize: 20, fontWeight: 590, color: color.name }}
            >
              {agent.name}
              {agent.role && (
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 510,
                    marginLeft: 10,
                    padding: '2px 8px',
                    borderRadius: 8,
                    background: color.border,
                    color: color.name,
                  }}
                >
                  {ROLE_EMOJI[agent.role] ?? ''} {agent.role}
                </span>
              )}
            </h2>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
              {agent.model} · {agent.provider ?? '?'}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 20,
              color: 'var(--muted)',
              cursor: 'pointer',
              width: 32,
              height: 32,
              borderRadius: 6,
            }}
          >
            ×
          </button>
        </div>

        {/* Tab strip */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          <TabBtn active={view === 'overview'} onClick={() => setView('overview')}>
            Overview
          </TabBtn>
          <TabBtn active={view === 'messages'} onClick={() => setView('messages')}>
            All messages ({mine.length})
          </TabBtn>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {view === 'overview' ? (
            <Overview
              agent={agent}
              totals={totals}
              showSystemPrompt={showSystemPrompt}
              onToggleSystemPrompt={() => setShowSystemPrompt((v) => !v)}
            />
          ) : (
            <MessageList messages={mine} color={color} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Tab button ─────────────────────────────────────────────

function TabBtn({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '12px 16px',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        color: active ? 'var(--foreground)' : 'var(--muted)',
        fontSize: 13,
        fontWeight: active ? 590 : 400,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

// ── Overview body ──────────────────────────────────────────

function Overview({
  agent,
  totals,
  showSystemPrompt,
  onToggleSystemPrompt,
}: {
  agent: AgentDetailModalProps['agent']
  totals?: AgentDetailModalProps['totals']
  showSystemPrompt: boolean
  onToggleSystemPrompt: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {agent.channels && agent.channels.length > 0 && (
        <Row label="Channels">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {agent.channels.map((c) => (
              <span
                key={c}
                style={{
                  padding: '2px 8px',
                  borderRadius: 6,
                  background: 'var(--surface-hover)',
                  fontSize: 12,
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                {c}
              </span>
            ))}
          </div>
        </Row>
      )}

      {agent.persona?.description && (
        <Row label="Persona">
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{agent.persona.description}</p>
        </Row>
      )}

      {agent.systemPrompt && (
        <Row label="System prompt">
          <button
            onClick={onToggleSystemPrompt}
            style={{
              background: 'var(--surface-hover)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              color: 'var(--muted)',
              cursor: 'pointer',
              marginBottom: showSystemPrompt ? 8 : 0,
            }}
          >
            {showSystemPrompt ? '▾ hide' : '▸ show'}
          </button>
          {showSystemPrompt && (
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: 'var(--surface-hover)',
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.5,
                maxHeight: 200,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {agent.systemPrompt}
            </pre>
          )}
        </Row>
      )}

      {totals && (
        <Row label="Stats">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Stat label="Calls" value={String(totals.callCount)} />
            <Stat label="Cost" value={`$${totals.cost.toFixed(4)}`} />
            <Stat label="Tokens" value={formatTokens(totals.totalTokens)} />
            <Stat
              label="In / Out"
              value={`${formatTokens(totals.inputTokens)} / ${formatTokens(totals.outputTokens)}`}
            />
          </div>
        </Row>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: 0.8,
          marginBottom: 8,
          fontWeight: 590,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '8px 12px',
        background: 'var(--surface-hover)',
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 590,
          fontFamily: 'ui-monospace, monospace',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

// ── Messages body ──────────────────────────────────────────

function MessageList({
  messages,
  color,
}: {
  messages: readonly { id: string; channelId: string; content: string; timestamp: number }[]
  color: AgentColor
}) {
  if (messages.length === 0) {
    return <p style={{ margin: 0, color: 'var(--muted)' }}>No messages yet.</p>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {messages.map((m) => (
        <div
          key={m.id}
          style={{
            padding: 10,
            borderLeft: `3px solid ${color.name}`,
            background: 'var(--surface-hover)',
            borderRadius: 6,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 4,
              fontSize: 11,
              color: 'var(--muted)',
            }}
          >
            <span style={{ fontFamily: 'ui-monospace, monospace' }}>{m.channelId}</span>
            <span>{new Date(m.timestamp).toLocaleTimeString()}</span>
          </div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>
        </div>
      ))}
    </div>
  )
}
