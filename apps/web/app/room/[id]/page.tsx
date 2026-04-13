'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

// ── Types for the poll response ─────────────────────────────

interface MessageData {
  id: string
  roomId: string
  senderId: string
  senderName: string
  content: string
  channelId: string
  timestamp: number
}

interface AgentData {
  id: string
  name: string
  model: string
  provider: string
}

interface PollResponse {
  messages: MessageData[]
  status: 'running' | 'completed' | 'error'
  currentRound: number
  totalRounds: number
  thinkingAgentId: string | null
  agents: AgentData[]
  topic: string
  error?: string
}

// ── Agent color palette ─────────────────────────────────────

interface AgentColor {
  bg: string
  border: string
  name: string
}

const AGENT_COLORS: AgentColor[] = [
  { bg: '#f0f4ff', border: '#c7d6f7', name: '#2952a3' },
  { bg: '#fdf2f0', border: '#f5c6bc', name: '#a33929' },
  { bg: '#f0faf4', border: '#b8e6c9', name: '#29734a' },
  { bg: '#faf5f0', border: '#e8d5b8', name: '#8c6a3a' },
  { bg: '#f5f0fa', border: '#d3c1e6', name: '#5e3a8c' },
  { bg: '#f0f9fa', border: '#b8dee6', name: '#2a6b7a' },
  { bg: '#faf0f5', border: '#e6b8d3', name: '#8c3a5e' },
  { bg: '#f9faf0', border: '#dee6b8', name: '#6b7a2a' },
]

const AGENT_COLORS_DARK: AgentColor[] = [
  { bg: '#111827', border: '#1e3a5f', name: '#6b9eff' },
  { bg: '#1c1210', border: '#5f1e1e', name: '#ff7b6b' },
  { bg: '#101c14', border: '#1e5f2e', name: '#6bff8a' },
  { bg: '#1c1810', border: '#5f4a1e', name: '#ffcc6b' },
  { bg: '#18101c', border: '#3e1e5f', name: '#c06bff' },
  { bg: '#101a1c', border: '#1e4a5f', name: '#6be5ff' },
  { bg: '#1c1018', border: '#5f1e4a', name: '#ff6bc0' },
  { bg: '#1a1c10', border: '#4a5f1e', name: '#c0ff6b' },
]

const FALLBACK_COLOR: AgentColor = { bg: '#f0f4ff', border: '#c7d6f7', name: '#2952a3' }

// ── Model badge labels ──────────────────────────────────────

const MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-4-20250514': 'Claude Sonnet 4',
  'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-2.0-pro': 'Gemini 2.0 Pro',
  'deepseek-chat': 'DeepSeek Chat',
}

// ── Component ───────────────────────────────────────────────

export default function RoomPage() {
  const params = useParams()
  const roomId = params.id as string

  const [messages, setMessages] = useState<MessageData[]>([])
  const [status, setStatus] = useState<'running' | 'completed' | 'error'>('running')
  const [currentRound, setCurrentRound] = useState(1)
  const [totalRounds, setTotalRounds] = useState(1)
  const [thinkingAgentId, setThinkingAgentId] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentData[]>([])
  const [topic, setTopic] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [isDark, setIsDark] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const lastTimestampRef = useRef(0)

  // Detect dark mode
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setIsDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const colorPalette = isDark ? AGENT_COLORS_DARK : AGENT_COLORS

  // Build agent-to-color index map
  const agentColorMap = useCallback(
    (agentId: string): AgentColor => {
      const index = agents.findIndex((a) => a.id === agentId)
      const colorIndex = index >= 0 ? index % colorPalette.length : 0
      return colorPalette[colorIndex] ?? FALLBACK_COLOR
    },
    [agents, colorPalette],
  )

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinkingAgentId])

  // Poll for messages
  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const after = lastTimestampRef.current
        const res = await fetch(`/api/rooms/${roomId}/messages?after=${after}`)

        if (!res.ok) {
          const data = await res.json()
          setErrorMsg(data.error || 'Failed to load room')
          setLoading(false)
          return
        }

        const data: PollResponse = await res.json()

        if (!cancelled) {
          if (data.messages.length > 0) {
            setMessages((prev) => {
              const existingIds = new Set(prev.map((m) => m.id))
              const newMessages = data.messages.filter((m) => !existingIds.has(m.id))
              if (newMessages.length === 0) return prev
              const nextMessages = [...prev, ...newMessages]
              lastTimestampRef.current = Math.max(
                ...nextMessages.map((m) => m.timestamp),
              )
              return nextMessages
            })
          }

          setStatus(data.status)
          setCurrentRound(data.currentRound)
          setTotalRounds(data.totalRounds)
          setThinkingAgentId(data.thinkingAgentId)
          setAgents(data.agents)
          setTopic(data.topic)
          if (data.error) setErrorMsg(data.error)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setErrorMsg('Connection lost. Retrying...')
        }
      }

      // Continue polling if still running
      if (!cancelled) {
        const delay = status === 'running' ? 1000 : 5000
        setTimeout(poll, delay)
      }
    }

    poll()

    return () => {
      cancelled = true
    }
  }, [roomId, status])

  // Get the thinking agent's name
  const thinkingAgent = agents.find((a) => a.id === thinkingAgentId)

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        color: 'var(--muted)',
        fontSize: '1rem',
      }}>
        Loading debate...
      </div>
    )
  }

  if (errorMsg && messages.length === 0) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: '1rem',
      }}>
        <p style={{ color: 'var(--danger)', fontSize: '1rem' }}>{errorMsg}</p>
        <Link href="/create" style={{
          padding: '0.625rem 1.25rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.875rem',
        }}>
          Back to Create
        </Link>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      maxWidth: '800px',
      margin: '0 auto',
      padding: '0 1rem',
    }}>
      {/* Header */}
      <header style={{
        padding: '1rem 0',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '0.5rem',
        }}>
          <Link href="/" style={{
            color: 'var(--muted)',
            fontSize: '0.8rem',
          }}>
            Agora
          </Link>
          <span style={{ color: 'var(--border)', fontSize: '0.8rem' }}>/</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Debate</span>
        </div>

        <h1 style={{
          fontSize: '1.25rem',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          marginBottom: '0.5rem',
        }}>
          {topic}
        </h1>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          fontSize: '0.8rem',
          color: 'var(--muted)',
        }}>
          <span>
            Round {currentRound} of {totalRounds}
          </span>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
          }}>
            <span style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: status === 'running' ? '#22c55e' : status === 'completed' ? 'var(--muted)' : 'var(--danger)',
              animation: status === 'running' ? 'pulse 2s ease-in-out infinite' : 'none',
            }} />
            {status === 'running' ? 'Live' : status === 'completed' ? 'Completed' : 'Error'}
          </span>
          <span style={{ marginLeft: 'auto' }}>
            {agents.length} agents
          </span>
        </div>
      </header>

      {/* Agent pills */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        padding: '0.75rem 0',
        overflowX: 'auto',
        flexShrink: 0,
      }}>
        {agents.map((agent) => {
          const colors = agentColorMap(agent.id)
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
              }}
            >
              <span>{agent.name}</span>
              <span style={{
                fontSize: '0.65rem',
                opacity: 0.7,
              }}>
                {MODEL_LABELS[agent.model] || agent.model}
              </span>
            </div>
          )
        })}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '1rem 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}>
        {messages.map((message) => {
          const colors = agentColorMap(message.senderId)
          const agent = agents.find((a) => a.id === message.senderId)

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
              {/* Message header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '0.625rem',
              }}>
                <span style={{
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  color: colors.name,
                }}>
                  {message.senderName}
                </span>
                {agent && (
                  <span style={{
                    fontSize: '0.65rem',
                    padding: '0.125rem 0.5rem',
                    borderRadius: '999px',
                    border: `1px solid ${colors.border}`,
                    color: colors.name,
                    opacity: 0.7,
                  }}>
                    {MODEL_LABELS[agent.model] || agent.model}
                  </span>
                )}
                <span style={{
                  marginLeft: 'auto',
                  fontSize: '0.7rem',
                  color: 'var(--muted)',
                }}>
                  {new Date(message.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>

              {/* Message content */}
              <div style={{
                fontSize: '0.9rem',
                lineHeight: 1.65,
                color: 'var(--foreground)',
                whiteSpace: 'pre-wrap',
              }}>
                {message.content}
              </div>
            </div>
          )
        })}

        {/* Thinking indicator */}
        {thinkingAgent && status === 'running' && (
          <div style={{
            padding: '1rem 1.25rem',
            borderRadius: 'var(--radius)',
            border: `1px dashed ${agentColorMap(thinkingAgent.id).border}`,
            background: agentColorMap(thinkingAgent.id).bg,
            opacity: 0.7,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: agentColorMap(thinkingAgent.id).name,
              fontSize: '0.875rem',
            }}>
              <span style={{ fontWeight: 600 }}>{thinkingAgent.name}</span>
              <span style={{ fontSize: '0.8rem' }}>is thinking</span>
              <span style={{ animation: 'dots 1.5s steps(4, end) infinite', letterSpacing: '2px' }}>
                ...
              </span>
            </div>
          </div>
        )}

        {/* Waiting indicator when running with no thinking agent */}
        {!thinkingAgent && status === 'running' && messages.length === 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3rem',
            color: 'var(--muted)',
            fontSize: '0.9rem',
          }}>
            Preparing debate...
          </div>
        )}

        {/* Debate ended */}
        {status === 'completed' && (
          <div style={{
            padding: '1.5rem',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            textAlign: 'center',
          }}>
            <p style={{
              fontSize: '1rem',
              fontWeight: 600,
              marginBottom: '0.5rem',
            }}>
              Debate Complete
            </p>
            <p style={{
              fontSize: '0.85rem',
              color: 'var(--muted)',
              marginBottom: '1rem',
            }}>
              {messages.length} messages across {totalRounds} rounds
            </p>
            <Link href="/create" style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.625rem 1.25rem',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--foreground)',
              color: 'var(--background)',
              fontSize: '0.875rem',
              fontWeight: 500,
              textDecoration: 'none',
            }}>
              Start New Debate
            </Link>
          </div>
        )}

        {/* Error state */}
        {status === 'error' && (
          <div style={{
            padding: '1.5rem',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--danger)',
            background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
            textAlign: 'center',
          }}>
            <p style={{
              fontSize: '1rem',
              fontWeight: 600,
              color: 'var(--danger)',
              marginBottom: '0.5rem',
            }}>
              Debate Error
            </p>
            <p style={{
              fontSize: '0.85rem',
              color: 'var(--muted)',
              marginBottom: '1rem',
            }}>
              {errorMsg || 'An unexpected error occurred during the debate.'}
            </p>
            <Link href="/create" style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.625rem 1.25rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              fontSize: '0.875rem',
              fontWeight: 500,
              textDecoration: 'none',
            }}>
              Try Again
            </Link>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Inline keyframes */}
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
