import { generateText } from 'ai'
import type { LanguageModel } from 'ai'
import type { ModelConfig } from '@agora/shared'
import { createModel } from './provider'

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string
}

export type GenerateFn = (
  systemPrompt: string,
  messages: { role: string; content: string }[],
  instruction?: string
) => Promise<string>

export async function generate(
  model: LanguageModel,
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  try {
    const result = await generateText({
      model,
      messages,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    })
    return result.text
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`LLM generation failed: ${message}`)
  }
}

export function createGenerateFn(config: ModelConfig): GenerateFn {
  const model = createModel(config)

  return async (systemPrompt, messages, instruction) => {
    const chatMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role as ChatMessage['role'],
        content: m.content,
      })),
    ]

    if (instruction) {
      chatMessages.push({ role: 'user', content: instruction })
    }

    // Vercel AI SDK requires at least one non-system message
    if (chatMessages.length === 1 && chatMessages[0]!.role === 'system') {
      chatMessages.push({ role: 'user', content: 'Please share your opening thoughts.' })
    }

    return generate(model, chatMessages, {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
    })
  }
}

// TODO: generateWithStream — streaming support for Phase 2
// export function createStreamFn(config: ModelConfig) { ... }
