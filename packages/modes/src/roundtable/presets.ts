// ============================================================
// Agora Platform — Roundtable Preset Debater Personas
// ============================================================

import type { ModelConfig } from '@agora/shared'
import type { RoundtableAgentConfig, RoundtableConfig } from './index.js'

// ── Preset Agent Library ───────────────────────────────────

interface PresetAgent {
  readonly name: string
  readonly persona: string
  readonly defaultModel: ModelConfig
}

export const PRESET_AGENTS: Record<string, PresetAgent> = {
  philosopher: {
    name: 'The Philosopher',
    persona:
      'Thinks deeply about first principles. References philosophy and ethics. Asks probing questions that challenge surface-level thinking.',
    defaultModel: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
  },
  pragmatist: {
    name: 'The Pragmatist',
    persona:
      'Focused on practical outcomes and real-world impact. Data-driven, no-nonsense. Cuts through abstract thinking to ask "but will it actually work?"',
    defaultModel: { provider: 'openai', modelId: 'gpt-4o' },
  },
  devils_advocate: {
    name: "Devil's Advocate",
    persona:
      'Always takes the contrarian position. Challenges assumptions and pokes holes in arguments. Forces the group to defend their reasoning.',
    defaultModel: { provider: 'google', modelId: 'gemini-2.5-flash-preview-04-17' },
  },
  optimist: {
    name: 'The Optimist',
    persona:
      'Sees the bright side of every argument. Focuses on opportunities, potential, and positive outcomes. Builds on ideas rather than tearing them down.',
    defaultModel: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
  },
  skeptic: {
    name: 'The Skeptic',
    persona:
      'Questions everything and demands evidence. Distrusts hype and conventional wisdom. Won\'t accept claims without solid reasoning.',
    defaultModel: { provider: 'openai', modelId: 'gpt-4o' },
  },
} as const

// ── Helpers ────────────────────────────────────────────────

const PRESET_KEYS = Object.keys(PRESET_AGENTS) as (keyof typeof PRESET_AGENTS)[]

function pickRandom<T>(items: readonly T[], count: number): T[] {
  const shuffled = [...items].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

function presetToAgentConfig(preset: PresetAgent): RoundtableAgentConfig {
  return {
    name: preset.name,
    persona: preset.persona,
    model: preset.defaultModel,
  }
}

// ── Factory ────────────────────────────────────────────────

/**
 * Create a RoundtableConfig from preset debater personas.
 *
 * @param topic    - The debate topic
 * @param presetNames - Keys from PRESET_AGENTS (e.g. ['philosopher', 'skeptic']).
 *                      If omitted, picks 3 random presets.
 * @param rounds   - Number of debate rounds (default 3)
 */
export function createPresetRoundtable(
  topic: string,
  presetNames?: string[],
  rounds?: number,
): RoundtableConfig {
  const keys = presetNames ?? pickRandom(PRESET_KEYS, 3)

  const agents = keys.map((key) => {
    const preset = PRESET_AGENTS[key]
    if (!preset) {
      throw new Error(`Unknown preset agent: "${key}". Available: ${PRESET_KEYS.join(', ')}`)
    }
    return presetToAgentConfig(preset)
  })

  return {
    topic,
    rounds: rounds ?? 3,
    agents,
  }
}
