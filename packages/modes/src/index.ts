// ============================================================
// Agora Platform — Mode plugins
// ============================================================

export {
  createRoundtable,
  runRoundtable,
  createDebaterPrompt,
} from './roundtable/index.js'

export type {
  RoundtableConfig,
  RoundtableAgentConfig,
  RoundtableResult,
} from './roundtable/index.js'

export {
  PRESET_AGENTS,
  createPresetRoundtable,
} from './roundtable/presets.js'
