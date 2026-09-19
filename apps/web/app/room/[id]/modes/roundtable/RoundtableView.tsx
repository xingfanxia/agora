'use client'

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { TokenCostPanel } from '../../components/TokenCostPanel'
import type { AgentData, MessageData, PollResponse } from '../../components/theme'
import { createAgentColorMap, prefersDark } from '../../components/theme'
import { usePresenceMap } from '../../hooks/usePresenceMap'
import { RoundTable, type RoundTableAgent } from '../../components/v2/RoundTable'
import { ChatSidebar, type ChatSidebarMessage } from '../../components/v2/ChatSidebar'
import { ChatView, type ChatViewMessage } from '../../components/v2/ChatView'
import { AgentDetailModal } from '../../components/v2/AgentDetailModal'
import { PhaseBadge } from '../../components/v2/PhaseBadge'
import { ViewToggle, type ViewMode } from '../../components/v2/ViewToggle'
import { DebateSummary } from '../../components/v2/DebateSummary'
import { WorkflowWarmupBanner } from '../../components/v2/WorkflowWarmupBanner'

interface RoundtableViewProps {
  messages: readonly MessageData[]
  snapshot: Omit<PollResponse, 'messages'>
}

export function RoundtableView({ messages, snapshot }: RoundtableViewProps) {
  const params = useParams()
  const roomId = params.id as string
  const [isDark, setIsDark] = useState(false)
  const [modalAgentId, setModalAgentId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('chat')
  const t = useTranslations('room')
  const tCommon = useTranslations('common')

  useEffect(() => {
    setIsDark(prefersDark())
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const colorFor = useMemo(
    () => createAgentColorMap(snapshot.agents, isDark),
    [snapshot.agents, isDark],
  )

  // Phase 4.5d-3 — per-seat liveness map polled from /presence. See
  // WerewolfView for full rationale.
  const presenceMap = usePresenceMap(roomId)

  const {
    agents,
    topic,
    status,
    currentRound,
    totalRounds,
    thinkingAgentId,
    tokenSummary,
  } = snapshot

  const latestByAgent = useMemo(() => {
    const m = new Map<string, MessageData>()
    for (const msg of messages) {
      if (msg.senderId === 'system') continue
      m.set(msg.senderId, msg)
    }
    return m
  }, [messages])

  const tableAgents: RoundTableAgent[] = useMemo(
    () =>
      agents.map((a) => {
        const latest = latestByAgent.get(a.id)
        return {
          agentId: a.id,
          name: a.name,
          provider: a.provider,
          color: colorFor(a.id),
          latestMessage: latest ? { id: latest.id, content: latest.content } : undefined,
          thinking: thinkingAgentId === a.id,
          speaking: !!latest && thinkingAgentId !== a.id,
          isHuman: a.isHuman ?? false,
          lastSeenAt: presenceMap[a.id] ?? null,
        }
      }),
    [agents, latestByAgent, colorFor, thinkingAgentId, presenceMap],
  )

  const chatMessages: ChatViewMessage[] = useMemo(
    () =>
      messages.map((m) => ({
        id: m.id,
        senderId: m.senderId,
        senderName: m.senderName ?? 'Unknown',
        channelId: m.channelId,
        content: m.content,
        timestamp: m.timestamp,
        isSystem: m.senderId === 'system',
        provider: agents.find((a) => a.id === m.senderId)?.provider,
      })),
    [messages, agents],
  )
  const sidebarMessages: ChatSidebarMessage[] = chatMessages

  const selectedAgent: AgentData | undefined = modalAgentId
    ? agents.find((a) => a.id === modalAgentId)
    : undefined

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        maxWidth: viewMode === 'chat' ? '100%' : 1400,
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
          maxWidth: 1280,
          margin: '0 auto',
          width: '100%',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            marginBottom: '0.5rem',
          }}
        >
          <Link href="/" style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
            {tCommon('appName')}
          </Link>
          <span style={{ color: 'var(--border)', fontSize: '0.8rem' }}>/</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            {t('debateMode')}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            marginBottom: '0.75rem',
            flexWrap: 'wrap',
          }}
        >
          <h1
            style={{
              fontSize: '1.25rem',
              fontWeight: 590,
              letterSpacing: '-0.02em',
              marginRight: 'auto',
            }}
          >
            {topic}
          </h1>
          <ViewToggle mode={viewMode} onChange={setViewMode} chatLabel={t('viewChat')} tableLabel={t('viewTable')} />
        </div>

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
          <span>{t('roundOf', { current: currentRound, total: totalRounds })}</span>
          {/* status === 'lobby' never reaches here — page.tsx routes
              lobby rooms to LobbyView. The narrow cast tells TS what
              the runtime invariant guarantees. */}
          <StatusPill status={status === 'lobby' ? 'running' : status} />
          <span style={{ marginLeft: 'auto' }}>
            {t('agentCount', { count: agents.length })}
          </span>
          <Link
            href={`/room/${roomId}/observability`}
            style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none' }}
          >
            {t('timeline')}
          </Link>
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <TokenCostPanel summary={tokenSummary} agents={agents} />
        </div>
      </header>

      {status === 'running' && latestByAgent.size === 0 && (
        <WorkflowWarmupBanner agents={agents} thinkingAgentId={thinkingAgentId} />
      )}

      {/* Main — chat (default) or round-table */}
      <main
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          display: viewMode === 'table' ? 'grid' : 'block',
          gridTemplateColumns: viewMode === 'table' ? 'minmax(0, 1fr) 340px' : undefined,
        }}
      >
        {viewMode === 'chat' ? (
          <ChatView
            messages={chatMessages}
            getAgentColor={colorFor}
            onAgentClick={setModalAgentId}
          />
        ) : (
          <>
            <section
              style={{
                position: 'relative',
                minHeight: 420,
                overflow: 'hidden',
              }}
            >
              <RoundTable agents={tableAgents} onAgentClick={setModalAgentId}>
                <PhaseBadge
                  phase="debate"
                  label={t('roundOf', { current: currentRound, total: totalRounds })}
                  round={currentRound}
                />
              </RoundTable>
            </section>
            <aside style={{ minHeight: 0, position: 'relative', overflow: 'hidden' }}>
              <ChatSidebar
                messages={sidebarMessages}
                getAgentColor={colorFor}
                title={t('chatTitle')}
              />
            </aside>
          </>
        )}
      </main>

      {status === 'completed' && (
        <>
          <DebateSummary
            topic={snapshot.topic}
            agents={agents}
            messagesPerAgent={useMessagesPerAgent(messages)}
            totalMessages={messages.length}
            totalCost={tokenSummary?.totalCost ?? 0}
            totalTokens={tokenSummary?.totalTokens ?? 0}
            durationSec={null}
            colorFor={colorFor}
          />
          <CompletedFooter messageCount={messages.length} rounds={totalRounds} />
        </>
      )}
      {status === 'error' && <ErrorFooter error={snapshot.error} />}

      {selectedAgent && (
        <AgentDetailModal
          open
          onClose={() => setModalAgentId(null)}
          agent={{
            id: selectedAgent.id,
            name: selectedAgent.name,
            model: selectedAgent.model,
            provider: selectedAgent.provider,
          }}
          color={colorFor(selectedAgent.id)}
          totals={tokenSummary?.byAgent.find((b) => b.agentId === selectedAgent.id)}
          allMessages={chatMessages}
        />
      )}
    </div>
  )
}

function useMessagesPerAgent(messages: readonly MessageData[]): Record<string, number> {
  return useMemo(() => {
    const counts: Record<string, number> = {}
    for (const m of messages) {
      counts[m.senderId] = (counts[m.senderId] ?? 0) + 1
    }
    return counts
  }, [messages])
}

// ── Sub-components (status pill, footers) ──────────────────

// 'lobby' is intentionally excluded — the page-level dispatcher routes
// status='lobby' to LobbyView before this view renders, so StatusPill
// never legitimately sees 'lobby'. Narrowing the input prevents a
// misclassification (the chained ternary would map 'lobby' to the
// red error styling) if a future refactor of page.tsx slips the
// lobby branch.
function StatusPill({ status }: { status: 'running' | 'waiting' | 'completed' | 'error' }) {
  const t = useTranslations('room.status')
  const dotColor =
    status === 'running'
      ? '#22c55e'
      : status === 'waiting'
        ? '#f5a623'
        : status === 'completed'
          ? 'var(--muted)'
          : 'var(--danger)'
  const label =
    status === 'running' ? t('live') : status === 'waiting' ? 'Waiting' : status === 'completed' ? t('completed') : t('error')
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: dotColor,
          animation: status === 'running' ? 'agora-pulse 2s ease-in-out infinite' : 'none',
        }}
      />
      {label}
    </span>
  )
}

function CompletedFooter({
  messageCount,
  rounds,
}: {
  messageCount: number
  rounds: number
}) {
  const t = useTranslations('room')
  return (
    <div
      style={{
        padding: '1rem 1.5rem',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        textAlign: 'center',
        margin: '1rem auto',
        maxWidth: 640,
      }}
    >
      <p style={{ fontSize: '1rem', fontWeight: 590, marginBottom: '0.5rem' }}>
        {t('debateComplete')}
      </p>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>
        {t('messagesAcrossRounds', { messages: messageCount, rounds })}
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
          fontWeight: 510,
          textDecoration: 'none',
        }}
      >
        {t('startNewDebate')}
      </Link>
    </div>
  )
}

function ErrorFooter({ error }: { error?: string }) {
  const t = useTranslations('room')
  return (
    <div
      style={{
        padding: '1rem 1.5rem',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--danger)',
        background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
        textAlign: 'center',
        margin: '1rem auto',
        maxWidth: 640,
      }}
    >
      <p style={{ fontSize: '1rem', fontWeight: 590, color: 'var(--danger)', marginBottom: '0.5rem' }}>
        {t('debateError')}
      </p>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1rem' }}>
        {error ?? t('unexpectedError')}
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
          fontWeight: 510,
          textDecoration: 'none',
        }}
      >
        {t('tryAgain')}
      </Link>
    </div>
  )
}
