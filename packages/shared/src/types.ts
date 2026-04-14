// ============================================================
// Agora Platform — Shared Types
// ============================================================

/** Unique identifier */
export type Id = string

/** Supported LLM providers */
export type LLMProvider = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'azure-openai'

/** Model configuration for an agent */
export interface ModelConfig {
  readonly provider: LLMProvider
  readonly modelId: string
  readonly apiKey?: string
  readonly temperature?: number
  readonly maxTokens?: number
}

/** Agent persona definition */
export interface PersonaConfig {
  readonly name: string
  readonly description: string
  readonly avatar?: string
  readonly systemPrompt?: string
}

/** Room lifecycle states */
export type RoomStatus = 'waiting' | 'active' | 'paused' | 'ended'

// ── Channel ────────────────────────────────────────────────

/** Channel configuration for information isolation */
export interface ChannelConfig {
  readonly id: Id
  readonly roomId: Id
  readonly name: string
  readonly parentId: Id | null
  /** If true, messages auto-broadcast to all subscribers */
  readonly autoBroadcast: boolean
}

/** Who can subscribe to a channel — used by modes to configure channels */
export interface ChannelTemplate {
  readonly id: string
  readonly name: string
  readonly autoBroadcast: boolean
  readonly parentId: string | null
  /** Role IDs that should be subscribed. '*' = all agents */
  readonly subscriberRoles: readonly string[]
  /** Phases during which this channel is active */
  readonly activePhases: readonly string[]
}

/** Message in a conversation */
export interface Message {
  readonly id: Id
  readonly roomId: Id
  readonly senderId: Id
  readonly senderName: string
  readonly content: string
  readonly channelId: Id
  readonly timestamp: number
  readonly metadata?: Record<string, unknown>
}

// ── Token Usage ─────────────────────────────────────────────

/**
 * Normalized token-usage snapshot for a single LLM call.
 * Superset across providers — unused fields default to 0.
 *
 * - `cachedInputTokens`: Anthropic prompt-cache read (reused cache blocks)
 * - `cacheCreationTokens`: Anthropic prompt-cache write (new cache blocks)
 * - `reasoningTokens`: OpenAI o1-style hidden reasoning tokens
 */
export interface TokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedInputTokens: number
  readonly cacheCreationTokens: number
  readonly reasoningTokens: number
  readonly totalTokens: number
}

/** Per-1M-token pricing for a specific provider/model */
export interface ModelPricing {
  readonly provider: LLMProvider
  readonly modelId: string
  readonly inputPricePerMillion: number
  readonly outputPricePerMillion: number
  readonly cachedInputPricePerMillion: number
  readonly cacheCreationPricePerMillion: number
}

/** One token-usage observation tied to a message + agent */
export interface TokenUsageRecord {
  readonly roomId: Id
  readonly agentId: Id
  readonly messageId: Id
  readonly provider: LLMProvider
  readonly modelId: string
  readonly usage: TokenUsage
  readonly cost: number
  readonly timestamp: number
}

/** Room configuration */
export interface RoomConfig {
  readonly id: Id
  readonly name: string
  readonly modeId: string
  readonly topic?: string
  readonly maxAgents: number
  readonly settings?: Record<string, unknown>
}

/** Agent summary (for UI display) */
export interface AgentSummary {
  readonly id: Id
  readonly name: string
  readonly persona: PersonaConfig
  readonly model: ModelConfig
  readonly isHuman: boolean
}

/** Platform events emitted via EventBus / Socket.io */
export type PlatformEvent =
  | { type: 'room:created'; roomId: Id }
  | { type: 'room:started'; roomId: Id }
  | { type: 'room:ended'; roomId: Id }
  | { type: 'agent:joined'; roomId: Id; agent: AgentSummary }
  | { type: 'agent:left'; roomId: Id; agentId: Id }
  | { type: 'message:created'; message: Message }
  | { type: 'round:changed'; roomId: Id; round: number; maxRounds: number }
  | {
      type: 'phase:changed'
      roomId: Id
      phase: string
      previousPhase: string | null
      metadata?: Record<string, unknown>
    }
  | { type: 'agent:thinking'; roomId: Id; agentId: Id }
  | { type: 'agent:done'; roomId: Id; agentId: Id }
  | {
      type: 'token:recorded'
      roomId: Id
      agentId: Id
      messageId: Id
      provider: LLMProvider
      modelId: string
      usage: TokenUsage
      cost: number
    }
