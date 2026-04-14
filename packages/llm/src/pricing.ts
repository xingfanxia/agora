// ============================================================
// Agora LLM — Pricing (LiteLLM-backed, with offline fallback)
// ============================================================
//
// Fetches LiteLLM's open-source pricing JSON once per process and
// caches it. Resolves a (provider, modelId) pair to per-1M-token
// pricing, then calculates the USD cost for a token-usage record.
//
// If the fetch fails (offline, GitHub down), we fall back to a
// small baked-in map so cost tracking still works for the default
// model lineup used by this repo.

import type { LLMProvider, ModelPricing, TokenUsage } from '@agora/shared'

const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/model_prices_and_context_window_backup.json'

/** Raw per-token prices as returned by LiteLLM. */
interface LiteLLMEntry {
  readonly input_cost_per_token?: number
  readonly output_cost_per_token?: number
  readonly cache_creation_input_token_cost?: number
  readonly cache_read_input_token_cost?: number
  readonly litellm_provider?: string
}

type LiteLLMRegistry = Record<string, LiteLLMEntry>

// ── Offline fallback ────────────────────────────────────────
// Prices (per 1M tokens) for the lineup this repo actually uses.
// Only covers default models so tracking stays usable if the
// LiteLLM fetch fails. Update when model lineup changes.
const FALLBACK_PRICING: Record<string, Omit<ModelPricing, 'provider' | 'modelId'>> = {
  'claude-opus-4-6': {
    inputPricePerMillion: 15,
    outputPricePerMillion: 75,
    cachedInputPricePerMillion: 1.5,
    cacheCreationPricePerMillion: 18.75,
  },
  'claude-sonnet-4-6': {
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
    cachedInputPricePerMillion: 0.3,
    cacheCreationPricePerMillion: 3.75,
  },
  'gpt-5.4': {
    inputPricePerMillion: 5,
    outputPricePerMillion: 15,
    cachedInputPricePerMillion: 2.5,
    cacheCreationPricePerMillion: 0,
  },
  'gemini-3.1-pro-preview': {
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 10,
    cachedInputPricePerMillion: 0.3125,
    cacheCreationPricePerMillion: 0,
  },
  'deepseek-chat': {
    inputPricePerMillion: 0.27,
    outputPricePerMillion: 1.1,
    cachedInputPricePerMillion: 0.07,
    cacheCreationPricePerMillion: 0,
  },
}

// ── Fetching / caching ──────────────────────────────────────

let registryPromise: Promise<LiteLLMRegistry> | null = null

async function fetchRegistry(): Promise<LiteLLMRegistry> {
  try {
    const response = await fetch(LITELLM_URL)
    if (!response.ok) {
      throw new Error(`LiteLLM fetch failed: ${response.status}`)
    }
    return (await response.json()) as LiteLLMRegistry
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[pricing] Could not fetch LiteLLM registry (${message}). Falling back to baked-in prices.`)
    return {}
  }
}

/** Load the LiteLLM pricing registry once per process. */
export function loadPricingRegistry(): Promise<LiteLLMRegistry> {
  if (!registryPromise) {
    registryPromise = fetchRegistry()
  }
  return registryPromise
}

/** Reset cached registry — useful for tests. */
export function resetPricingRegistry(): void {
  registryPromise = null
}

// ── Lookup + cost calc ──────────────────────────────────────

function perMillion(perToken: number | undefined): number {
  return (perToken ?? 0) * 1_000_000
}

function registryLookup(
  registry: LiteLLMRegistry,
  modelId: string,
): LiteLLMEntry | null {
  // LiteLLM keys are plain model IDs (no provider prefix) for canonical entries,
  // but many providers have prefixed variants. Try exact match first.
  const direct = registry[modelId]
  if (direct) return direct

  // Fallback: find any key that ends with the model ID (handles vertex/bedrock-style prefixes)
  for (const [key, entry] of Object.entries(registry)) {
    if (key === modelId || key.endsWith(`/${modelId}`)) return entry
  }
  return null
}

/**
 * Resolve pricing for a (provider, modelId). Uses the LiteLLM
 * registry if loaded; otherwise falls back to the offline map.
 */
export async function resolvePricing(
  provider: LLMProvider,
  modelId: string,
): Promise<ModelPricing | null> {
  const registry = await loadPricingRegistry()
  const entry = registryLookup(registry, modelId)

  if (entry) {
    return {
      provider,
      modelId,
      inputPricePerMillion: perMillion(entry.input_cost_per_token),
      outputPricePerMillion: perMillion(entry.output_cost_per_token),
      cachedInputPricePerMillion: perMillion(entry.cache_read_input_token_cost),
      cacheCreationPricePerMillion: perMillion(entry.cache_creation_input_token_cost),
    }
  }

  const fallback = FALLBACK_PRICING[modelId]
  if (fallback) {
    return { provider, modelId, ...fallback }
  }

  return null
}

/**
 * Calculate USD cost from a TokenUsage snapshot + ModelPricing.
 * Returns 0 if pricing is null (unknown model).
 */
export function calculateCost(usage: TokenUsage, pricing: ModelPricing | null): number {
  if (!pricing) return 0
  const perM = 1_000_000
  return (
    (usage.inputTokens * pricing.inputPricePerMillion) / perM +
    (usage.outputTokens * pricing.outputPricePerMillion) / perM +
    (usage.cachedInputTokens * pricing.cachedInputPricePerMillion) / perM +
    (usage.cacheCreationTokens * pricing.cacheCreationPricePerMillion) / perM
  )
}

/**
 * Synchronous cost calculator built from a preloaded pricing map.
 * Prefer this for hot paths — avoids awaiting the registry per call.
 */
export function createCostCalculator(
  pricingMap: ReadonlyMap<string, ModelPricing>,
): (provider: LLMProvider, modelId: string, usage: TokenUsage) => number {
  return (provider, modelId, usage) => {
    const key = `${provider}:${modelId}`
    const pricing = pricingMap.get(key) ?? null
    return calculateCost(usage, pricing)
  }
}

/**
 * Pre-resolve pricing for a set of (provider, modelId) pairs and
 * return a map suitable for `createCostCalculator`.
 */
export async function buildPricingMap(
  modelConfigs: ReadonlyArray<{ provider: LLMProvider; modelId: string }>,
): Promise<Map<string, ModelPricing>> {
  const map = new Map<string, ModelPricing>()
  const seen = new Set<string>()
  for (const { provider, modelId } of modelConfigs) {
    const key = `${provider}:${modelId}`
    if (seen.has(key)) continue
    seen.add(key)
    const pricing = await resolvePricing(provider, modelId)
    if (pricing) {
      map.set(key, pricing)
    } else {
      console.warn(`[pricing] No pricing found for ${key} — cost will be 0.`)
    }
  }
  return map
}
