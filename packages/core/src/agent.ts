// ============================================================
// Agora Platform — Agent interface + AIAgent implementation
// ============================================================

import type { Id, Message, ModelConfig, PersonaConfig, TokenUsage } from '@agora/shared'

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
  /** True for human-controlled agents. The runtime pauses before their turn. */
  readonly isHuman?: boolean
}

/** Chat message in LLM-compatible format */
export interface ChatMessage {
  readonly role: string
  readonly content: string
}

/** Text generation result with token usage attached. */
export interface GenerateResult {
  readonly content: string
  readonly usage: TokenUsage
}

/** Structured output result with token usage attached. */
export interface GenerateObjectResult {
  readonly object: unknown
  readonly usage: TokenUsage
}

/**
 * Generate function signature — injected into AIAgent so core
 * has zero dependency on any LLM package.
 */
export type GenerateFn = (
  systemPrompt: string,
  messages: ChatMessage[],
  instruction?: string,
) => Promise<GenerateResult>

/**
 * Structured output generate function — injected optionally
 * for modes that need constrained decisions (votes, actions).
 */
export type GenerateObjectFn = (
  systemPrompt: string,
  messages: ChatMessage[],
  schema: unknown,
  instruction?: string,
) => Promise<GenerateObjectResult>

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
    const { provider, modelId } = this.config.model

    // Structured output path — constrained decision via schema
    if (context.schema && this.generateObjectFn) {
      const { object: decision, usage } = await this.generateObjectFn(
        systemPrompt,
        chatMessages,
        context.schema,
        context.instruction,
      )

      return {
        id: crypto.randomUUID(),
        roomId: context.roomId,
        senderId: this.id,
        senderName: this.config.name,
        content: typeof decision === 'object' ? JSON.stringify(decision) : String(decision),
        channelId: context.channelId,
        timestamp: Date.now(),
        metadata: {
          decision,
          tokenUsage: usage,
          provider,
          modelId,
        },
      }
    }

    // Standard text generation path
    const { content, usage } = await this.generateFn(systemPrompt, chatMessages, context.instruction)

    return {
      id: crypto.randomUUID(),
      roomId: context.roomId,
      senderId: this.id,
      senderName: this.config.name,
      content,
      channelId: context.channelId,
      timestamp: Date.now(),
      metadata: {
        tokenUsage: usage,
        provider,
        modelId,
      },
    }
  }

  observe(message: Message): void {
    this.history.push(message)
  }

  getHistory(): readonly Message[] {
    return this.history
  }
}

// ── Human Agent ────────────────────────────────────────────

/**
 * Sentinel error thrown when the runtime encounters a human agent's turn.
 * The caller catches this to pause the tick chain and wait for human input.
 *
 * NOT a real error — it's a control flow signal. The runtime converts it
 * into a `{ waitingForHuman: agentId }` return value.
 */
export class WaitingForHumanError extends Error {
  readonly agentId: string
  constructor(agentId: string) {
    super(`Waiting for human input from agent ${agentId}`)
    this.name = 'WaitingForHumanError'
    this.agentId = agentId
  }
}

/**
 * Human-controlled agent. `reply()` throws WaitingForHumanError,
 * signaling the runtime to pause and wait for external input.
 *
 * The human's actual message is inserted via the human-input API
 * endpoint and replayed on rehydration, same as AI messages.
 */
export class HumanAgent implements Agent {
  readonly id: string
  readonly config: AgentConfig
  private readonly history: Message[] = []

  constructor(config: Omit<AgentConfig, 'isHuman'>) {
    this.id = config.id
    this.config = { ...config, isHuman: true }
  }

  async reply(_context: ReplyContext): Promise<Message> {
    throw new WaitingForHumanError(this.id)
  }

  observe(message: Message): void {
    this.history.push(message)
  }

  getHistory(): readonly Message[] {
    return this.history
  }
}
