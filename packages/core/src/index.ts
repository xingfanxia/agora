// ============================================================
// Agora Platform — Core package public API
// ============================================================

export { EventBus } from './events.js'

export { AIAgent } from './agent.js'
export type {
  Agent,
  AgentConfig,
  ChatMessage,
  GenerateFn,
  GenerateObjectFn,
  GenerateResult,
  GenerateObjectResult,
  ReplyContext,
} from './agent.js'

export { RoundRobinFlow } from './flow.js'
export type { FlowController, FlowTick, RoundRobinConfig } from './flow.js'

export { StateMachineFlow } from './state-machine.js'
export type {
  GameState,
  PhaseConfig,
  PhaseDecisions,
  TransitionRule,
  TransitionContext,
  StateMachineConfig,
  Announcement,
} from './state-machine.js'

export { Channel, ChannelManager } from './channel.js'

export { Room } from './room.js'

export { TokenAccountant, formatSummary } from './token-accountant.js'
export type {
  CalculateCostFn,
  AgentTokenTotals,
  ModelTokenTotals,
  RoomTokenSummary,
} from './token-accountant.js'
