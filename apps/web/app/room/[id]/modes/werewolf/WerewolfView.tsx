'use client'

import { useEffect, useMemo, useState } from 'react'
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
import { WerewolfSummary } from '../../components/v2/WerewolfSummary'
import { WorkflowWarmupBanner } from '../../components/v2/WorkflowWarmupBanner'

interface WerewolfViewProps {
  messages: readonly MessageData[]
  snapshot: Omit<PollResponse, 'messages'>
  /**
   * The agent id the human player occupies (from localStorage seat
   * token). When set, we surface a "your role" banner and let the
   * UI key off the human's role for filtering / hints. Spectators
   * and un-seated owners pass null.
   */
  humanAgentId?: string | null
}

function isNightPhase(phase: string | null): boolean {
  if (!phase) return false
  return [
    'wolfDiscuss',
    'wolfVote',
    'witchAction',
    'seerCheck',
    'guardProtect',
    'dawn',
  ].includes(phase)
}

// Human-readable role badge: emoji + role + faction. Used in the
// "your role" banner shown to seated humans. Faction matters for
// role-relative hints ("you win when all wolves die" vs. "...all
// villagers die").
const ROLE_DISPLAY: Record<
  string,
  { emoji: string; faction: 'village' | 'werewolves'; label: string }
> = {
  werewolf: { emoji: '🐺', faction: 'werewolves', label: '狼人' },
  villager: { emoji: '👤', faction: 'village', label: '村民' },
  seer: { emoji: '🔮', faction: 'village', label: '预言家' },
  witch: { emoji: '🧪', faction: 'village', label: '女巫' },
  hunter: { emoji: '🏹', faction: 'village', label: '猎人' },
  guard: { emoji: '🛡️', faction: 'village', label: '守卫' },
  idiot: { emoji: '🃏', faction: 'village', label: '白痴' },
}

const RULE_LABEL_ZH: Record<string, string> = {
  guard: '守卫',
  idiot: '白痴',
  sheriff: '警长',
  lastWords: '遗言',
}

export function WerewolfView({ messages, snapshot, humanAgentId }: WerewolfViewProps) {
  const params = useParams()
  const roomId = params.id as string
  const [isDark, setIsDark] = useState(false)
  const [channelFilter, setChannelFilter] = useState<string | null>(null)
  const [modalAgentId, setModalAgentId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('chat')
  const t = useTranslations('werewolf')
  const tCommon = useTranslations('common')
  const tRoom = useTranslations('room')

  const phaseLabels = useMemo(
    () => ({
      sheriffElection: t('phases.sheriffElection'),
      sheriffElected: t('phases.sheriffElected'),
      guardProtect: t('phases.guardProtect'),
      wolfDiscuss: t('phases.wolfDiscuss'),
      wolfVote: t('phases.wolfVote'),
      witchAction: t('phases.witchAction'),
      seerCheck: t('phases.seerCheck'),
      dawn: t('phases.dawn'),
      dayDiscuss: t('phases.dayDiscuss'),
      dayVote: t('phases.dayVote'),
      lastWords: t('phases.lastWords'),
      gameOver: t('phases.gameOver'),
    }),
    [t],
  )

  const channelLabels: Record<string, string> = useMemo(
    () => ({
      main: t('channels.main'),
      werewolf: t('channels.werewolf'),
      'seer-result': t('channels.seerResult'),
      'witch-action': t('channels.witchAction'),
      'wolf-vote': t('channels.wolfVote'),
      'day-vote': t('channels.dayVote'),
      'guard-action': t('channels.guardAction'),
    }),
    [t],
  )

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

  // Phase 4.5d-3 — per-seat liveness map polled from /presence. Drives
  // SeatPresenceIndicator in AgentSeat. Hook is visibility-aware and
  // non-fatal on transient errors; safe to call even for spectators.
  const presenceMap = usePresenceMap(roomId)

  const {
    agents,
    status,
    thinkingAgentId,
    tokenSummary,
    currentPhase,
    currentRound,
    roleAssignments,
    advancedRules,
    gameState,
  } = snapshot

  const discoveredChannels = useMemo(() => {
    const seen = new Set<string>(['main'])
    for (const m of messages) seen.add(m.channelId)
    return [...seen].map((id) => ({ id, name: channelLabels[id] ?? `#${id}` }))
  }, [messages, channelLabels])

  const eliminatedIds = useMemo(() => {
    const raw = gameState?.['eliminatedIds']
    return Array.isArray(raw) ? new Set(raw as string[]) : new Set<string>()
  }, [gameState])

  const winResult = (gameState?.['winResult'] as string | undefined) ?? null
  const isNight = isNightPhase(currentPhase)

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
        const role = roleAssignments?.[a.id]
        const dead = eliminatedIds.has(a.id)
        return {
          agentId: a.id,
          name: a.name,
          provider: a.provider,
          color: colorFor(a.id),
          latestMessage:
            latest && !dead ? { id: latest.id, content: latest.content } : undefined,
          thinking: thinkingAgentId === a.id && !dead,
          speaking: !!latest && thinkingAgentId !== a.id && !dead,
          role,
          eliminated: dead,
          isHuman: a.isHuman ?? false,
          lastSeenAt: presenceMap[a.id] ?? null,
        }
      }),
    [agents, latestByAgent, colorFor, thinkingAgentId, roleAssignments, eliminatedIds, presenceMap],
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
  const selectedRole = selectedAgent ? roleAssignments?.[selectedAgent.id] : undefined

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        maxWidth: viewMode === 'chat' ? '100%' : 1400,
        margin: '0 auto',
        padding: '0 1rem',
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
          <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{tRoom('werewolfMode')}</span>
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
          <h1 style={{ fontSize: '1.25rem', fontWeight: 590, letterSpacing: '-0.02em' }}>
            {tRoom('werewolfMode')}
          </h1>
          <StatusPill status={status} />
          <DayNightBadge phase={currentPhase} nightNumber={
            typeof gameState?.['nightNumber'] === 'number' ? (gameState['nightNumber'] as number) : 0
          } />
          {advancedRules && (() => {
            const enabled = Object.entries(advancedRules)
              .filter(([, v]) => v)
              .map(([k]) => RULE_LABEL_ZH[k] ?? k)
            if (enabled.length === 0) {
              return (
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                  {t('baseGame')}
                </span>
              )
            }
            return (
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                规则: {enabled.join(' · ')}
              </span>
            )
          })()}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
            <ViewToggle
              mode={viewMode}
              onChange={setViewMode}
              chatLabel={tRoom('viewChat')}
              tableLabel={tRoom('viewTable')}
            />
            <Link
              href={`/room/${roomId}/observability`}
              style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none' }}
            >
              {tRoom('timeline')}
            </Link>
          </div>
        </div>

        <TokenCostPanel summary={tokenSummary} agents={agents} />
      </header>

      {humanAgentId && roleAssignments?.[humanAgentId] && (
        <YourRoleBanner
          role={roleAssignments[humanAgentId]}
          name={agents.find((a) => a.id === humanAgentId)?.name ?? ''}
          eliminated={eliminatedIds.has(humanAgentId)}
        />
      )}

      {status === 'running' && latestByAgent.size === 0 && (
        <WorkflowWarmupBanner agents={agents} thinkingAgentId={thinkingAgentId} />
      )}

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
            fontWeight: 590,
            fontSize: '1rem',
            maxWidth: 1280,
            margin: '1rem auto 0',
            width: '100%',
          }}
        >
          {winResult === 'village_wins' ? t('winners.village') : t('winners.wolves')}
        </div>
      )}

      {status === 'completed' && roleAssignments && (
        <WerewolfSummary
          agents={agents}
          roleMap={roleAssignments as Record<string, string>}
          eliminatedIds={[...eliminatedIds]}
          winResult={winResult as 'village_wins' | 'werewolves_win' | null}
          colorFor={colorFor}
        />
      )}

      {/* Main — chat (default) or round-table */}
      <main
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          display: viewMode === 'table' ? 'grid' : 'block',
          gridTemplateColumns: viewMode === 'table' ? 'minmax(0, 1fr) 340px' : undefined,
          marginTop: '1rem',
        }}
      >
        {viewMode === 'chat' ? (
          <ChatView
            messages={chatMessages}
            getAgentColor={colorFor}
            channels={discoveredChannels}
            channelFilter={channelFilter}
            onChannelFilterChange={setChannelFilter}
            onAgentClick={setModalAgentId}
            headerExtra={
              currentPhase ? (
                <PhaseBadge
                  phase={currentPhase}
                  label={phaseLabels[currentPhase as keyof typeof phaseLabels]}
                  round={currentRound}
                  accent={isNight ? '#8b7ed8' : undefined}
                />
              ) : null
            }
          />
        ) : (
          <>
            <section style={{ position: 'relative', minHeight: 500, overflow: 'hidden' }}>
              <RoundTable agents={tableAgents} onAgentClick={setModalAgentId}>
                <PhaseBadge
                  phase={currentPhase ?? ''}
                  label={currentPhase ? phaseLabels[currentPhase as keyof typeof phaseLabels] : undefined}
                  round={currentRound}
                  accent={isNight ? '#8b7ed8' : undefined}
                />
              </RoundTable>
            </section>
            <aside style={{ minHeight: 0, position: 'relative', overflow: 'hidden' }}>
              <ChatSidebar
                messages={sidebarMessages}
                getAgentColor={colorFor}
                channels={discoveredChannels}
                channelFilter={channelFilter}
                onChannelFilterChange={setChannelFilter}
                title={tRoom('chatTitle')}
              />
            </aside>
          </>
        )}
      </main>

      {status === 'completed' && !winResult && <EndMessage text={t('winners.none')} />}

      {selectedAgent && (
        <AgentDetailModal
          open
          onClose={() => setModalAgentId(null)}
          agent={{
            id: selectedAgent.id,
            name: selectedAgent.name,
            model: selectedAgent.model,
            provider: selectedAgent.provider,
            role: selectedRole,
          }}
          color={colorFor(selectedAgent.id)}
          totals={tokenSummary?.byAgent.find((b) => b.agentId === selectedAgent.id)}
          allMessages={chatMessages}
        />
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────

function StatusPill({ status }: { status: 'lobby' | 'running' | 'waiting' | 'completed' | 'error' }) {
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
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.375rem',
        fontSize: '0.8rem',
        color: 'var(--muted)',
      }}
    >
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

function EndMessage({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '1rem 1.25rem',
        margin: '1rem auto',
        maxWidth: 640,
        borderRadius: 'var(--radius)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        textAlign: 'center',
        fontSize: '0.9rem',
        color: 'var(--muted)',
      }}
    >
      {text}
    </div>
  )
}

// "Your role: 🐺 狼人" — the banner is the seated player's primary
// orientation. Without it the human has no idea which faction they
// play for, and the game breaks down even though all the underlying
// state is correct.
function YourRoleBanner({
  role,
  name,
  eliminated,
}: {
  role: string
  name: string
  eliminated: boolean
}) {
  const display = ROLE_DISPLAY[role]
  if (!display) return null
  const factionColor =
    display.faction === 'werewolves' ? '#dc2626' : '#22c55e'
  const factionLabel =
    display.faction === 'werewolves' ? '狼人阵营' : '好人阵营'
  return (
    <div
      style={{
        margin: '1rem auto 0',
        maxWidth: 1280,
        width: '100%',
        padding: '0.75rem 1rem',
        borderRadius: 'var(--radius)',
        background: `color-mix(in srgb, ${factionColor} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${factionColor} 40%, var(--border))`,
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        fontSize: '0.875rem',
      }}
    >
      <div style={{ fontSize: '1.5rem', lineHeight: 1 }}>{display.emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 590, marginBottom: 2 }}>
          你的身份: <span style={{ color: factionColor }}>{display.label}</span>
          {eliminated && (
            <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 510 }}>
              · 已淘汰
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
          {name && <>座位: <strong>{name}</strong> · </>}
          阵营: <span style={{ color: factionColor, fontWeight: 510 }}>{factionLabel}</span>
        </div>
      </div>
    </div>
  )
}

// Day/night cycle indicator. Reads from gameState.nightNumber +
// the current phase to compute "🌙 第 N 夜" or "☀️ 第 N 天". This
// is what the user actually wants to see in the header — the raw
// phase string is too jargony, and the wraparound 'guard' label
// from advancedRules display was the proximate cause of the
// "I can't tell what phase we're in" complaint.
function DayNightBadge({
  phase,
  nightNumber,
}: {
  phase: string | null
  nightNumber: number
}) {
  if (!phase) return null
  const isNight = isNightPhase(phase)
  // Day n maps to night n's morning — i.e. after night N transitions
  // to dawn, it becomes day N. nightNumber is incremented at vote-end
  // so during day N discussion, gameState.nightNumber === N already.
  // (See werewolf-day-phases.ts:runDayVote.)
  const cycleNum = Math.max(1, nightNumber || 1)
  const label = isNight ? `🌙 第 ${cycleNum} 夜` : `☀️ 第 ${cycleNum} 天`
  const color = isNight ? '#8b7ed8' : '#f5a623'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        fontSize: '0.8rem',
        color,
        fontWeight: 510,
        padding: '2px 8px',
        borderRadius: '999px',
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
      }}
    >
      {label}
    </span>
  )
}
