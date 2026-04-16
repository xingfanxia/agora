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

export function createModel(config: ModelConfig): LanguageModel {
  const apiKey = resolveApiKey(config)

  switch (config.provider) {
    case 'anthropic': {
      const provider = createAnthropic({ apiKey })
      return provider(config.modelId)
    }
    case 'openai': {
      const provider = createOpenAI({ apiKey })
      return provider(config.modelId)
    }
    case 'google': {
      const provider = createGoogleGenerativeAI({ apiKey })
      return provider(config.modelId)
    }
    case 'deepseek': {
      const provider = createOpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1' })
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
