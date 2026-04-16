'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { AgentData, TokenSummary } from './theme'
import { fmtUSD, fmtTokens, modelLabel } from './theme'

interface TokenCostPanelProps {
  summary: TokenSummary | null
  agents: readonly AgentData[]
  /** Collapsed by default — user clicks to expand. */
  defaultExpanded?: boolean
}

/**
 * Live cost / token tracker. Shows the running total with an
 * expandable breakdown by model and agent.
 */
export function TokenCostPanel({ summary, agents, defaultExpanded = false }: TokenCostPanelProps) {
  const t = useTranslations('room.tokenPanel')
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (!summary || summary.callCount === 0) {
    return (
      <div
        style={{
          padding: '0.5rem 0.75rem',
          fontSize: '0.75rem',
          color: 'var(--muted)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--surface)',
        }}
      >
        {t('noCalls')}
      </div>
    )
  }

  const nameFor = (agentId: string) => agents.find((a) => a.id === agentId)?.name ?? agentId

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: '100%',
          padding: '0.625rem 0.875rem',
          background: 'transparent',
          border: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          cursor: 'pointer',
          fontSize: '0.8rem',
          color: 'var(--foreground)',
          fontFamily: 'inherit',
        }}
      >
        <span style={{ fontWeight: 590 }}>{fmtUSD(summary.totalCost)}</span>
        <span style={{ color: 'var(--muted)' }}>·</span>
        <span style={{ color: 'var(--muted)' }}>
          {fmtTokens(summary.totalTokens)} tokens · {summary.callCount} calls
        </span>
        <span
          style={{
            marginLeft: 'auto',
            color: 'var(--muted)',
            fontSize: '0.7rem',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        >
          ▾
        </span>
      </button>

      {expanded && (
        <div style={{ padding: '0.75rem 0.875rem 1rem', borderTop: '1px solid var(--border)' }}>
          <SectionTitle>{t('byModel')}</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginBottom: '1rem' }}>
            {summary.byModel.map((m) => (
              <RowEntry
                key={`${m.provider}:${m.modelId}`}
                label={modelLabel(m.modelId)}
                sublabel={`${m.callCount} ${t('calls')} · in ${fmtTokens(m.inputTokens)} / out ${fmtTokens(m.outputTokens)}`}
                value={fmtUSD(m.cost)}
              />
            ))}
          </div>

          <SectionTitle>{t('byAgent')}</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {[...summary.byAgent]
              .sort((a, b) => b.cost - a.cost)
              .map((a) => (
                <RowEntry
                  key={a.agentId}
                  label={nameFor(a.agentId)}
                  sublabel={`${a.callCount} ${t('calls')} · ${fmtTokens(a.totalTokens)} ${t('tokens')}`}
                  value={fmtUSD(a.cost)}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '0.65rem',
        fontWeight: 590,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--muted)',
        marginBottom: '0.5rem',
      }}
    >
      {children}
    </div>
  )
}

function RowEntry({
  label,
  sublabel,
  value,
}: {
  label: string
  sublabel: string
  value: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        fontSize: '0.8rem',
      }}
    >
      <span style={{ fontWeight: 510 }}>{label}</span>
      <span style={{ color: 'var(--muted)', fontSize: '0.7rem', flex: 1 }}>{sublabel}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 510 }}>{value}</span>
    </div>
  )
}
