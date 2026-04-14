'use client'

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { MessageList } from '../../components/MessageList'
import { AgentList } from '../../components/AgentList'
import { TokenCostPanel } from '../../components/TokenCostPanel'
import type { MessageData, PollResponse } from '../../components/theme'
import { createAgentColorMap, prefersDark } from '../../components/theme'

interface RoundtableViewProps {
  messages: readonly MessageData[]
  snapshot: Omit<PollResponse, 'messages'>
}

export function RoundtableView({ messages, snapshot }: RoundtableViewProps) {
  const params = useParams()
  const roomId = params.id as string
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    setIsDark(prefersDark())
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const colorFor = useMemo(() => createAgentColorMap(snapshot.agents, isDark), [snapshot.agents, isDark])

  const {
    agents,
    topic,
    status,
    currentRound,
    totalRounds,
    thinkingAgentId,
    tokenSummary,
  } = snapshot

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        maxWidth: '860px',
        margin: '0 auto',
        padding: '0 1rem',
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: '1rem 0',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <Link href="/" style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
            Agora
          </Link>
          <span style={{ color: 'var(--border)', fontSize: '0.8rem' }}>/</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Debate</span>
        </div>

        <h1
          style={{
            fontSize: '1.25rem',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            marginBottom: '0.75rem',
          }}
        >
          {topic}
        </h1>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            fontSize: '0.8rem',
            color: 'var(--muted)',
            flexWrap: 'wrap',
          }}
        >
          <span>
            Round {currentRound} of {totalRounds}
          </span>
          <StatusPill status={status} />
          <span style={{ marginLeft: 'auto' }}>{agents.length} agents</span>
          <Link
            href={`/room/${roomId}/observability`}
            style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none' }}
          >
            Timeline →
          </Link>
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <TokenCostPanel summary={tokenSummary} agents={agents} />
        </div>
      </header>

      <AgentList agents={agents} thinkingAgentId={thinkingAgentId} colorFor={colorFor} />

      <MessageList
        messages={messages}
        agents={agents}
        thinkingAgentId={thinkingAgentId}
        isRunning={status === 'running'}
        colorFor={colorFor}
      />

      {status === 'completed' && <CompletedFooter messageCount={messages.length} rounds={totalRounds} />}
      {status === 'error' && <ErrorFooter error={snapshot.error} />}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes dots {
          0% { content: ''; }
          25% { content: '.'; }
          50% { content: '..'; }
          75% { content: '...'; }
        }
      `}</style>
    </div>
  )
}

function StatusPill({ status }: { status: 'running' | 'completed' | 'error' }) {
  const dotColor =
    status === 'running' ? '#22c55e' : status === 'completed' ? 'var(--muted)' : 'var(--danger)'
  const label = status === 'running' ? 'Live' : status === 'completed' ? 'Completed' : 'Error'

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
      <span
        style={{
          display: 'inline-block',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: dotColor,
          animation: status === 'running' ? 'pulse 2s ease-in-out infinite' : 'none',
        }}
      />
      {label}
    </span>
  )
}

function CompletedFooter({ messageCount, rounds }: { messageCount: number; rounds: number }) {
  return (
    <div
      style={{
        padding: '1.5rem',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        textAlign: 'center',
        margin: '1rem 0',
      }}
    >
      <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Debate Complete</p>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>
        {messageCount} messages across {rounds} rounds
      </p>
      <Link
        href="/create"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '0.625rem 1.25rem',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--foreground)',
          color: 'var(--background)',
          fontSize: '0.875rem',
          fontWeight: 500,
          textDecoration: 'none',
        }}
      >
        Start New Debate
      </Link>
    </div>
  )
}

function ErrorFooter({ error }: { error?: string }) {
  return (
    <div
      style={{
        padding: '1.5rem',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--danger)',
        background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
        textAlign: 'center',
        margin: '1rem 0',
      }}
    >
      <p style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--danger)', marginBottom: '0.5rem' }}>
        Debate Error
      </p>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>
        {error ?? 'An unexpected error occurred during the debate.'}
      </p>
      <Link
        href="/create"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '0.625rem 1.25rem',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)',
          fontSize: '0.875rem',
          fontWeight: 500,
          textDecoration: 'none',
        }}
      >
        Try Again
      </Link>
    </div>
  )
}
