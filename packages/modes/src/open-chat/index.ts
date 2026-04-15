// ============================================================
// Agora Open-Chat Mode — Public API
// ============================================================
//
// The simplest mode: N agents speak in round-robin for M rounds,
// discussing a topic the user provided. No roles, no channels beyond
// `main`. The only wrinkle: if `leaderAgentId` is set, the leader is
// placed at index 0 so they speak first in every round — dovetailing
// with the runtime leader-directive prompt (see room-runtime.ts).

import {
  AIAgent,
  EventBus,
  Room,
  RoundRobinFlow,
  type GenerateFn,
} from '@agora/core'
import type { ModelConfig } from '@agora/shared'

import type { OpenChatAgentConfig, OpenChatConfig } from './types.js'

export interface OpenChatResult {
  readonly room: Room
  readonly eventBus: EventBus
  readonly flow: RoundRobinFlow
  /** Final speaker order (leader first if `leaderAgentId` was set). */
  readonly orderedAgentIds: readonly string[]
  readonly rounds: number
}

export function createOpenChat(
  config: OpenChatConfig,
  createGenFn: (model: ModelConfig) => GenerateFn,
): OpenChatResult {
  const rounds = clampRounds(config.rounds ?? 3)

  if (config.agents.length === 0) {
    throw new Error('open-chat requires at least one agent')
  }
  if (config.agents.length > 12) {
    throw new Error('open-chat supports at most 12 agents')
  }
  if (!config.roomId) {
    throw new Error('open-chat requires roomId (caller generates upfront)')
  }

  // Leader-first ordering. If leader not found in roster, treat as no leader.
  const ordered = orderWithLeader(config.agents, config.leaderAgentId ?? null)

  const eventBus = new EventBus()
  const room = new Room(
    {
      id: config.roomId,
      name: `Open chat: ${config.topic}`,
      modeId: 'open-chat',
      topic: config.topic,
      maxAgents: 12,
      settings: { rounds, leaderAgentId: config.leaderAgentId ?? null },
    },
    eventBus,
  )

  for (const agentCfg of ordered) {
    const agent = new AIAgent(
      {
        id: agentCfg.id,
        name: agentCfg.name,
        persona: { name: agentCfg.name, description: agentCfg.persona },
        model: agentCfg.model,
        systemPrompt: agentCfg.systemPrompt,
      },
      createGenFn(agentCfg.model),
    )
    room.addAgent(agent)
  }

  const flow = new RoundRobinFlow({ rounds })
  const orderedAgentIds = ordered.map((a) => a.id)

  return { room, eventBus, flow, orderedAgentIds, rounds }
}

// ── Helpers ────────────────────────────────────────────────

function clampRounds(raw: number): number {
  if (!Number.isFinite(raw)) return 3
  return Math.max(1, Math.min(10, Math.trunc(raw)))
}

function orderWithLeader(
  agents: readonly OpenChatAgentConfig[],
  leaderId: string | null,
): OpenChatAgentConfig[] {
  if (!leaderId) return [...agents]
  const leader = agents.find((a) => a.id === leaderId)
  if (!leader) return [...agents]
  return [leader, ...agents.filter((a) => a.id !== leaderId)]
}

// ── Re-exports ─────────────────────────────────────────────

export type {
  OpenChatAgentConfig,
  OpenChatConfig,
  OpenChatGameStateSnapshot,
} from './types.js'
