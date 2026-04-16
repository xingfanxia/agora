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
            className="agora-chat-message"
            style={{
              padding: '12px 16px',
              borderRadius: 'var(--radius-panel)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
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
                  fontSize: 16,
                  fontWeight: 400,
                  lineHeight: 1.6,
                  color: 'var(--foreground-secondary)',
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
        gap: 8,
        marginBottom: 6,
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          fontWeight: 590,
          fontSize: 13,
          letterSpacing: '-0.13px',
          color: colors.name,
        }}
      >
        {name}
      </span>
      {modelId && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 400,
            padding: '1px 8px',
            borderRadius: 4,
            background: 'rgba(255, 255, 255, 0.04)',
            color: 'var(--muted)',
          }}
        >
          {modelLabel(modelId)}
        </span>
      )}
      {channelId && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 400,
            padding: '1px 8px',
            borderRadius: 4,
            background: 'rgba(255, 255, 255, 0.04)',
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
          fontSize: 11,
          fontWeight: 400,
          color: 'var(--muted-strong)',
          fontVariantNumeric: 'tabular-nums',
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
        padding: '12px 16px',
        borderRadius: 'var(--radius-panel)',
        border: '1px dashed var(--border)',
        background: 'var(--surface)',
        opacity: 0.8,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          letterSpacing: '-0.13px',
        }}
      >
        <span style={{ fontWeight: 590, color: colors.name }}>{name}</span>
        <span style={{ color: 'var(--muted)' }}>{t('isThinking')}</span>
        <span
          style={{
            color: 'var(--muted)',
            animation: 'agora-dot-pulse 1.5s ease-in-out infinite',
            letterSpacing: '2px',
          }}
        >
          ...
        </span>
      </div>
    </div>
  )
}
