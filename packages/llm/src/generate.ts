import { generateText, generateObject } from 'ai'
import type { LanguageModel } from 'ai'
import type { ModelConfig } from '@agora/shared'
import type { ZodSchema } from 'zod'
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

/**
 * Structured output generate function — returns a parsed object
 * conforming to the provided Zod schema. Used for constrained
 * decisions like votes, role actions, etc.
 */
export type GenerateObjectFn = (
  systemPrompt: string,
  messages: { role: string; content: string }[],
  schema: ZodSchema,
  instruction?: string
) => Promise<unknown>

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

/**
 * Create a structured output generate function using Vercel AI SDK's
 * generateObject. Constrains LLM output to match a Zod schema.
 *
 * Includes retry logic — structured output can fail when the model
 * produces output that doesn't match the schema exactly.
 */
export function createGenerateObjectFn(config: ModelConfig): GenerateObjectFn {
  const model = createModel(config)

  return async (systemPrompt, messages, schema, instruction) => {
    const chatMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role as ChatMessage['role'],
        content: m.content,
      })),
    ]

    if (instruction) {
      chatMessages.push({
        role: 'user',
        content: `${instruction}\n\nRespond ONLY with a valid JSON object matching the required schema. Do not include any other text.`,
      })
    }

    // Vercel AI SDK requires at least one non-system message
    if (chatMessages.length === 1 && chatMessages[0]!.role === 'system') {
      chatMessages.push({ role: 'user', content: 'Please make your decision. Respond with a valid JSON object.' })
    }

    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await generateObject({
          model,
          messages: chatMessages,
          schema: schema as ZodSchema,
          temperature: attempt === 1 ? config.temperature : Math.max(0.3, (config.temperature ?? 0.7) - 0.2),
          maxTokens: config.maxTokens ? Math.max(config.maxTokens, 500) : 500,
        })
        return result.object
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (attempt < maxAttempts) {
          console.warn(`Structured generation attempt ${attempt}/${maxAttempts} failed: ${message}. Retrying...`)
          continue
        }
        throw new Error(`Structured generation failed after ${maxAttempts} attempts: ${message}`)
      }
    }

    // Unreachable, but TypeScript needs it
    throw new Error('Structured generation failed')
  }
}
