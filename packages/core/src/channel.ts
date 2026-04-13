// ============================================================
// Agora Platform — Channel (information isolation)
// ============================================================

import type { ChannelConfig, Id, Message } from '@agora/shared'

/**
 * Channel controls information flow between agents.
 *
 * - Agents subscribe to channels they're allowed to see
 * - Messages published to a channel only reach subscribers
 * - Channels can be nested (parentId) for hierarchical isolation
 *
 * Examples:
 *   #main          — all players, active during day phases
 *   #werewolf      — wolves only, active during night
 *   #seer-result   — seer only, private check results
 *   #spectator     — eliminated players + observers
 */
export class Channel {
  readonly config: ChannelConfig
  private readonly subscribers = new Set<Id>()

  constructor(config: ChannelConfig) {
    this.config = config
  }

  get id(): Id {
    return this.config.id
  }

  get name(): string {
    return this.config.name
  }

  /** Add an agent to this channel */
  subscribe(agentId: Id): void {
    this.subscribers.add(agentId)
  }

  /** Remove an agent from this channel */
  unsubscribe(agentId: Id): void {
    this.subscribers.delete(agentId)
  }

  /** Check if an agent is subscribed */
  isSubscriber(agentId: Id): boolean {
    return this.subscribers.has(agentId)
  }

  /** Get all subscriber IDs */
  getSubscriberIds(): readonly Id[] {
    return [...this.subscribers]
  }

  /** Get subscriber count */
  get subscriberCount(): number {
    return this.subscribers.size
  }
}

/**
 * ChannelManager — manages all channels in a room.
 *
 * Always creates a 'main' channel on init. Modes add
 * additional channels (e.g., werewolf night channel).
 */
export class ChannelManager {
  private readonly channels = new Map<Id, Channel>()
  private readonly roomId: Id

  constructor(roomId: Id) {
    this.roomId = roomId

    // Always create the default 'main' channel
    this.createChannel({
      id: 'main',
      roomId,
      name: 'Main',
      parentId: null,
      autoBroadcast: true,
    })
  }

  /** Create a new channel */
  createChannel(config: ChannelConfig): Channel {
    const channel = new Channel(config)
    this.channels.set(config.id, channel)
    return channel
  }

  /** Get a channel by ID */
  getChannel(channelId: Id): Channel | undefined {
    return this.channels.get(channelId)
  }

  /** Get all channels */
  getAllChannels(): readonly Channel[] {
    return [...this.channels.values()]
  }

  /** Subscribe an agent to a channel */
  subscribe(channelId: Id, agentId: Id): void {
    const channel = this.channels.get(channelId)
    if (!channel) {
      throw new Error(`Channel "${channelId}" does not exist`)
    }
    channel.subscribe(agentId)
  }

  /** Unsubscribe an agent from a channel */
  unsubscribe(channelId: Id, agentId: Id): void {
    this.channels.get(channelId)?.unsubscribe(agentId)
  }

  /** Subscribe an agent to all channels (convenience for 'main') */
  subscribeToAll(agentId: Id): void {
    for (const channel of this.channels.values()) {
      if (channel.config.autoBroadcast) {
        channel.subscribe(agentId)
      }
    }
  }

  /**
   * Get agents who should receive a message on a given channel.
   * Returns subscriber IDs for that channel.
   */
  getReceivers(channelId: Id): readonly Id[] {
    const channel = this.channels.get(channelId)
    if (!channel) return []
    return channel.getSubscriberIds()
  }

  /**
   * Filter messages to only those an agent is allowed to see.
   * An agent can see a message if they're subscribed to its channel.
   */
  filterMessagesForAgent(messages: readonly Message[], agentId: Id): readonly Message[] {
    return messages.filter((msg) => {
      const channel = this.channels.get(msg.channelId)
      // If channel doesn't exist (e.g., old message), allow it
      if (!channel) return true
      return channel.isSubscriber(agentId)
    })
  }
}
