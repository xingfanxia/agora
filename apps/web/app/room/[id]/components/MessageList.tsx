'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import type { AgentData, AgentColor, MessageData } from './theme'
import { modelLabel } from './theme'

interface MessageListProps {
  messages: readonly MessageData[]
  agents: readonly AgentData[]
  thinkingAgentId: string | null
  isRunning: boolean
  colorFor: (agentId: string) => AgentColor
  /** Optional filter — if set, only messages from this channel are shown. */
  channelId?: string
  /** Render a custom decoration for system/narrator messages. */
  renderSystem?: (msg: MessageData) => React.ReactNode
}

/**
 * Generic scrollable message feed.
 * Auto-scrolls on new messages. Renders system narrator, decision,
 * and free-text messages with distinct styling.
 */
export function MessageList({
  messages,
  agents,
  thinkingAgentId,
  isRunning,
  colorFor,
  channelId,
  renderSystem,
}: MessageListProps) {
  const t = useTranslations('common')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinkingAgentId])

  const filtered = channelId
    ? messages.filter((m) => m.channelId === channelId)
    : messages

  const thinkingAgent = agents.find((a) => a.id === thinkingAgentId)

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '1rem 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      {filtered.map((message) => {
        if (message.senderId === 'system') {
          return (
            <div key={message.id}>
              {renderSystem ? (
                renderSystem(message)
              ) : (
                <SystemMessage message={message} />
              )}
            </div>
          )
        }

        const colors = colorFor(message.senderId)
        const agent = agents.find((a) => a.id === message.senderId)
        const decision = message.metadata?.['decision']

        return (
          <div
            key={message.id}
            style={{
              padding: '1rem 1.25rem',
              borderRadius: 'var(--radius)',
              border: `1px solid ${colors.border}`,
              background: colors.bg,
            }}
          >
            <MessageHeader
              name={message.senderName}
              modelId={agent?.model}
              colors={colors}
              timestamp={message.timestamp}
              channelId={message.channelId !== 'main' ? message.channelId : undefined}
            />
            {decision ? (
              <DecisionBlock decision={decision} />
            ) : (
              <div
                style={{
                  fontSize: '0.9rem',
                  lineHeight: 1.65,
                  color: 'var(--foreground)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {message.content}
              </div>
            )}
          </div>
        )
      })}

      {thinkingAgent && isRunning && (
        <ThinkingIndicator name={thinkingAgent.name} colors={colorFor(thinkingAgent.id)} />
      )}

      {!thinkingAgent && isRunning && filtered.length === 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3rem',
            color: 'var(--muted)',
            fontSize: '0.9rem',
          }}
        >
          {t('preparing')}
        </div>
      )}

      <div ref={endRef} />
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────

function MessageHeader({
  name,
  modelId,
  colors,
  timestamp,
  channelId,
}: {
  name: string
  modelId?: string
  colors: AgentColor
  timestamp: number
  channelId?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginBottom: '0.625rem',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontWeight: 600, fontSize: '0.875rem', color: colors.name }}>{name}</span>
      {modelId && (
        <span
          style={{
            fontSize: '0.65rem',
            padding: '0.125rem 0.5rem',
            borderRadius: '999px',
            border: `1px solid ${colors.border}`,
            color: colors.name,
            opacity: 0.7,
          }}
        >
          {modelLabel(modelId)}
        </span>
      )}
      {channelId && (
        <span
          style={{
            fontSize: '0.65rem',
            padding: '0.125rem 0.5rem',
            borderRadius: '999px',
            background: 'var(--surface)',
            color: 'var(--muted)',
            fontFamily: 'var(--font-geist-mono), monospace',
          }}
        >
          #{channelId}
        </span>
      )}
      <span
        style={{
          marginLeft: 'auto',
          fontSize: '0.7rem',
          color: 'var(--muted)',
        }}
      >
        {new Date(timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </span>
    </div>
  )
}

function DecisionBlock({ decision }: { decision: unknown }) {
  return (
    <pre
      style={{
        margin: 0,
        fontSize: '0.8rem',
        lineHeight: 1.5,
        color: 'var(--foreground)',
        fontFamily: 'var(--font-geist-mono), monospace',
        background: 'var(--surface)',
        padding: '0.625rem 0.75rem',
        borderRadius: '6px',
        overflowX: 'auto',
      }}
    >
      {JSON.stringify(decision, null, 2)}
    </pre>
  )
}

function SystemMessage({ message }: { message: MessageData }) {
  return (
    <div
      style={{
        padding: '0.75rem 1rem',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface)',
        border: '1px dashed var(--border)',
        fontSize: '0.825rem',
        color: 'var(--muted)',
        fontStyle: 'italic',
      }}
    >
      <span style={{ fontWeight: 600, color: 'var(--foreground)', fontStyle: 'normal' }}>
        {message.senderName}:
      </span>{' '}
      {message.content}
    </div>
  )
}

function ThinkingIndicator({ name, colors }: { name: string; colors: AgentColor }) {
  const t = useTranslations('common')
  return (
    <div
      style={{
        padding: '1rem 1.25rem',
        borderRadius: 'var(--radius)',
        border: `1px dashed ${colors.border}`,
        background: colors.bg,
        opacity: 0.7,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          color: colors.name,
          fontSize: '0.875rem',
        }}
      >
        <span style={{ fontWeight: 600 }}>{name}</span>
        <span style={{ fontSize: '0.8rem' }}>{t('isThinking')}</span>
        <span
          style={{
            animation: 'dots 1.5s steps(4, end) infinite',
            letterSpacing: '2px',
          }}
        >
          ...
        </span>
      </div>
    </div>
  )
}
