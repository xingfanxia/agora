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
  'claude-sonnet-4-20250514': 'Claude Sonnet 4',
  'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
  'claude-3-opus-20240229': 'Claude 3 Opus',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4-turbo': 'GPT-4 Turbo',
  'gpt-5.4': 'GPT-5.4',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'gemini-2.0-pro': 'Gemini 2.0 Pro',
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
      const deployment = process.env['AZURE_OPENAI_DEPLOYMENT'] ?? config.modelId
      const apiVersion = process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-12-01-preview'
      if (!endpoint) {
        throw new Error('Missing AZURE_OPENAI_ENDPOINT environment variable')
      }
      const provider = createOpenAI({
        apiKey,
        baseURL: `${endpoint.replace(/\/$/, '')}/deployments/${deployment}`,
        headers: { 'api-key': apiKey },
        compatibility: 'compatible',
        fetch: (url, init) => {
          // Azure requires api-version query param
          const separator = String(url).includes('?') ? '&' : '?'
          return fetch(`${url}${separator}api-version=${apiVersion}`, init)
        },
      })
      return provider(config.modelId)
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
