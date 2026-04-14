// ============================================================
// Agora Werewolf Mode — Public API
// ============================================================

import {
  AIAgent,
  EventBus,
  Room,
  StateMachineFlow,
  type GenerateFn,
  type GenerateObjectFn,
} from '@agora/core'
import type { ModelConfig } from '@agora/shared'
import { buildRoleSystemPrompt, getDefaultRoleDistribution } from './roles.js'
import { createWerewolfStateMachineConfig } from './phases.js'
import type { WerewolfRole, WerewolfGameState, WerewolfAdvancedRules } from './types.js'

// ── Types ──────────────────────────────────────────────────

export interface WerewolfAgentConfig {
  readonly name: string
  readonly model: ModelConfig
}

export interface WerewolfConfig {
  readonly agents: readonly WerewolfAgentConfig[]
  /** Toggle advanced rules (guard, idiot, sheriff, lastWords) */
  readonly advancedRules?: WerewolfAdvancedRules
  /** Override role assignment (agent name → role) */
  readonly roleOverrides?: Record<string, WerewolfRole>
  /** Directive appended to every agent's system prompt (e.g. "respond in Chinese"). */
  readonly languageInstruction?: string
}

export interface WerewolfResult {
  readonly room: Room
  readonly eventBus: EventBus
  readonly flow: StateMachineFlow
  readonly roleAssignments: Record<string, WerewolfRole>
  readonly agentNames: Record<string, string>
  readonly advancedRules: WerewolfAdvancedRules
}

// ── Role Assignment ────────────────────────────────────────

function shuffleArray<T>(array: T[]): T[] {
  const result = [...array]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}

function assignRoles(
  agentIds: string[],
  agentNames: Record<string, string>,
  advancedRules: WerewolfAdvancedRules,
  roleOverrides?: Record<string, WerewolfRole>,
): Map<string, WerewolfRole> {
  if (roleOverrides) {
    const map = new Map<string, WerewolfRole>()
    for (const id of agentIds) {
      // Look up by name since overrides use names
      const name = agentNames[id]!
      const role = roleOverrides[name]
      if (!role) throw new Error(`Missing role override for agent "${name}"`)
      map.set(id, role)
    }
    return map
  }

  const roles = getDefaultRoleDistribution(agentIds.length, advancedRules)
  const shuffledRoles = shuffleArray(roles)
  const map = new Map<string, WerewolfRole>()
  agentIds.forEach((id, i) => map.set(id, shuffledRoles[i]!))
  return map
}

// ── Factory ────────────────────────────────────────────────

export function createWerewolf(
  config: WerewolfConfig,
  createGenFn: (model: ModelConfig) => GenerateFn,
  createObjFn: (model: ModelConfig) => GenerateObjectFn,
): WerewolfResult {
  const rules = config.advancedRules ?? {}

  if (config.agents.length < 6) throw new Error('Werewolf requires at least 6 players')
  if (config.agents.length > 12) throw new Error('Werewolf supports at most 12 players')

  const eventBus = new EventBus()
  const roomId = crypto.randomUUID()
  const room = new Room(
    { id: roomId, name: 'Werewolf', modeId: 'werewolf', maxAgents: 12 },
    eventBus,
  )

  // Create agents
  const agentIds: string[] = []
  const agentNames: Record<string, string> = {}

  for (const agentConfig of config.agents) {
    const agentId = crypto.randomUUID()
    agentIds.push(agentId)
    agentNames[agentId] = agentConfig.name

    const agent = new AIAgent(
      {
        id: agentId,
        name: agentConfig.name,
        persona: { name: agentConfig.name, description: 'A player in the werewolf game' },
        model: agentConfig.model,
      },
      createGenFn(agentConfig.model),
      createObjFn(agentConfig.model),
    )
    room.addAgent(agent)
  }

  // Assign roles
  const roleMap = assignRoles(agentIds, agentNames, rules, config.roleOverrides)
  const roleAssignments: Record<string, WerewolfRole> = {}
  for (const [id, role] of roleMap) roleAssignments[id] = role

  // Build role-specific system prompts → recreate agents
  const allPlayerNames = agentIds.map((id) => agentNames[id]!)
  const wolfIds = agentIds.filter((id) => roleMap.get(id) === 'werewolf')
  const wolfNames = wolfIds.map((id) => agentNames[id]!)

  for (const agentId of agentIds) {
    const role = roleMap.get(agentId)!
    const name = agentNames[agentId]!
    const systemPrompt = buildRoleSystemPrompt(
      name,
      role,
      allPlayerNames,
      wolfNames,
      config.languageInstruction,
    )
    const agentConfig = config.agents.find((a) => a.name === name)!

    room.removeAgent(agentId)
    room.addAgent(new AIAgent(
      {
        id: agentId,
        name,
        persona: { name, description: `${role} in the werewolf game` },
        model: agentConfig.model,
        systemPrompt,
      },
      createGenFn(agentConfig.model),
      createObjFn(agentConfig.model),
    ))
  }

  // Set up channels
  const channels = [
    { id: 'werewolf', name: 'Werewolf Night' },
    { id: 'seer-result', name: 'Seer Investigation' },
    { id: 'witch-action', name: 'Witch Action' },
    { id: 'wolf-vote', name: 'Wolf Vote (blind)' },
    { id: 'day-vote', name: 'Day Vote (blind)' },
  ]
  if (rules.guard) channels.push({ id: 'guard-action', name: 'Guard Action' })

  for (const ch of channels) {
    room.channels.createChannel({ id: ch.id, roomId, name: ch.name, parentId: null, autoBroadcast: false })
  }

  // Subscribe roles to private channels
  for (const wid of wolfIds) room.channels.subscribe('werewolf', wid)
  for (const id of agentIds.filter((id) => roleMap.get(id) === 'seer')) room.channels.subscribe('seer-result', id)
  for (const id of agentIds.filter((id) => roleMap.get(id) === 'witch')) room.channels.subscribe('witch-action', id)
  if (rules.guard) {
    for (const id of agentIds.filter((id) => roleMap.get(id) === 'guard')) room.channels.subscribe('guard-action', id)
  }

  // Create flow
  const smConfig = createWerewolfStateMachineConfig(rules)
  const flow = new StateMachineFlow(smConfig)

  // Initialize game state
  const wState: WerewolfGameState = {
    roleMap: roleAssignments,
    eliminatedIds: [],
    lastNightKill: null,
    witchSaveUsed: false,
    witchPoisonUsed: false,
    witchPoisonTarget: null,
    witchUsedPotionTonight: false,
    seerResult: null,
    nightNumber: 1,
    agentNames,
    hunterCanShoot: false,
    hunterPendingId: null,
    hunterShotTarget: null,
    guardProtectedId: null,
    guardLastProtectedId: null,
    idiotRevealedIds: [],
    sheriffId: null,
    sheriffElected: false,
    pendingLastWordsIds: [],
    winResult: null,
    advancedRules: rules,
  }

  flow.setGameState({
    roles: roleMap,
    activeAgentIds: new Set(agentIds),
    custom: wState as unknown as Record<string, unknown>,
  })

  return { room, eventBus, flow, roleAssignments, agentNames, advancedRules: rules }
}

export async function runWerewolf(
  config: WerewolfConfig,
  createGenFn: (model: ModelConfig) => GenerateFn,
  createObjFn: (model: ModelConfig) => GenerateObjectFn,
): Promise<WerewolfResult> {
  const result = createWerewolf(config, createGenFn, createObjFn)
  await result.room.start(result.flow)
  return result
}

// Re-export types
export type { WerewolfRole, WerewolfGameState, WerewolfAdvancedRules } from './types.js'
export { checkWinCondition } from './types.js'
