// ============================================================
// Agora Werewolf Mode — Types & Decision Schemas
// ============================================================

import { z } from 'zod'

// ── Roles ──────────────────────────────────────────────────

export type WerewolfRole = 'werewolf' | 'villager' | 'seer' | 'witch' | 'hunter' | 'guard' | 'idiot'

// ── Advanced Rules Toggle ──────────────────────────────────

export interface WerewolfAdvancedRules {
  /** Enable 守卫 (Guard) — night protection, 同守同救 */
  guard?: boolean
  /** Enable 白痴 (Idiot) — survives day vote once, loses voting rights */
  idiot?: boolean
  /** Enable 警长 (Sheriff) — Day 1 election, 1.5x vote, badge transfer */
  sheriff?: boolean
  /** Enable 遗言 (Last Words) — eliminated players give dying speech */
  lastWords?: boolean
}

// ── Game State ──────────────────────────────────────────────

export interface WerewolfGameState {
  /** agentId → role */
  roleMap: Record<string, WerewolfRole>
  /** Ordered list of eliminated agent IDs */
  eliminatedIds: string[]
  /** Who was killed by wolves this night */
  lastNightKill: string | null
  /** Witch potions (game-wide, single use each) */
  witchSaveUsed: boolean
  witchPoisonUsed: boolean
  witchPoisonTarget: string | null
  witchUsedPotionTonight: boolean
  /** Seer check result */
  seerResult: { targetId: string; isWerewolf: boolean } | null
  /** Night counter */
  nightNumber: number
  /** Agent ID → display name */
  agentNames: Record<string, string>
  /** Hunter mechanics */
  hunterCanShoot: boolean
  hunterPendingId: string | null
  hunterShotTarget: string | null
  /** Guard mechanics (advanced rule) */
  guardProtectedId: string | null
  guardLastProtectedId: string | null
  /** Idiot mechanics (advanced rule) */
  idiotRevealedIds: string[]
  /** Sheriff mechanics (advanced rule) */
  sheriffId: string | null
  sheriffElected: boolean
  /** IDs of players who just died and need last words (advanced rule) */
  pendingLastWordsIds: string[]
  /** Win result */
  winResult: WinResult
  /** Which advanced rules are active */
  advancedRules: WerewolfAdvancedRules
}

// ── Helpers ──────────────────────────────────────────────────

function toEnum(values: string[]): [string, ...string[]] {
  if (values.length === 0) throw new Error('z.enum requires at least one value')
  return values as [string, ...string[]]
}

// ── Decision Schemas ────────────────────────────────────────

export function createWolfVoteSchema(aliveNonWolfNames: string[]) {
  return z.object({
    target: z.enum(toEnum(aliveNonWolfNames)).describe('Name of the player to kill tonight'),
    reason: z.string().describe('Brief reason'),
  })
}

export function createSeerCheckSchema(targets: string[]) {
  return z.object({
    target: z.enum(toEnum(targets)).describe('Name of the player to investigate'),
  })
}

export function createWitchActionSchema(
  canSave: boolean,
  canPoison: boolean,
  alivePlayerNames: string[],
) {
  if (canSave && canPoison) {
    return z.object({
      action: z.enum(['save', 'poison', 'pass']).describe('Choose ONE: save, poison, or pass. Only one potion per night.'),
      poisonTarget: z.enum(toEnum([...alivePlayerNames, 'none'])).describe('If poison, name target. Otherwise "none".'),
      reason: z.string().describe('Brief reasoning'),
    })
  }
  if (canSave) {
    return z.object({
      action: z.enum(['save', 'pass']).describe('Save the killed player or pass.'),
      poisonTarget: z.literal('none'),
      reason: z.string().describe('Brief reasoning'),
    })
  }
  if (canPoison) {
    return z.object({
      action: z.enum(['poison', 'pass']).describe('Poison someone or pass.'),
      poisonTarget: z.enum(toEnum([...alivePlayerNames, 'none'])).describe('If poison, name target. Otherwise "none".'),
      reason: z.string().describe('Brief reasoning'),
    })
  }
  return z.object({
    action: z.literal('pass').describe('Both potions used. Must pass.'),
    poisonTarget: z.literal('none'),
    reason: z.string().describe('Brief reasoning'),
  })
}

export function createDayVoteSchema(targets: string[]) {
  return z.object({
    target: z.enum(toEnum([...targets, 'skip'])).describe('Player to eliminate, or "skip"'),
    reason: z.string().describe('Public justification'),
  })
}

export function createHunterShootSchema(alivePlayerNames: string[]) {
  return z.object({
    shoot: z.boolean().describe('Whether to use your gun'),
    target: z.enum(toEnum([...alivePlayerNames, 'none'])).describe('If shooting, name target. Otherwise "none".'),
    reason: z.string().describe('Brief reasoning'),
  })
}

/** Guard chooses who to protect tonight */
export function createGuardProtectSchema(targets: string[]) {
  return z.object({
    target: z.enum(toEnum([...targets, 'none'])).describe('Player to protect tonight, or "none" to skip.'),
    reason: z.string().describe('Brief reasoning'),
  })
}

/** Sheriff election — vote for who should be sheriff */
export function createSheriffVoteSchema(candidates: string[]) {
  return z.object({
    target: z.enum(toEnum([...candidates, 'skip'])).describe('Who should be sheriff, or "skip" to abstain.'),
    reason: z.string().describe('Brief reasoning'),
  })
}

/** Sheriff badge transfer on death */
export function createSheriffTransferSchema(alivePlayerNames: string[]) {
  return z.object({
    target: z.enum(toEnum([...alivePlayerNames, 'destroy'])).describe('Transfer badge to a player, or "destroy" to remove sheriff role.'),
    reason: z.string().describe('Brief reasoning'),
  })
}

/** Last words — dying speech */
export function createLastWordsSchema() {
  return z.object({
    speech: z.string().describe('Your final words to the village. Share any information or suspicions.'),
    revealRole: z.boolean().describe('Whether to reveal your role in your dying speech.'),
  })
}

// ── Win Conditions ──────────────────────────────────────────

export type WinResult = 'werewolves_win' | 'village_wins' | null

export function checkWinCondition(
  roleMap: Record<string, WerewolfRole>,
  eliminatedIds: string[],
  idiotRevealedIds: string[] = [],
): WinResult {
  const eliminated = new Set(eliminatedIds)
  // Revealed idiots are alive but count for win condition
  const aliveWolves = Object.entries(roleMap).filter(
    ([id, role]) => role === 'werewolf' && !eliminated.has(id),
  )
  const aliveNonWolves = Object.entries(roleMap).filter(
    ([id, role]) => role !== 'werewolf' && !eliminated.has(id),
  )

  if (aliveWolves.length === 0) return 'village_wins'
  if (aliveWolves.length >= aliveNonWolves.length) return 'werewolves_win'
  return null
}
