import { generateText, generateObject } from 'ai'
import type { LanguageModel } from 'ai'
import type { ModelConfig, TokenUsage } from '@agora/shared'
import type { ZodSchema } from 'zod'
import { createModel } from './provider'

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant'
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

export type GenerateFn = (
  systemPrompt: string,
  messages: { role: string; content: string }[],
  instruction?: string,
) => Promise<GenerateResult>

/**
 * Structured output generate function — returns a parsed object
 * conforming to the provided Zod schema + token usage.
 */
export type GenerateObjectFn = (
  systemPrompt: string,
  messages: { role: string; content: string }[],
  schema: ZodSchema,
  instruction?: string,
) => Promise<GenerateObjectResult>

// ── Usage extraction ─────────────────────────────────────────

/**
 * Shape-flexible extraction — covers both v4 (promptTokens/completionTokens)
 * and any future renames. Provider-specific fields (prompt caching, reasoning)
 * come from `providerMetadata`.
 */
function extractUsage(result: {
  usage?: Record<string, unknown>
  providerMetadata?: Record<string, unknown>
}): TokenUsage {
  const usage = (result.usage ?? {}) as Record<string, number | undefined>
  const meta = (result.providerMetadata ?? {}) as Record<string, unknown>

  const anthropic = (meta['anthropic'] ?? {}) as Record<string, number | undefined>
  const openai = (meta['openai'] ?? {}) as Record<string, number | undefined>

  const inputTokens =
    usage['promptTokens'] ?? usage['inputTokens'] ?? usage['prompt_tokens'] ?? 0
  const outputTokens =
    usage['completionTokens'] ??
    usage['outputTokens'] ??
    usage['completion_tokens'] ??
    0
  const cachedInputTokens = Number(anthropic['cacheReadInputTokens'] ?? 0)
  const cacheCreationTokens = Number(anthropic['cacheCreationInputTokens'] ?? 0)
  const reasoningTokens = Number(
    openai['reasoningTokens'] ?? usage['reasoningTokens'] ?? 0,
  )
  const totalTokens =
    usage['totalTokens'] ?? usage['total_tokens'] ?? inputTokens + outputTokens

  return {
    inputTokens: Number(inputTokens),
    outputTokens: Number(outputTokens),
    cachedInputTokens,
    cacheCreationTokens,
    reasoningTokens,
    totalTokens: Number(totalTokens),
  }
}

// ── Core primitive ───────────────────────────────────────────

export async function generate(
  model: LanguageModel,
  messages: ChatMessage[],
  options?: { maxTokens?: number },
): Promise<GenerateResult> {
  // Temperature intentionally omitted — deprecated on Claude Opus 4.7 and
  // semantically unreliable on reasoning-first models generally. We let the
  // provider use its own default.
  try {
    const result = await generateText({
      model,
      messages,
      maxOutputTokens: options?.maxTokens,
    })
    return { content: result.text, usage: extractUsage(result) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`LLM generation failed: ${message}`)
  }
}

// ── Factories ────────────────────────────────────────────────

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
      chatMessages.push({
        role: 'user',
        content: 'Please make your decision. Respond with a valid JSON object.',
      })
    }

    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Temperature omitted — deprecated on newer Claude models and unreliable
        // elsewhere. Retries rely on the model's native sampling variance.
        const result = await generateObject({
          model,
          messages: chatMessages,
          schema: schema as ZodSchema,
          maxOutputTokens: config.maxTokens ? Math.max(config.maxTokens, 500) : 500,
        })
        return { object: result.object, usage: extractUsage(result) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (attempt < maxAttempts) {
          console.warn(
            `Structured generation attempt ${attempt}/${maxAttempts} failed: ${message}. Retrying...`,
          )
          continue
        }
        throw new Error(`Structured generation failed after ${maxAttempts} attempts: ${message}`)
      }
    }

    throw new Error('Structured generation failed')
  }
}
