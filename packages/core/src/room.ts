// ============================================================
// Agora Platform — Room orchestrator
// ============================================================

import type { Message, RoomConfig } from '@agora/shared'
import type { Agent } from './agent.js'
import type { FlowController } from './flow.js'
import { EventBus } from './events.js'

/**
 * Room orchestrates a multi-agent session:
 *  1. Holds agents, flow controller, and event bus
 *  2. start() runs the debate loop to completion
 *  3. Broadcasts messages so every agent can observe
 */
export class Room {
  readonly config: RoomConfig
  private readonly eventBus: EventBus
  private readonly agents = new Map<string, Agent>()
  private readonly messages: Message[] = []

  constructor(config: RoomConfig, eventBus: EventBus) {
    this.config = config
    this.eventBus = eventBus
  }

  /** Register an agent in this room */
  addAgent(agent: Agent): void {
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error(
        `Room "${this.config.name}" is full (max ${this.config.maxAgents} agents)`,
      )
    }
    this.agents.set(agent.id, agent)
    this.eventBus.emit({
      type: 'agent:joined',
      roomId: this.config.id,
      agent: {
        id: agent.id,
        name: agent.config.name,
        persona: agent.config.persona,
        model: agent.config.model,
        isHuman: false,
      },
    })
  }

  /** Remove an agent from this room */
  removeAgent(agentId: string): void {
    this.agents.delete(agentId)
    this.eventBus.emit({
      type: 'agent:left',
      roomId: this.config.id,
      agentId,
    })
  }

  /**
   * Run the full debate loop:
   *  tick flow → get speaker → agent replies → broadcast → repeat
   */
  async start(flow: FlowController): Promise<void> {
    const agentIds = [...this.agents.keys()]
    flow.initialize(agentIds)

    this.eventBus.emit({ type: 'room:started', roomId: this.config.id })

    let lastRound = 0

    while (!flow.isComplete()) {
      const tick = flow.tick()

      if (tick.isComplete) {
        break
      }

      // Emit round change when the round advances
      if (tick.round !== lastRound) {
        lastRound = tick.round
        this.eventBus.emit({
          type: 'round:changed',
          roomId: this.config.id,
          round: tick.round,
          maxRounds: tick.round, // flow doesn't expose total — use current as best-effort
        })
      }

      for (const speakerId of tick.nextSpeakers) {
        const agent = this.agents.get(speakerId)
        if (!agent) continue

        // Signal that this agent is thinking
        this.eventBus.emit({
          type: 'agent:thinking',
          roomId: this.config.id,
          agentId: speakerId,
        })

        const message = await agent.reply({
          roomId: this.config.id,
          phase: tick.phase,
          recentMessages: this.messages,
          instruction: tick.instruction,
        })

        // Store the message
        this.messages.push(message)

        // Broadcast to all agents (including the speaker — they see their own message)
        for (const a of this.agents.values()) {
          a.observe(message)
        }

        // Emit events
        this.eventBus.emit({ type: 'message:created', message })
        this.eventBus.emit({
          type: 'agent:done',
          roomId: this.config.id,
          agentId: speakerId,
        })
      }
    }

    this.eventBus.emit({ type: 'room:ended', roomId: this.config.id })
  }

  /** Get all messages produced in this room */
  getMessages(): readonly Message[] {
    return this.messages
  }
}
