// ============================================================
// Agora Platform — Agent interface + AIAgent implementation
// ============================================================

import type { Id, Message, ModelConfig, PersonaConfig } from '@agora/shared'

// ── Interfaces ──────────────────────────────────────────────

/** What the FlowController passes to an agent on their turn */
export interface ReplyContext {
  readonly roomId: string
  readonly phase: string
  readonly recentMessages: readonly Message[]
  readonly instruction?: string
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
 */
export class AIAgent implements Agent {
  readonly id: string
  readonly config: AgentConfig
  private readonly generateFn: GenerateFn
  private readonly history: Message[] = []

  constructor(config: AgentConfig, generateFn: GenerateFn) {
    this.id = config.id
    this.config = config
    this.generateFn = generateFn
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
    const content = await this.generateFn(systemPrompt, chatMessages, context.instruction)

    const message: Message = {
      id: crypto.randomUUID(),
      roomId: context.roomId,
      senderId: this.id,
      senderName: this.config.name,
      content,
      channelId: 'main',
      timestamp: Date.now(),
    }

    return message
  }

  observe(message: Message): void {
    this.history.push(message)
  }

  getHistory(): readonly Message[] {
    return this.history
  }
}
