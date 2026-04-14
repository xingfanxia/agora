'use client'

import type { AgentColor, AgentData } from './theme'
import { modelLabel } from './theme'

interface AgentListProps {
  agents: readonly AgentData[]
  thinkingAgentId?: string | null
  colorFor: (agentId: string) => AgentColor
  /** Optional extra content per agent (roles, stats, etc.) */
  renderExtra?: (agent: AgentData) => React.ReactNode
}

/**
 * Horizontal pill strip of agents — name + model badge.
 * Used in any mode to show participants.
 */
export function AgentList({ agents, thinkingAgentId, colorFor, renderExtra }: AgentListProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        padding: '0.75rem 0',
        overflowX: 'auto',
        flexShrink: 0,
      }}
    >
      {agents.map((agent) => {
        const colors = colorFor(agent.id)
        const isThinking = agent.id === thinkingAgentId

        return (
          <div
            key={agent.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              padding: '0.375rem 0.75rem',
              borderRadius: '999px',
              border: `1px solid ${colors.border}`,
              background: colors.bg,
              fontSize: '0.75rem',
              fontWeight: 500,
              color: colors.name,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              opacity: isThinking ? 1 : 0.95,
              boxShadow: isThinking ? `0 0 0 2px ${colors.border}` : undefined,
              transition: 'box-shadow 0.15s ease',
            }}
          >
            <span>{agent.name}</span>
            <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>{modelLabel(agent.model)}</span>
            {renderExtra?.(agent)}
          </div>
        )
      })}
    </div>
  )
}
