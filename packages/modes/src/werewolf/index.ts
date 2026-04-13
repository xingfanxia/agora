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
import type { ModelConfig, Message } from '@agora/shared'
import { buildRoleSystemPrompt, getDefaultRoleDistribution } from './roles.js'
import { createWerewolfStateMachineConfig } from './phases.js'
import type { WerewolfRole, WerewolfGameState } from './types.js'

// ── Types ──────────────────────────────────────────────────

export interface WerewolfAgentConfig {
  readonly name: string
  readonly model: ModelConfig
}

export interface WerewolfConfig {
  readonly agents: readonly WerewolfAgentConfig[]
  /** Optional role override — if not provided, uses default distribution */
  readonly roleOverrides?: Record<string, WerewolfRole>
}

export interface WerewolfResult {
  readonly room: Room
  readonly eventBus: EventBus
  readonly flow: StateMachineFlow
  readonly roleAssignments: Record<string, WerewolfRole>
  readonly agentNames: Record<string, string>
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
  roleOverrides?: Record<string, WerewolfRole>,
): Map<string, WerewolfRole> {
  if (roleOverrides) {
    const map = new Map<string, WerewolfRole>()
    for (const id of agentIds) {
      const role = roleOverrides[id]
      if (!role) throw new Error(`Missing role override for agent ${id}`)
      map.set(id, role)
    }
    return map
  }

  const roles = getDefaultRoleDistribution(agentIds.length)
  const shuffledRoles = shuffleArray(roles)
  const map = new Map<string, WerewolfRole>()
  agentIds.forEach((id, i) => {
    map.set(id, shuffledRoles[i]!)
  })
  return map
}

// ── Factory ────────────────────────────────────────────────

/**
 * Create a werewolf game — instantiates Room, agents, channels, and flow.
 *
 * Requires two function factories:
 *  - createGenerateFn(config) → GenerateFn (text generation)
 *  - createGenerateObjectFn(config) → GenerateObjectFn (structured output)
 *
 * These are injected to keep the modes package free of direct LLM imports.
 */
export function createWerewolf(
  config: WerewolfConfig,
  createGenFn: (model: ModelConfig) => GenerateFn,
  createObjFn: (model: ModelConfig) => GenerateObjectFn,
): WerewolfResult {
  if (config.agents.length < 6) {
    throw new Error('Werewolf requires at least 6 players')
  }
  if (config.agents.length > 12) {
    throw new Error('Werewolf supports at most 12 players')
  }

  const eventBus = new EventBus()
  const roomId = crypto.randomUUID()
  const room = new Room(
    { id: roomId, name: 'Werewolf', modeId: 'werewolf', maxAgents: 12 },
    eventBus,
  )

  // Create agents and collect IDs
  const agentIds: string[] = []
  const agentNames: Record<string, string> = {}

  for (const agentConfig of config.agents) {
    const agentId = crypto.randomUUID()
    agentIds.push(agentId)
    agentNames[agentId] = agentConfig.name

    // Placeholder system prompt — will be replaced after role assignment
    const generateFn = createGenFn(agentConfig.model)
    const generateObjectFn = createObjFn(agentConfig.model)

    const agent = new AIAgent(
      {
        id: agentId,
        name: agentConfig.name,
        persona: { name: agentConfig.name, description: 'A player in the werewolf game' },
        model: agentConfig.model,
        // System prompt will be set via persona.systemPrompt below
      },
      generateFn,
      generateObjectFn,
    )

    room.addAgent(agent)
  }

  // Assign roles
  const roleMap = assignRoles(agentIds, config.roleOverrides)
  const roleAssignments: Record<string, WerewolfRole> = {}
  for (const [id, role] of roleMap) {
    roleAssignments[id] = role
  }

  // Build role-specific system prompts and update agents
  const allPlayerNames = agentIds.map((id) => agentNames[id]!)
  const wolfIds = agentIds.filter((id) => roleMap.get(id) === 'werewolf')
  const wolfNames = wolfIds.map((id) => agentNames[id]!)

  for (const agentId of agentIds) {
    const role = roleMap.get(agentId)!
    const name = agentNames[agentId]!
    const systemPrompt = buildRoleSystemPrompt(name, role, allPlayerNames, wolfNames)

    // Re-create agent with role-specific system prompt
    const agentConfig = config.agents.find((a) => agentNames[agentId] === a.name)!
    const generateFn = createGenFn(agentConfig.model)
    const generateObjectFn = createObjFn(agentConfig.model)

    // Remove old agent and add new one with correct prompt
    room.removeAgent(agentId)
    const agent = new AIAgent(
      {
        id: agentId,
        name,
        persona: { name, description: `${role} in the werewolf game` },
        model: agentConfig.model,
        systemPrompt,
      },
      generateFn,
      generateObjectFn,
    )
    room.addAgent(agent)
  }

  // Set up channels
  // Main channel already exists (all agents subscribed via addAgent)
  const privateChannels = [
    { id: 'werewolf', name: 'Werewolf Night' },
    { id: 'seer-result', name: 'Seer Investigation' },
    { id: 'witch-action', name: 'Witch Action' },
    // Blind vote channels — NO subscribers (simultaneous voting)
    { id: 'wolf-vote', name: 'Wolf Vote (blind)' },
    { id: 'day-vote', name: 'Day Vote (blind)' },
  ]
  for (const ch of privateChannels) {
    room.channels.createChannel({
      id: ch.id,
      roomId,
      name: ch.name,
      parentId: null,
      autoBroadcast: false,
    })
  }

  // Subscribe roles to their private channels (blind channels get NO subscribers)
  for (const wolfId of wolfIds) {
    room.channels.subscribe('werewolf', wolfId)
  }
  const seerIds = agentIds.filter((id) => roleMap.get(id) === 'seer')
  for (const seerId of seerIds) {
    room.channels.subscribe('seer-result', seerId)
  }
  const witchIds = agentIds.filter((id) => roleMap.get(id) === 'witch')
  for (const witchId of witchIds) {
    room.channels.subscribe('witch-action', witchId)
  }

  // Create flow
  const smConfig = createWerewolfStateMachineConfig()
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
    winResult: null,
  }

  flow.setGameState({
    roles: roleMap,
    activeAgentIds: new Set(agentIds),
    custom: wState as unknown as Record<string, unknown>,
  })

  return { room, eventBus, flow, roleAssignments, agentNames }
}

/**
 * Create and run a werewolf game to completion.
 * Returns the completed Room with all messages.
 */
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
export type { WerewolfRole, WerewolfGameState } from './types.js'
export { checkWinCondition } from './types.js'
