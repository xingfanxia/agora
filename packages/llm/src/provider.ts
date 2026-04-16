import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import type { LLMProvider, ModelConfig } from '@agora/shared'

const ENV_KEY_MAP: Record<LLMProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  'azure-openai': 'AZURE_OPENAI_API_KEY',
}

const PROVIDER_DISPLAY: Record<LLMProvider, string> = {
  anthropic: 'Claude',
  openai: 'GPT',
  google: 'Gemini',
  deepseek: 'DeepSeek',
  'azure-openai': 'Azure GPT',
}

const MODEL_DISPLAY: Record<string, string> = {
  'claude-opus-4-7': 'Claude Opus 4.7',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'gpt-5.4': 'GPT-5.4',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
  'deepseek-chat': 'DeepSeek Chat',
  'deepseek-reasoner': 'DeepSeek Reasoner',
}

function resolveApiKey(config: ModelConfig): string {
  const key = config.apiKey ?? process.env[ENV_KEY_MAP[config.provider]]
  if (!key) {
    throw new Error(
      `Missing API key for provider "${config.provider}". ` +
        `Set ${ENV_KEY_MAP[config.provider]} environment variable or pass apiKey in ModelConfig.`
    )
  }
  return key
}

/**
 * Vercel AI SDK v4 hardcodes `temperature: 0` into the request body when the
 * caller omits it (see ai@4.3.19/dist/index.js line 1697). Claude Opus 4.7
 * and other reasoning-first models reject ANY temperature field with
 * "`temperature` is deprecated for this model". We intercept the outgoing
 * JSON body and strip `temperature` before it reaches Anthropic.
 *
 * Applied uniformly across providers — temperature-free requests are safe for
 * every current model and prevent the SDK's hardcoded default from leaking
 * onto the wire.
 */
const stripTemperatureFetch: typeof fetch = async (input, init) => {
  if (init?.body && typeof init.body === 'string') {
    try {
      const parsed = JSON.parse(init.body) as Record<string, unknown>
      if ('temperature' in parsed) {
        delete parsed.temperature
        init = { ...init, body: JSON.stringify(parsed) }
      }
    } catch {
      // Non-JSON body (streaming multipart etc.) — leave untouched.
    }
  }
  return fetch(input, init)
}

export function createModel(config: ModelConfig): LanguageModel {
  const apiKey = resolveApiKey(config)

  switch (config.provider) {
    case 'anthropic': {
      const provider = createAnthropic({ apiKey, fetch: stripTemperatureFetch })
      return provider(config.modelId)
    }
    case 'openai': {
      const provider = createOpenAI({ apiKey, fetch: stripTemperatureFetch })
      return provider(config.modelId)
    }
    case 'google': {
      const provider = createGoogleGenerativeAI({ apiKey, fetch: stripTemperatureFetch })
      return provider(config.modelId)
    }
    case 'deepseek': {
      const provider = createOpenAI({
        apiKey,
        baseURL: 'https://api.deepseek.com/v1',
        fetch: stripTemperatureFetch,
      })
      return provider(config.modelId)
    }
    case 'azure-openai': {
      const endpoint = process.env['AZURE_OPENAI_ENDPOINT']
      if (!endpoint) {
        throw new Error('Missing AZURE_OPENAI_ENDPOINT environment variable')
      }
      const deployment = process.env['AZURE_OPENAI_DEPLOYMENT'] ?? config.modelId
      const provider = createOpenAI({
        apiKey,
        baseURL: endpoint.replace(/\/$/, ''),
        headers: { 'api-key': apiKey },
        fetch: stripTemperatureFetch,
      })
      return provider(deployment)
    }
    default: {
      const _exhaustive: never = config.provider
      throw new Error(`Unsupported provider: ${_exhaustive}`)
    }
  }
}

export function getProviderDisplayName(provider: LLMProvider): string {
  return PROVIDER_DISPLAY[provider] ?? provider
}

export function getModelDisplayName(modelId: string): string {
  return MODEL_DISPLAY[modelId] ?? modelId
}
