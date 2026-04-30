'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { RoundtableView } from '../../room/[id]/modes/roundtable/RoundtableView'
import { WerewolfView } from '../../room/[id]/modes/werewolf/WerewolfView'
import type {
  AgentData,
  AgentTotals,
  MessageData,
  ModelTotals,
  PollResponse,
  TokenSummary,
} from '../../room/[id]/components/theme'
import { PlaybackControls } from './components/PlaybackControls'
import {
  useReplayPlayback,
  type ReplayEventEnvelope,
} from './hooks/useReplayPlayback'

interface RoomListItem {
  id: string
  modeId: string
  topic: string | null
  agents: AgentData[]
  currentPhase: string | null
  gameState: Record<string, unknown> | null
  totalCost: number
  totalTokens: number
  callCount: number
  messageCount: number
}

interface InitialSnapshot {
  id: string
  modeId: string
  topic: string | null
  agents: AgentData[]
  roleAssignments: Record<string, string> | null
  advancedRules: Record<string, boolean> | null
  gameState: Record<string, unknown> | null
  tokenSummary: TokenSummary | null
}

export default function ReplayPage() {
  const t = useTranslations('replay')
  const params = useParams()
  const roomId = params.id as string

  const [snapshot, setSnapshot] = useState<InitialSnapshot | null>(null)
  const [events, setEvents] = useState<ReplayEventEnvelope[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [snapRes, eventsRes] = await Promise.all([
          fetch(`/api/rooms/${roomId}/messages`),
          fetch(`/api/rooms/${roomId}/events`),
        ])
        if (!snapRes.ok) {
          setError(t('notFound'))
          setLoading(false)
          return
        }
        const snapData = (await snapRes.json()) as PollResponse
        const eventsData = (await eventsRes.json()) as {
          events: ReplayEventEnvelope[]
          total: number
          status: string
        }
        if (cancelled) return

        setSnapshot({
          id: roomId,
          modeId: snapData.modeId,
          topic: snapData.topic,
          agents: snapData.agents,
          roleAssignments: snapData.roleAssignments,
          advancedRules: snapData.advancedRules,
          gameState: snapData.gameState,
          tokenSummary: snapData.tokenSummary,
        })
        setEvents(eventsData.events)
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load replay')
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [roomId])

  const [playback, controls] = useReplayPlayback(events, 2)

  // Reconstruct the current UI snapshot from visible events only
  const reconstructed = useMemo(() => {
    if (!snapshot) return null
    return reconstructFromEvents(snapshot, playback.visibleEvents)
  }, [snapshot, playback.visibleEvents])

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          color: 'var(--muted)',
        }}
      >
        {t('loading')}
      </div>
    )
  }

  if (error || !snapshot || !reconstructed) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: '1rem',
        }}
      >
        <p style={{ color: 'var(--danger)' }}>{error ?? t('unavailable')}</p>
        <Link
          href="/replays"
          style={{
            padding: '0.5rem 1rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
          }}
        >
          {t('backToReplays')}
        </Link>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        {snapshot.modeId === 'werewolf' ? (
          <WerewolfView
            messages={reconstructed.messages}
            snapshot={reconstructed.snapshot as Omit<PollResponse, 'messages'>}
          />
        ) : (
          <RoundtableView
            messages={reconstructed.messages}
            snapshot={reconstructed.snapshot as Omit<PollResponse, 'messages'>}
          />
        )}
      </div>

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'var(--background)',
          borderTop: '1px solid var(--border)',
          padding: '0.75rem 1rem',
          zIndex: 20,
        }}
      >
        <div style={{ maxWidth: '960px', margin: '0 auto' }}>
          <PlaybackControls state={playback} controls={controls} />
        </div>
      </div>
    </div>
  )
}

// ── Event-stream reconstruction ─────────────────────────────

interface Reconstructed {
  messages: MessageData[]
  snapshot: Omit<PollResponse, 'messages'>
}

/**
 * Replays events up to `events`, producing the same shape the live
 * mode views expect. This is pure — no side effects, just folds the
 * event stream into `messages[]` + derived state snapshot fields.
 */
function reconstructFromEvents(
  initial: InitialSnapshot,
  events: readonly ReplayEventEnvelope[],
): Reconstructed {
  const messages: MessageData[] = []
  const byAgent = new Map<string, AgentTotals>()
  const byModel = new Map<string, ModelTotals>()
  let totalCost = 0
  let totalTokens = 0
  let callCount = 0
  let currentPhase: string | null = null
  let currentRound = 1
  let totalRounds = 1
  let thinkingAgentId: string | null = null
  let gameState: Record<string, unknown> | null = initial.gameState
  let status: 'running' | 'completed' | 'error' = 'running'

  for (const ev of events) {
    const e = ev.event
    switch (e.type) {
      case 'message:created': {
        const msg = (e as unknown as { message: MessageData }).message
        messages.push(msg)
        break
      }
      case 'phase:changed': {
        currentPhase = (e['phase'] as string) ?? null
        if (e['metadata'] && typeof e['metadata'] === 'object') {
          gameState = { ...(gameState ?? {}), ...(e['metadata'] as Record<string, unknown>) }
        }
        break
      }
      case 'round:changed': {
        currentRound = Number(e['round']) || 1
        totalRounds = Number(e['maxRounds']) || currentRound
        break
      }
      case 'agent:thinking': {
        thinkingAgentId = (e['agentId'] as string) ?? null
        break
      }
      case 'agent:done': {
        thinkingAgentId = null
        break
      }
      case 'token:recorded': {
        const agentId = String(e['agentId'])
        const provider = String(e['provider'])
        const modelId = String(e['modelId'])
        const usage = (e['usage'] as Record<string, number>) ?? {}
        const cost = Number(e['cost']) || 0

        const a = byAgent.get(agentId) ?? emptyAgentTotals(agentId)
        a.inputTokens += usage['inputTokens'] ?? 0
        a.outputTokens += usage['outputTokens'] ?? 0
        a.cachedInputTokens += usage['cachedInputTokens'] ?? 0
        a.cacheCreationTokens += usage['cacheCreationTokens'] ?? 0
        a.reasoningTokens += usage['reasoningTokens'] ?? 0
        a.totalTokens += usage['totalTokens'] ?? 0
        a.cost += cost
        a.callCount += 1
        byAgent.set(agentId, a)

        const key = `${provider}:${modelId}`
        const m = byModel.get(key) ?? emptyModelTotals(provider, modelId)
        m.inputTokens += usage['inputTokens'] ?? 0
        m.outputTokens += usage['outputTokens'] ?? 0
        m.cachedInputTokens += usage['cachedInputTokens'] ?? 0
        m.cacheCreationTokens += usage['cacheCreationTokens'] ?? 0
        m.reasoningTokens += usage['reasoningTokens'] ?? 0
        m.totalTokens += usage['totalTokens'] ?? 0
        m.cost += cost
        m.callCount += 1
        byModel.set(key, m)

        totalCost += cost
        totalTokens += usage['totalTokens'] ?? 0
        callCount += 1
        break
      }
      case 'room:ended': {
        status = 'completed'
        break
      }
      default:
        break
    }
  }

  const tokenSummary: TokenSummary = {
    totalCost,
    totalTokens,
    callCount,
    byAgent: [...byAgent.values()],
    byModel: [...byModel.values()],
  }

  return {
    messages,
    snapshot: {
      status,
      currentRound,
      totalRounds,
      currentPhase,
      modeId: initial.modeId,
      thinkingAgentId,
      agents: initial.agents,
      topic: initial.topic ?? '',
      tokenSummary,
      roleAssignments: initial.roleAssignments,
      advancedRules: initial.advancedRules,
      gameState,
      // Replays are read-only; no live actions, so isOwner is moot.
      // Default to false — the lobby branch in /room/[id]/page.tsx
      // never fires here anyway (replay rooms are status='completed').
      isOwner: false,
    },
  }
}

function emptyAgentTotals(agentId: string): AgentTotals {
  return {
    agentId,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    cost: 0,
    callCount: 0,
  }
}

function emptyModelTotals(provider: string, modelId: string): ModelTotals {
  return {
    provider,
    modelId,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    cost: 0,
    callCount: 0,
  }
}
// Suppress unused import warning — RoomListItem is a helpful type reference
void (null as unknown as RoomListItem)
