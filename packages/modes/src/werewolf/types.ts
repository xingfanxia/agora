// ============================================================
// Agora Werewolf Mode — Types & Decision Schemas
// ============================================================

import { z } from 'zod'

// ── Roles ──────────────────────────────────────────────────

export type WerewolfRole = 'werewolf' | 'villager' | 'seer' | 'witch'

export interface RoleAssignment {
  readonly agentId: string
  readonly role: WerewolfRole
}

// ── Game State (stored in StateMachineFlow.gameState.custom) ──

export interface WerewolfGameState {
  /** agentId → role */
  roleMap: Record<string, WerewolfRole>
  /** Set of eliminated agent IDs */
  eliminatedIds: string[]
  /** Who was killed last night (resolved after wolf vote) */
  lastNightKill: string | null
  /** Whether the witch has used her save potion */
  witchSaveUsed: boolean
  /** Whether the witch has used her poison potion */
  witchPoisonUsed: boolean
  /** Who the witch poisoned (if any, during this night) */
  witchPoisonTarget: string | null
  /** Seer's check result for the current night */
  seerResult: { targetId: string; isWerewolf: boolean } | null
  /** Night number (for tracking) */
  nightNumber: number
  /** Agent ID → name mapping for prompts */
  agentNames: Record<string, string>
}

// ── Decision Schemas (Zod) ──────────────────────────────────

/** Helper to safely create a z.enum from a string array */
function toEnum(values: string[]): [string, ...string[]] {
  if (values.length === 0) throw new Error('z.enum requires at least one value')
  return values as [string, ...string[]]
}

/**
 * Wolf vote — choose who to kill tonight.
 * `alivePlayers` is dynamically set from game state.
 */
export function createWolfVoteSchema(alivePlayerNames: string[]) {
  return z.object({
    target: z.enum(toEnum(alivePlayerNames)).describe(
      'Name of the player to kill tonight',
    ),
    reason: z.string().describe('Brief reason for this choice'),
  })
}

/** Seer check — choose who to investigate */
export function createSeerCheckSchema(alivePlayerNames: string[]) {
  return z.object({
    target: z.enum(toEnum(alivePlayerNames)).describe(
      'Name of the player to investigate',
    ),
  })
}

/** Witch action — save and/or poison */
export function createWitchActionSchema(
  canSave: boolean,
  canPoison: boolean,
  alivePlayerNames: string[],
) {
  return z.object({
    save: canSave
      ? z.boolean().describe('Whether to use your save potion on the killed player')
      : z.literal(false).describe('Save potion already used'),
    poison: canPoison
      ? z.enum(toEnum([...alivePlayerNames, 'none'])).describe(
          'Name of player to poison, or "none" to skip',
        )
      : z.literal('none').describe('Poison potion already used'),
    reason: z.string().describe('Brief reasoning'),
  })
}

/** Day vote — choose who to eliminate (or skip) */
export function createDayVoteSchema(alivePlayerNames: string[]) {
  return z.object({
    target: z.enum(toEnum([...alivePlayerNames, 'skip'])).describe(
      'Name of the player to eliminate, or "skip" to abstain',
    ),
    reason: z.string().describe('Public justification for your vote'),
  })
}

// ── Win Conditions ──────────────────────────────────────────

export type WinResult = 'werewolves_win' | 'village_wins' | null

export function checkWinCondition(
  roleMap: Record<string, WerewolfRole>,
  eliminatedIds: string[],
): WinResult {
  const eliminated = new Set(eliminatedIds)
  const aliveWolves = Object.entries(roleMap).filter(
    ([id, role]) => role === 'werewolf' && !eliminated.has(id),
  )
  const aliveVillagers = Object.entries(roleMap).filter(
    ([id, role]) => role !== 'werewolf' && !eliminated.has(id),
  )

  if (aliveWolves.length === 0) return 'village_wins'
  if (aliveWolves.length >= aliveVillagers.length) return 'werewolves_win'
  return null
}
