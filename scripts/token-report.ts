#!/usr/bin/env npx tsx
// ============================================================
// Agora — Token Pricing Report
// Lookup LiteLLM prices for the default model lineup and show
// a rough cost projection for a standard werewolf game.
// ============================================================

import { resolvePricing, calculateCost } from '../packages/llm/src/index'
import type { LLMProvider, ModelPricing, TokenUsage } from '../packages/shared/src/index'

const MODELS: { provider: LLMProvider; modelId: string; label: string }[] = [
  { provider: 'anthropic', modelId: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { provider: 'anthropic', modelId: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { provider: 'openai', modelId: 'gpt-5.4', label: 'GPT-5.4' },
  { provider: 'google', modelId: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { provider: 'deepseek', modelId: 'deepseek-chat', label: 'DeepSeek Chat' },
]

/** Rough token profile for one werewolf game call (text + structured output mix). */
const AVG_TOKENS_PER_CALL: TokenUsage = {
  inputTokens: 2500,
  outputTokens: 350,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  reasoningTokens: 0,
  totalTokens: 2850,
}

const CALLS_PER_GAME = 60

async function main() {
  console.log('='.repeat(80))
  console.log('AGORA — TOKEN PRICING REPORT')
  console.log('='.repeat(80))
  console.log('')
  console.log('Prices in USD per 1M tokens. Source: LiteLLM registry.')
  console.log('')

  const rows: Array<{
    label: string
    pricing: ModelPricing | null
    projectedCost: number
  }> = []

  for (const { provider, modelId, label } of MODELS) {
    const pricing = await resolvePricing(provider, modelId)
    const projectedCost = calculateCost(AVG_TOKENS_PER_CALL, pricing) * CALLS_PER_GAME
    rows.push({ label, pricing, projectedCost })
  }

  const header = ['Model', 'Input', 'Output', 'Cache-Read', 'Cache-Write', `Projected (${CALLS_PER_GAME} calls)`]
  const widths = [28, 10, 10, 12, 12, 28]

  const row = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!, ' ')).join(' │ ')

  console.log(row(header))
  console.log(widths.map((w) => '─'.repeat(w)).join('─┼─'))

  for (const { label, pricing, projectedCost } of rows) {
    if (!pricing) {
      console.log(row([label, '—', '—', '—', '—', 'n/a']))
      continue
    }
    console.log(
      row([
        label,
        `$${pricing.inputPricePerMillion.toFixed(2)}`,
        `$${pricing.outputPricePerMillion.toFixed(2)}`,
        `$${pricing.cachedInputPricePerMillion.toFixed(2)}`,
        `$${pricing.cacheCreationPricePerMillion.toFixed(2)}`,
        `$${projectedCost.toFixed(4)}`,
      ]),
    )
  }

  console.log('')
  console.log('Projection assumes ~2500 input / 350 output tokens per call.')
  console.log('Real games vary — check the per-game transcript for actuals.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
