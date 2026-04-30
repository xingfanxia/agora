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

// 4.5d-2.14: WDK port internals — schemas, role assignment, prompt
// builder. apps/web/app/workflows/werewolf-workflow.ts consumes these
// directly instead of going through the createWerewolf factory (which
// bundles agent construction + event-bus wiring the durable runtime
// doesn't need). 2.18 will tighten the surface again once the legacy
// path is gone.
export {
  createWolfVoteSchema,
  createSeerCheckSchema,
  createWitchActionSchema,
  createGuardProtectSchema,
  createDayVoteSchema,
  createSheriffVoteSchema,
  createSheriffTransferSchema,
  createLastWordsSchema,
  createHunterShootSchema,
  buildRoleSystemPrompt,
  getDefaultRoleDistribution,
  assignWerewolfRoles,
} from './werewolf/index.js'

// Open-chat
export { createOpenChat } from './open-chat/index.js'

export type {
  OpenChatConfig,
  OpenChatAgentConfig,
  OpenChatResult,
  OpenChatGameStateSnapshot,
} from './open-chat/index.js'

// Phase 4.5d-1 — fallback policy registry
export { getFallback, listFallbacks, assertNeverFallback } from './fallback-policies.js'
export type { FallbackAction } from './fallback-policies.js'
