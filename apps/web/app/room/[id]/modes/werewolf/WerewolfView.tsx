'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { MessageList } from '../../components/MessageList'
import { AgentList } from '../../components/AgentList'
import { TokenCostPanel } from '../../components/TokenCostPanel'
import { ChannelTabs } from '../../components/ChannelTabs'
import { PhaseIndicator } from '../../components/PhaseIndicator'
import type { AgentData, MessageData, PollResponse } from '../../components/theme'
import { createAgentColorMap, prefersDark } from '../../components/theme'

interface WerewolfViewProps {
  messages: readonly MessageData[]
  snapshot: Omit<PollResponse, 'messages'>
}

// ── Label maps ───────────────────────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  sheriffElection: 'Sheriff Election',
  sheriffElected: 'Sheriff Announced',
  guardProtect: 'Guard Protecting',
  wolfDiscuss: 'Wolves Conspire',
  wolfVote: 'Wolves Vote',
  witchAction: 'Witch Acts',
  seerCheck: 'Seer Investigates',
  dawn: 'Dawn',
  dayDiscuss: 'Day Discussion',
  dayVote: 'Day Vote',
  lastWords: 'Last Words',
  gameOver: 'Game Over',
}

const ROLE_EMOJI: Record<string, string> = {
  werewolf: '🐺',
  seer: '🔮',
  witch: '🧪',
  hunter: '🏹',
  guard: '🛡️',
  idiot: '🃏',
  villager: '👤',
}

const CHANNEL_LABELS: Record<string, string> = {
  main: 'Day (public)',
  werewolf: '🐺 Wolves',
  'seer-result': '🔮 Seer',
  'witch-action': '🧪 Witch',
  'wolf-vote': '🗳️ Wolf Vote',
  'day-vote': '🗳️ Day Vote',
  'guard-action': '🛡️ Guard',
}

function isNightPhase(phase: string | null): boolean {
  if (!phase) return false
  return ['wolfDiscuss', 'wolfVote', 'witchAction', 'seerCheck', 'guardProtect'].includes(phase)
}

// ── View ─────────────────────────────────────────────────────

export function WerewolfView({ messages, snapshot }: WerewolfViewProps) {
  const params = useParams()
  const roomId = params.id as string
  const [isDark, setIsDark] = useState(false)
  const [activeChannel, setActiveChannel] = useState('main')

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

  const {
    agents,
    status,
    thinkingAgentId,
    tokenSummary,
    currentPhase,
    roleAssignments,
    advancedRules,
    gameState,
  } = snapshot

  // Which channels have ever been populated with messages? Only show populated + main.
  const discoveredChannels = useMemo(() => {
    const seen = new Set<string>(['main'])
    for (const m of messages) seen.add(m.channelId)
    return [...seen]
  }, [messages])

  const eliminatedIds = useMemo(() => {
    const raw = gameState?.['eliminatedIds']
    return Array.isArray(raw) ? new Set(raw as string[]) : new Set<string>()
  }, [gameState])

  const winResult = (gameState?.['winResult'] as string | undefined) ?? null

  const isNight = isNightPhase(currentPhase)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        maxWidth: '960px',
        margin: '0 auto',
        padding: '0 1rem',
        // Subtle night-mode tint
        background: isNight
          ? 'linear-gradient(180deg, color-mix(in srgb, #0b1020 30%, transparent), transparent 40%)'
          : 'transparent',
        transition: 'background 0.4s ease',
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: '1rem 0',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <Link href="/" style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
            Agora
          </Link>
          <span style={{ color: 'var(--border)', fontSize: '0.8rem' }}>/</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>Werewolf</span>
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
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.02em' }}>
            Werewolf
          </h1>
          <PhaseIndicator
            phase={currentPhase}
            labelMap={PHASE_LABELS}
            accent={isNight ? '#4a4282' : undefined}
          />
          <StatusPill status={status} />
          {advancedRules && (
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginLeft: 'auto' }}>
              {Object.entries(advancedRules)
                .filter(([, v]) => v)
                .map(([k]) => k)
                .join(' · ') || 'base game'}
            </span>
          )}
          <Link
            href={`/room/${roomId}/observability`}
            style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none' }}
          >
            Timeline →
          </Link>
        </div>

        <TokenCostPanel summary={tokenSummary} agents={agents} />
      </header>

      {/* Winner banner */}
      {winResult && (
        <div
          style={{
            marginTop: '1rem',
            padding: '1rem 1.25rem',
            borderRadius: 'var(--radius)',
            background:
              winResult === 'village_wins'
                ? 'color-mix(in srgb, #22c55e 15%, transparent)'
                : 'color-mix(in srgb, var(--danger) 15%, transparent)',
            border: `1px solid ${winResult === 'village_wins' ? '#22c55e' : 'var(--danger)'}`,
            fontWeight: 700,
            fontSize: '1rem',
          }}
        >
          {winResult === 'village_wins' ? '🎉 Village Wins' : '🐺 Werewolves Win'}
        </div>
      )}

      {/* Agent list with role badges */}
      <WerewolfAgentList
        agents={agents}
        thinkingAgentId={thinkingAgentId}
        colorFor={colorFor}
        roleAssignments={roleAssignments}
        eliminatedIds={eliminatedIds}
      />

      {/* Channel tabs */}
      <ChannelTabs
        channels={discoveredChannels.map((id) => ({
          id,
          label: CHANNEL_LABELS[id] ?? `#${id}`,
        }))}
        activeChannelId={activeChannel}
        onChange={setActiveChannel}
      />

      {/* Messages (filtered to active channel) */}
      <MessageList
        messages={messages}
        agents={agents}
        thinkingAgentId={thinkingAgentId}
        isRunning={status === 'running'}
        colorFor={colorFor}
        channelId={activeChannel}
      />

      {status === 'completed' && !winResult && (
        <EndMessage text="Game ended without a clear winner." />
      )}

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

// ── Helper components ────────────────────────────────────────

function WerewolfAgentList({
  agents,
  thinkingAgentId,
  colorFor,
  roleAssignments,
  eliminatedIds,
}: {
  agents: readonly AgentData[]
  thinkingAgentId: string | null
  colorFor: ReturnType<typeof createAgentColorMap>
  roleAssignments: Record<string, string> | null
  eliminatedIds: Set<string>
}) {
  return (
    <AgentList
      agents={agents.map((a) => ({
        ...a,
        // Strike name if eliminated — done via renderExtra below instead
      }))}
      thinkingAgentId={thinkingAgentId}
      colorFor={colorFor}
      renderExtra={(agent) => {
        const role = roleAssignments?.[agent.id]
        const dead = eliminatedIds.has(agent.id)
        return (
          <>
            {role && (
              <span
                title={role}
                style={{
                  fontSize: '0.85rem',
                  marginLeft: '0.1rem',
                  filter: dead ? 'grayscale(1) opacity(0.5)' : 'none',
                }}
              >
                {ROLE_EMOJI[role] ?? '·'}
              </span>
            )}
            {dead && (
              <span
                style={{
                  fontSize: '0.65rem',
                  padding: '0.08rem 0.375rem',
                  borderRadius: '999px',
                  background: 'var(--surface)',
                  color: 'var(--danger)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  fontWeight: 600,
                }}
              >
                dead
              </span>
            )}
          </>
        )
      }}
    />
  )
}

function StatusPill({ status }: { status: 'running' | 'completed' | 'error' }) {
  const dotColor =
    status === 'running' ? '#22c55e' : status === 'completed' ? 'var(--muted)' : 'var(--danger)'
  const label = status === 'running' ? 'Live' : status === 'completed' ? 'Completed' : 'Error'

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
      <span
        style={{
          display: 'inline-block',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: dotColor,
          animation: status === 'running' ? 'pulse 2s ease-in-out infinite' : 'none',
        }}
      />
      {label}
    </span>
  )
}

function EndMessage({ text }: { text: string }) {
  return (
    <div
      style={{
        margin: '1rem 0',
        padding: '1rem 1.25rem',
        borderRadius: 'var(--radius)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        color: 'var(--muted)',
        fontSize: '0.9rem',
        textAlign: 'center',
      }}
    >
      {text}
    </div>
  )
}
