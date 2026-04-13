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
  | { type: 'agent:thinking'; roomId: Id; agentId: Id }
  | { type: 'agent:done'; roomId: Id; agentId: Id }
