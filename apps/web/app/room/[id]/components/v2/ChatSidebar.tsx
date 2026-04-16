// ============================================================
// ChatSidebar — WeChat-style chronological message stream
// ============================================================
//
// Phase 5.4. Right column on desktop (~320px), full-screen drawer on
// mobile (slides in from right). Lists every message across every
// channel with optional channel filter. Auto-scrolls to the bottom on
// new messages unless the user has scrolled up — preserves the
// "reading history" mode.

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentColor } from '../theme'
import { AgentAvatar } from './AgentAvatar'

export interface ChatSidebarMessage {
  id: string
  senderId: string
  senderName: string
  channelId: string
  content: string
  timestamp: number
  isSystem?: boolean
  provider?: string
}

export interface ChatSidebarProps {
  messages: readonly ChatSidebarMessage[]
  /** agentId → color (pre-built via createAgentColorMap). */
  getAgentColor: (agentId: string) => AgentColor
  /** Available channels for the filter dropdown. Omit to hide filter. */
  channels?: readonly { id: string; name: string }[]
  /** Controlled channel filter; null = all channels. */
  channelFilter?: string | null
  onChannelFilterChange?: (channelId: string | null) => void
  /** Title displayed in the header — i18n'd by caller. */
  title?: string
  /** Optional collapse handler. */
  onCollapse?: () => void
}

export function ChatSidebar({
  messages,
  getAgentColor,
  channels,
  channelFilter,
  onChannelFilterChange,
  title = 'Chat',
  onCollapse,
}: ChatSidebarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)

  const filtered = useMemo(
    () => (channelFilter ? messages.filter((m) => m.channelId === channelFilter) : messages),
    [messages, channelFilter],
  )

  // Auto-scroll on new messages only if user is already at the bottom.
  useEffect(() => {
    if (atBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filtered.length, atBottom])

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    setAtBottom(distance < 40)
  }

  return (
    <aside
      aria-label={title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 14px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 590, flex: 1 }}>{title}</span>
        {channels && onChannelFilterChange && (
          <select
            value={channelFilter ?? ''}
            onChange={(e) => onChannelFilterChange(e.target.value || null)}
            style={{
              fontSize: 12,
              padding: '4px 6px',
              background: 'var(--surface-hover)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 4,
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
        {onCollapse && (
          <button
            onClick={onCollapse}
            aria-label="collapse sidebar"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 18,
              color: 'var(--muted)',
              cursor: 'pointer',
              padding: '0 4px',
            }}
          >
            →
          </button>
        )}
      </div>

      {/* Stream */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 4px',
          scrollBehavior: 'smooth',
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 24,
              color: 'var(--muted)',
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            No messages{channelFilter ? ` in #${channelFilter}` : ''} yet.
          </div>
        ) : (
          filtered.map((m) => <Row key={m.id} msg={m} getAgentColor={getAgentColor} />)
        )}
      </div>

      {/* "Jump to latest" pill when scrolled up */}
      {!atBottom && (
        <button
          onClick={() => {
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight
            }
          }}
          style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            padding: '6px 12px',
            borderRadius: 999,
            background: 'var(--accent-strong)',
            color: '#ffffff',
            border: 'none',
            fontSize: 12,
            fontWeight: 510,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            zIndex: 10,
          }}
        >
          ⬇ latest
        </button>
      )}
    </aside>
  )
}

// ── Message row ─────────────────────────────────────────────

function Row({
  msg,
  getAgentColor,
}: {
  msg: ChatSidebarMessage
  getAgentColor: (agentId: string) => AgentColor
}) {
  if (msg.isSystem) {
    return (
      <div
        style={{
          margin: '8px 12px',
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px dashed var(--border)',
          fontSize: 12,
          color: 'var(--muted)',
          fontStyle: 'italic',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
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
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '8px 10px',
        alignItems: 'flex-start',
      }}
    >
      <AgentAvatar name={msg.senderName} provider={msg.provider} color={color} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 6,
            marginBottom: 3,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 590,
              color: color.name,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {msg.senderName}
          </span>
          <span style={{ fontSize: 10, color: 'var(--muted)', flexShrink: 0 }}>
            {new Date(msg.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
        <div
          style={{
            fontSize: isDecision ? 11.5 : 12.5,
            lineHeight: 1.5,
            color: 'var(--foreground)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: isDecision ? 'ui-monospace, monospace' : 'inherit',
            background: isDecision ? 'var(--surface-hover)' : 'transparent',
            padding: isDecision ? '4px 6px' : 0,
            borderRadius: isDecision ? 4 : 0,
          }}
        >
          {msg.content}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
          #{msg.channelId}
        </div>
      </div>
    </div>
  )
}
