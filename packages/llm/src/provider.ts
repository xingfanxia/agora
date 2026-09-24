import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { APICallError, type LanguageModel } from 'ai'
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

// OpenAI models are served by Azure OpenAI first when AZURE_OPENAI_ENDPOINT +
// AZURE_OPENAI_API_KEY are set and the model has an Azure deployment here; the
// official OpenAI API is the fallback. Models without a deployment (gpt-4o)
// and runs without Azure env call OpenAI directly, as before.
const AZURE_OPENAI_DEPLOYMENTS: Record<string, string> = {
  'gpt-5.4': 'gpt-5.4-standard',
}

type SdkModel = ReturnType<ReturnType<typeof createOpenAI>>

function createOpenAIModel(config: ModelConfig): LanguageModel {
  // An explicit key means that OpenAI account, never the shared Azure resource.
  if (config.apiKey) return createOpenAI({ apiKey: config.apiKey })(config.modelId)
  const endpoint = process.env['AZURE_OPENAI_ENDPOINT']?.trim()
  const azureKey = process.env['AZURE_OPENAI_API_KEY']?.trim()
  const deployment = AZURE_OPENAI_DEPLOYMENTS[config.modelId]
  const openaiKey = process.env['OPENAI_API_KEY']
  const azure =
    endpoint && azureKey && deployment
      ? createOpenAI({
          apiKey: azureKey,
          baseURL: endpoint.replace(/\/$/, ''),
          headers: { 'api-key': azureKey },
        })(deployment)
      : undefined
  const openai = openaiKey ? createOpenAI({ apiKey: openaiKey })(config.modelId) : undefined
  if (azure && openai) return withAvailabilityFallback(azure, openai)
  return azure ?? openai ?? createOpenAI({ apiKey: resolveApiKey(config) })(config.modelId)
}

/** Azure could not serve the call (429, 5xx, no connection), so OpenAI may. */
export function isAvailabilityError(err: unknown): boolean {
  if (!APICallError.isInstance(err)) return false
  const status = err.statusCode
  return status === undefined || status === 429 || status >= 500
}

/**
 * Content-filter and other 4xx errors, and caller aborts, propagate unchanged.
 * Streams switch hosts only before the first chunk: doStream resolves after
 * the HTTP status, so a mid-stream error still reaches the caller.
 */
export function withAvailabilityFallback(primary: SdkModel, fallback: SdkModel): SdkModel {
  const attempt = async <T>(label: string, call: (m: SdkModel) => PromiseLike<T>): Promise<T> => {
    try {
      return await call(primary)
    } catch (err) {
      if (!isAvailabilityError(err)) throw err
      console.warn(
        `[llm] ${label}: ${primary.provider} ${primary.modelId} unavailable (${(err as Error).message}), ` +
          `falling back to ${fallback.provider} ${fallback.modelId}`,
      )
      return call(fallback)
    }
  }
  return {
    specificationVersion: primary.specificationVersion,
    provider: primary.provider,
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    doGenerate: (options) => attempt('generate', (m) => m.doGenerate(options)),
    doStream: (options) => attempt('stream', (m) => m.doStream(options)),
  }
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
    case 'openai':
      return createOpenAIModel(config)
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
