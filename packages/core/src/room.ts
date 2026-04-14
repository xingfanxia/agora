// ============================================================
// Agora Platform — Room orchestrator
// ============================================================

import type { Message, RoomConfig } from '@agora/shared'
import type { Agent } from './agent.js'
import type { FlowController } from './flow.js'
import { ChannelManager } from './channel.js'
import { EventBus } from './events.js'
import type { Announcement, StateMachineFlow } from './state-machine.js'

/**
 * Room orchestrates a multi-agent session:
 *  1. Holds agents, flow controller, channels, and event bus
 *  2. start() runs the main loop to completion
 *  3. Routes messages through channels (information isolation)
 */
export class Room {
  readonly config: RoomConfig
  private readonly eventBus: EventBus
  readonly channels: ChannelManager
  private readonly agents = new Map<string, Agent>()
  private readonly messages: Message[] = []

  constructor(config: RoomConfig, eventBus: EventBus) {
    this.config = config
    this.eventBus = eventBus
    this.channels = new ChannelManager(config.id)
  }

  /** Register an agent in this room */
  addAgent(agent: Agent): void {
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error(
        `Room "${this.config.name}" is full (max ${this.config.maxAgents} agents)`,
      )
    }
    this.agents.set(agent.id, agent)

    // Auto-subscribe to 'main' channel
    this.channels.subscribe('main', agent.id)

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
   * Run the full session loop to completion.
   *
   * CLI + local-dev use this. The Vercel durable path (Phase 4.5a) instead
   * calls `runUntilPhaseBoundary()` per tick.
   *
   *   tick flow → get speaker → agent replies → route via channel → repeat
   */
  async start(flow: FlowController): Promise<void> {
    const agentIds = [...this.agents.keys()]
    flow.initialize(agentIds)

    this.eventBus.emit({ type: 'room:started', roomId: this.config.id })

    let lastRound = 0
    let lastPhase: string | null = null

    while (!flow.isComplete()) {
      const result = await this.runOneIteration(flow, lastRound, lastPhase)
      if (result.isComplete) break
      lastRound = result.lastRound
      lastPhase = result.lastPhase
    }

    this.eventBus.emit({ type: 'room:ended', roomId: this.config.id })
  }

  /**
   * Durable-runtime step (Phase 4.5a): run iterations until EITHER the
   * current phase transitions to a different phase OR the game completes.
   *
   * Does NOT emit `room:started` / `room:ended`. The caller (advanceRoom)
   * controls lifecycle events since the first tick already emitted
   * room:started and only the last tick should emit room:ended.
   *
   * @param options.startingPhase — phase we're resuming in (from DB
   *        snapshot). When set, the first iteration's tick.phase === this
   *        value produces no duplicate phase:changed emission.
   * @param options.startingRound — round we're resuming at. Same reasoning.
   */
  async runUntilPhaseBoundary(
    flow: FlowController,
    options: { startingPhase?: string | null; startingRound?: number } = {},
  ): Promise<{
    gameCompleted: boolean
    phaseChanged: boolean
    phase: string
    round: number
  }> {
    let lastRound = options.startingRound ?? 0
    let lastPhase: string | null = options.startingPhase ?? null

    while (!flow.isComplete()) {
      const prevPhase = lastPhase
      const result = await this.runOneIteration(flow, lastRound, lastPhase)
      lastRound = result.lastRound
      lastPhase = result.lastPhase

      if (result.isComplete) {
        return {
          gameCompleted: true,
          phaseChanged: prevPhase !== null && lastPhase !== prevPhase,
          phase: lastPhase ?? '',
          round: lastRound,
        }
      }
      if (prevPhase !== null && lastPhase !== prevPhase) {
        return {
          gameCompleted: false,
          phaseChanged: true,
          phase: lastPhase ?? '',
          round: lastRound,
        }
      }
    }

    return {
      gameCompleted: true,
      phaseChanged: false,
      phase: lastPhase ?? '',
      round: lastRound,
    }
  }

  /**
   * One iteration of the while-loop body — extracted so start() and
   * runUntilPhaseBoundary() share the exact same tick semantics.
   */
  private async runOneIteration(
    flow: FlowController,
    lastRound: number,
    lastPhase: string | null,
  ): Promise<{ isComplete: boolean; lastRound: number; lastPhase: string | null }> {
    // Drain any pending announcements (from StateMachineFlow phase transitions)
    this.drainAnnouncements(flow)

    const tick = flow.tick()

    if (tick.isComplete) {
      // Final drain after last tick
      this.drainAnnouncements(flow)
      return { isComplete: true, lastRound, lastPhase }
    }

    // Emit round change
    if (tick.round !== lastRound) {
      lastRound = tick.round
      this.eventBus.emit({
        type: 'round:changed',
        roomId: this.config.id,
        round: tick.round,
        maxRounds: tick.round,
      })
    }

    // Drain announcements generated during tick() transitions
    this.drainAnnouncements(flow)

    // Emit phase change
    if (tick.phase !== lastPhase) {
      this.eventBus.emit({
        type: 'phase:changed',
        roomId: this.config.id,
        phase: tick.phase,
        previousPhase: lastPhase,
        metadata: tick.metadata,
      })
      lastPhase = tick.phase
    }

    for (const speakerId of tick.nextSpeakers) {
      const agent = this.agents.get(speakerId)
      if (!agent) continue

      // Signal thinking
      this.eventBus.emit({
        type: 'agent:thinking',
        roomId: this.config.id,
        agentId: speakerId,
      })

      // Build context — filter messages to only what this agent can see
      const visibleMessages = this.channels.filterMessagesForAgent(this.messages, speakerId)

      const message = await agent.reply({
        roomId: this.config.id,
        channelId: tick.channelId,
        phase: tick.phase,
        recentMessages: visibleMessages,
        instruction: tick.instruction,
        schema: tick.schema,
      })

      // Store message
      this.messages.push(message)

      // Route to channel subscribers only
      const receivers = this.channels.getReceivers(tick.channelId)
      for (const receiverId of receivers) {
        const receiver = this.agents.get(receiverId)
        if (receiver) {
          receiver.observe(message)
        }
      }

      // Notify flow controller (for StateMachine transition logic)
      flow.onMessage?.(message)

      // Emit events
      this.eventBus.emit({ type: 'message:created', message })
      this.eventBus.emit({
        type: 'agent:done',
        roomId: this.config.id,
        agentId: speakerId,
      })

      // Drain announcements after each message (phase may have transitioned)
      this.drainAnnouncements(flow)
    }

    return { isComplete: false, lastRound, lastPhase }
  }

  /** Replay a persisted message into the room without re-invoking an agent.
   *
   * Used by the durable-runtime rehydration path: given events loaded from
   * DB, route each message to its channel subscribers (so agents have full
   * memory for the next live turn) and append to the in-memory log. Does
   * not emit any events and does not notify the flow.
   */
  replayMessage(message: Message): void {
    this.messages.push(message)
    const receivers = this.channels.getReceivers(message.channelId)
    for (const receiverId of receivers) {
      const agent = this.agents.get(receiverId)
      if (agent) agent.observe(message)
    }
  }

  /** Get all messages produced in this room */
  getMessages(): readonly Message[] {
    return this.messages
  }

  /** Get an agent by ID */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId)
  }

  /** Get all agent IDs */
  getAgentIds(): readonly string[] {
    return [...this.agents.keys()]
  }

  // ── Private ────────────────────────────────────────────────

  /**
   * Drain announcement messages from StateMachineFlow and inject
   * them as system messages into the room.
   */
  private drainAnnouncements(flow: FlowController): void {
    // Only StateMachineFlow has announcements
    if (!('drainAnnouncements' in flow)) return
    const smFlow = flow as StateMachineFlow
    const announcements: Announcement[] = smFlow.drainAnnouncements()

    for (const announcement of announcements) {
      const message: Message = {
        id: crypto.randomUUID(),
        roomId: this.config.id,
        senderId: 'system',
        senderName: 'Narrator',
        content: announcement.content,
        channelId: announcement.channelId,
        timestamp: Date.now(),
        metadata: announcement.metadata,
      }

      this.messages.push(message)

      // Route to channel subscribers
      const receivers = this.channels.getReceivers(announcement.channelId)
      for (const receiverId of receivers) {
        const agent = this.agents.get(receiverId)
        if (agent) {
          agent.observe(message)
        }
      }

      this.eventBus.emit({ type: 'message:created', message })
    }
  }
}
