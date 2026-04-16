// ============================================================
// DebateSummary — post-debate stats bar
// ============================================================
//
// Rendered in RoundtableView when status=completed. Shows:
// - Topic (re-state)
// - Per-agent contribution as proportional bars (messages per agent)
// - Aggregate: total messages, cost, tokens, duration.

'use client'

import { useMemo } from 'react'
import type { AgentColor } from '../theme'
import { AgentAvatar } from './AgentAvatar'

export interface DebateSummaryAgent {
  id: string
  name: string
  model: string
  provider?: string
}

export interface DebateSummaryProps {
  topic: string | null
  agents: readonly DebateSummaryAgent[]
  messagesPerAgent: Record<string, number>
  totalMessages: number
  totalCost: number
  totalTokens: number
  durationSec: number | null
  colorFor: (agentId: string) => AgentColor
}

function fmtUSD(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(3)}`
}

function fmtTokens(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function DebateSummary({
  topic,
  agents,
  messagesPerAgent,
  totalMessages,
  totalCost,
  totalTokens,
  durationSec,
  colorFor,
}: DebateSummaryProps) {
  const maxMsgs = useMemo(() => {
    return Math.max(1, ...Object.values(messagesPerAgent))
  }, [messagesPerAgent])

  return (
    <section
      style={{
        maxWidth: 1280,
        margin: '1rem auto 0',
        width: '100%',
        padding: 20,
        borderRadius: 'var(--radius)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 590,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--muted)',
          marginBottom: 8,
        }}
      >
        辩论总结 · Debate summary
      </div>

      {topic && (
        <div
          style={{
            fontSize: 15,
            fontWeight: 510,
            color: 'var(--foreground)',
            marginBottom: 16,
            lineHeight: 1.5,
          }}
        >
          {topic}
        </div>
      )}

      {/* Per-agent contribution */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        {agents.map((a) => {
          const count = messagesPerAgent[a.id] ?? 0
          const width = maxMsgs > 0 ? (count / maxMsgs) * 100 : 0
          return (
            <div
              key={a.id}
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <AgentAvatar name={a.name} color={colorFor(a.id)} size={24} provider={a.provider} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 510 }}>{a.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {count} {count === 1 ? 'message' : 'messages'}
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: 'var(--surface-hover)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${width}%`,
                      background: colorFor(a.id).border,
                      transition: 'width .3s ease',
                    }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Aggregates */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          paddingTop: 12,
          borderTop: '1px solid var(--border)',
          fontSize: 12,
          color: 'var(--muted)',
        }}
      >
        <span>
          <strong style={{ color: 'var(--foreground)' }}>{totalMessages}</strong> total messages
        </span>
        <span>
          <strong style={{ color: 'var(--foreground)' }}>{fmtTokens(totalTokens)}</strong> tokens
        </span>
        <span>
          <strong style={{ color: 'var(--foreground)' }}>{fmtUSD(totalCost)}</strong>
        </span>
        {durationSec !== null && (
          <span>
            <strong style={{ color: 'var(--foreground)' }}>{durationSec}s</strong> duration
          </span>
        )}
      </div>
    </section>
  )
}
