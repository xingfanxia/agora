// ============================================================
// ChatView — full-width chat transcript (Accio-style)
// ============================================================
//
// Replaces the cramped ChatSidebar for the primary viewing mode.
// Agent messages render as markdown on the page surface (no bubble
// container) per Accio pattern — long content flows naturally
// instead of being clamped or wrapped in a bubble that can't handle
// headings, lists, or bold text.
//
// Used by RoundtableView + WerewolfView when view mode = 'chat'
// (the default). ChatSidebar (narrow, bubbled) is still used in
// 'table' mode as a side panel.

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentColor } from '../theme'
import { AgentAvatar } from './AgentAvatar'

export interface ChatViewMessage {
  id: string
  senderId: string
  senderName: string
  channelId: string
  content: string
  timestamp: number
  isSystem?: boolean
  provider?: string
}

export interface ChatViewProps {
  messages: readonly ChatViewMessage[]
  /** agentId → color (pre-built via createAgentColorMap). */
  getAgentColor: (agentId: string) => AgentColor
  /** Available channels for the filter dropdown. Omit to hide filter. */
  channels?: readonly { id: string; name: string }[]
  /** Controlled channel filter; null = all channels. */
  channelFilter?: string | null
  onChannelFilterChange?: (channelId: string | null) => void
  /** Called when the user clicks an agent's avatar/name header. */
  onAgentClick?: (agentId: string) => void
  /** Optional content rendered in the header next to the channel filter
   * (e.g., phase badge, view mode toggle). */
  headerExtra?: React.ReactNode
}

export function ChatView({
  messages,
  getAgentColor,
  channels,
  channelFilter,
  onChannelFilterChange,
  onAgentClick,
  headerExtra,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)

  const filtered = useMemo(
    () => (channelFilter ? messages.filter((m) => m.channelId === channelFilter) : messages),
    [messages, channelFilter],
  )

  useEffect(() => {
    if (atBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filtered.length, atBottom])

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setAtBottom(distance < 80)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        position: 'relative',
      }}
    >
      {/* Top bar: channel filter + header extras (view toggle, etc.) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        {channels && onChannelFilterChange && channels.length > 1 && (
          <select
            value={channelFilter ?? ''}
            onChange={(e) => onChannelFilterChange(e.target.value || null)}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              background: 'var(--surface-hover)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            <option value="">all channels</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {headerExtra}
        </div>
      </div>

      {/* Message stream */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          scrollBehavior: 'smooth',
          padding: '24px 0 48px',
        }}
      >
        <div
          style={{
            maxWidth: 780,
            margin: '0 auto',
            padding: '0 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                padding: 40,
                textAlign: 'center',
                color: 'var(--muted)',
                fontSize: 13,
              }}
            >
              No messages{channelFilter ? ` in #${channelFilter}` : ''} yet.
            </div>
          ) : (
            filtered.map((m) => (
              <MessageBlock
                key={m.id}
                msg={m}
                getAgentColor={getAgentColor}
                onAgentClick={onAgentClick}
              />
            ))
          )}
        </div>
      </div>

      {/* Jump-to-latest pill */}
      {!atBottom && (
        <button
          onClick={() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight
            }
          }}
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 14px',
            borderRadius: 999,
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            fontSize: 12,
            fontWeight: 510,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 10,
          }}
        >
          ⬇ latest
        </button>
      )}
    </div>
  )
}

// ── Message block ──────────────────────────────────────────

function MessageBlock({
  msg,
  getAgentColor,
  onAgentClick,
}: {
  msg: ChatViewMessage
  getAgentColor: (agentId: string) => AgentColor
  onAgentClick?: (agentId: string) => void
}) {
  if (msg.isSystem) {
    return (
      <div
        style={{
          padding: '8px 16px',
          borderRadius: 8,
          border: '1px dashed var(--border)',
          fontSize: 12.5,
          color: 'var(--muted)',
          fontStyle: 'italic',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          maxWidth: 520,
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        {msg.content}
      </div>
    )
  }

  const color = getAgentColor(msg.senderId)
  const isDecision =
    msg.content.trim().startsWith('{') && msg.content.trim().endsWith('}')

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div
        onClick={onAgentClick ? () => onAgentClick(msg.senderId) : undefined}
        style={{ cursor: onAgentClick ? 'pointer' : 'default', flexShrink: 0 }}
      >
        <AgentAvatar name={msg.senderName} provider={msg.provider} color={color} size={40} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span
            onClick={onAgentClick ? () => onAgentClick(msg.senderId) : undefined}
            style={{
              fontSize: 13,
              fontWeight: 590,
              color: color.name,
              cursor: onAgentClick ? 'pointer' : 'default',
            }}
          >
            {msg.senderName}
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {new Date(msg.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span
            style={{
              fontSize: 10,
              color: 'var(--muted)',
              fontFamily: 'ui-monospace, monospace',
              padding: '1px 6px',
              borderRadius: 4,
              background: 'var(--surface-hover)',
            }}
          >
            #{msg.channelId}
          </span>
        </div>
        {isDecision ? (
          <DecisionBlock content={msg.content} />
        ) : (
          <div
            className="agora-markdown"
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: 'var(--foreground)',
              wordBreak: 'break-word',
            }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}

function DecisionBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  let summary: string | null = null
  try {
    const obj = JSON.parse(content) as Record<string, unknown>
    if (typeof obj['target'] === 'string') {
      const reason = typeof obj['reason'] === 'string' ? ` — ${obj['reason']}` : ''
      summary = `→ ${String(obj['target'])}${reason}`
    } else if (typeof obj['action'] === 'string') {
      const reason = typeof obj['reason'] === 'string' ? ` — ${obj['reason']}` : ''
      summary = `${String(obj['action'])}${reason}`
    } else if (typeof obj['speech'] === 'string') {
      summary = String(obj['speech'])
    }
  } catch {
    /* fallthrough */
  }
  const display = summary ?? content
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 12px',
        background: 'var(--surface-hover)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: 6,
        fontFamily: summary ? 'inherit' : 'ui-monospace, monospace',
        fontSize: summary ? 13 : 11.5,
        color: 'var(--foreground)',
        maxWidth: 600,
      }}
    >
      <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {expanded ? content : display}
      </span>
      {summary && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            alignSelf: 'flex-start',
            fontSize: 10,
            opacity: 0.7,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            color: 'var(--muted)',
            textDecoration: 'underline',
          }}
        >
          {expanded ? 'hide raw' : 'show raw decision'}
        </button>
      )}
    </div>
  )
}
