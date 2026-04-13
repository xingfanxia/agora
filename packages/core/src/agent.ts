// ============================================================
// Agora Platform — Agent interface + AIAgent implementation
// ============================================================

import type { Id, Message, ModelConfig, PersonaConfig } from '@agora/shared'

// ── Interfaces ──────────────────────────────────────────────

/** What the FlowController passes to an agent on their turn */
export interface ReplyContext {
  readonly roomId: string
  readonly channelId: string
  readonly phase: string
  readonly recentMessages: readonly Message[]
  readonly instruction?: string
  /** If present, agent should produce structured output matching this schema */
  readonly schema?: unknown
}

/** Full agent configuration */
export interface AgentConfig {
  readonly id: Id
  readonly name: string
  readonly persona: PersonaConfig
  readonly model: ModelConfig
  readonly systemPrompt?: string
}

/** Chat message in LLM-compatible format */
export interface ChatMessage {
  readonly role: string
  readonly content: string
}

/**
 * Generate function signature — injected into AIAgent so core
 * has zero dependency on any LLM package.
 */
export type GenerateFn = (
  systemPrompt: string,
  messages: ChatMessage[],
  instruction?: string,
) => Promise<string>

/**
 * Structured output generate function — injected optionally
 * for modes that need constrained decisions (votes, actions).
 */
export type GenerateObjectFn = (
  systemPrompt: string,
  messages: ChatMessage[],
  schema: unknown,
  instruction?: string,
) => Promise<unknown>

/** Core agent contract: reply + observe */
export interface Agent {
  readonly id: string
  readonly config: AgentConfig
  reply(context: ReplyContext): Promise<Message>
  observe(message: Message): void
  getHistory(): readonly Message[]
}

// ── Implementation ──────────────────────────────────────────

function buildSystemPrompt(config: AgentConfig): string {
  const parts: string[] = []

  if (config.systemPrompt) {
    parts.push(config.systemPrompt)
  }

  const { persona } = config
  if (persona.systemPrompt) {
    parts.push(persona.systemPrompt)
  }

  parts.push(`You are ${persona.name}. ${persona.description}`)

  return parts.join('\n\n')
}

function messageToChatMessage(msg: Message): ChatMessage {
  return { role: 'user', content: `[${msg.senderName}]: ${msg.content}` }
}

/**
 * AI-powered agent that delegates text generation to an
 * injected generateFn — keeping core free of LLM imports.
 *
 * Optionally accepts a generateObjectFn for structured output
 * (votes, role actions, etc.) — used when ReplyContext has a schema.
 */
export class AIAgent implements Agent {
  readonly id: string
  readonly config: AgentConfig
  private readonly generateFn: GenerateFn
  private readonly generateObjectFn?: GenerateObjectFn
  private readonly history: Message[] = []

  constructor(config: AgentConfig, generateFn: GenerateFn, generateObjectFn?: GenerateObjectFn) {
    this.id = config.id
    this.config = config
    this.generateFn = generateFn
    this.generateObjectFn = generateObjectFn
  }

  async reply(context: ReplyContext): Promise<Message> {
    const systemPrompt = buildSystemPrompt(this.config)

    // Merge agent's observed history with the recent messages from the room.
    // Deduplicate by id — recentMessages may overlap with history.
    const seen = new Set<string>()
    const allMessages: Message[] = []

    for (const msg of this.history) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id)
        allMessages.push(msg)
      }
    }
    for (const msg of context.recentMessages) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id)
        allMessages.push(msg)
      }
    }

    const chatMessages = allMessages.map(messageToChatMessage)

    // Structured output path — constrained decision via schema
    if (context.schema && this.generateObjectFn) {
      const decision = await this.generateObjectFn(systemPrompt, chatMessages, context.schema, context.instruction)

      return {
        id: crypto.randomUUID(),
        roomId: context.roomId,
        senderId: this.id,
        senderName: this.config.name,
        content: typeof decision === 'object' ? JSON.stringify(decision) : String(decision),
        channelId: context.channelId,
        timestamp: Date.now(),
        metadata: { decision },
      }
    }

    // Standard text generation path
    const content = await this.generateFn(systemPrompt, chatMessages, context.instruction)

    return {
      id: crypto.randomUUID(),
      roomId: context.roomId,
      senderId: this.id,
      senderName: this.config.name,
      content,
      channelId: context.channelId,
      timestamp: Date.now(),
    }
  }

  observe(message: Message): void {
    this.history.push(message)
  }

  getHistory(): readonly Message[] {
    return this.history
  }
}
