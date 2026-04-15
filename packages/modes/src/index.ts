// ============================================================
// Agora Platform — Mode plugins
// ============================================================

// Roundtable Debate
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

// Werewolf
export {
  createWerewolf,
  runWerewolf,
  checkWinCondition,
} from './werewolf/index.js'

export type {
  WerewolfConfig,
  WerewolfAgentConfig,
  WerewolfResult,
  WerewolfRole,
  WerewolfGameState,
  WerewolfAdvancedRules,
} from './werewolf/index.js'

// Open-chat
export { createOpenChat } from './open-chat/index.js'

export type {
  OpenChatConfig,
  OpenChatAgentConfig,
  OpenChatResult,
  OpenChatGameStateSnapshot,
} from './open-chat/index.js'
