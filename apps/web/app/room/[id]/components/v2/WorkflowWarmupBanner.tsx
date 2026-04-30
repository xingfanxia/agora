'use client'

// Warmup banner — shown after `start` is clicked but before the first
// agent message lands. Workflow startup (initializeGameState + first
// phase's first LLM call) takes 30-90s in production; without a hint
// the user sees a blank room and assumes it's broken. Filters out
// system messages so it stays visible while the workflow has only
// emitted scaffolding (room:started, dawn announcement, etc.) but no
// agent content yet.
//
// Cross-mode: same shape works for werewolf (initializeGameState +
// first night step), roundtable (first agent's reply), and open-chat
// (first agent's reply). thinkingAgentId, when set, lets us name the
// agent — much less alarming than a generic "thinking" pulse.

import { useTranslations } from 'next-intl'
import type { AgentData } from '../theme'

interface Props {
  agents: readonly AgentData[]
  thinkingAgentId: string | null
}

export function WorkflowWarmupBanner({ agents, thinkingAgentId }: Props) {
  const t = useTranslations('room.warmup')

  const thinkingAgent = thinkingAgentId
    ? agents.find((a) => a.id === thinkingAgentId)
    : null

  const headline = thinkingAgent
    ? t('agentThinking', { name: thinkingAgent.name })
    : thinkingAgentId
      ? t('thinking')
      : t('initializing')

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        margin: '1rem auto 0',
        maxWidth: 1280,
        width: '100%',
        padding: '0.875rem 1.125rem',
        borderRadius: 'var(--radius)',
        background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--border))',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        fontSize: '0.875rem',
      }}
    >
      <Spinner />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 590, marginBottom: 2 }}>{headline}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{t('hint')}</div>
      </div>
    </div>
  )
}

// Three-dot pulse, framework-free. Matches the existing
// agora-pulse animation used by the StatusPill (defined in
// the global stylesheet).
function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--accent)',
            animation: 'agora-pulse 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </span>
  )
}
