// ============================================================
// Agora Platform — Roundtable Debate Mode
// ============================================================

import { AIAgent, Room, RoundRobinFlow, EventBus } from '@agora/core'
import { createGenerateFn } from '@agora/llm'
import type { ModelConfig, PersonaConfig, RoomConfig } from '@agora/shared'

// ── Configuration ──────────────────────────────────────────

export interface RoundtableAgentConfig {
  readonly name: string
  readonly persona: string
  readonly model: ModelConfig
}

export interface RoundtableConfig {
  readonly topic: string
  readonly rounds?: number
  readonly agents: readonly RoundtableAgentConfig[]
}

export interface RoundtableResult {
  readonly room: Room
  readonly eventBus: EventBus
}

// ── Prompt Builder ─────────────────────────────────────────

export function createDebaterPrompt(
  name: string,
  persona: string,
  topic: string,
): string {
  return [
    `You are ${name}, a debater in a roundtable discussion.`,
    '',
    `Your personality: ${persona}`,
    '',
    `The topic being debated: "${topic}"`,
    '',
    'Rules:',
    '- Stay in character throughout the debate',
    "- Engage with and respond to other participants' arguments",
    '- Be concise (2-4 sentences per turn)',
    "- You may agree, disagree, or build upon others' points",
    '- Bring your unique perspective based on your personality',
  ].join('\n')
}

// ── Factory ────────────────────────────────────────────────

export function createRoundtable(config: RoundtableConfig): RoundtableResult {
  const { topic, agents } = config
  const rounds = config.rounds ?? 3

  if (agents.length < 2 || agents.length > 8) {
    throw new Error('Roundtable requires 2-8 agents')
  }

  const eventBus = new EventBus()

  const roomConfig: RoomConfig = {
    id: crypto.randomUUID(),
    name: `Roundtable: ${topic}`,
    modeId: 'roundtable',
    topic,
    maxAgents: agents.length,
    settings: { rounds },
  }

  const room = new Room(roomConfig, eventBus)

  for (const agentDef of agents) {
    const agentId = crypto.randomUUID()
    const systemPrompt = createDebaterPrompt(agentDef.name, agentDef.persona, topic)

    const persona: PersonaConfig = {
      name: agentDef.name,
      description: agentDef.persona,
    }

    const agent = new AIAgent(
      {
        id: agentId,
        name: agentDef.name,
        persona,
        model: agentDef.model,
        systemPrompt,
      },
      createGenerateFn(agentDef.model),
    )

    room.addAgent(agent)
  }

  return { room, eventBus }
}

/**
 * Convenience: create and immediately run a roundtable debate.
 * Returns the completed Room (call room.getMessages() for transcript).
 */
export async function runRoundtable(config: RoundtableConfig): Promise<Room> {
  const { room } = createRoundtable(config)
  const rounds = config.rounds ?? 3
  await room.start(new RoundRobinFlow({ rounds }))
  return room
}
