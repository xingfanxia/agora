// ============================================================
// Agora Werewolf Mode — Types & Decision Schemas
// ============================================================

import { z } from 'zod'

// ── Roles ──────────────────────────────────────────────────

export type WerewolfRole = 'werewolf' | 'villager' | 'seer' | 'witch' | 'hunter'

export interface RoleAssignment {
  readonly agentId: string
  readonly role: WerewolfRole
}

// ── Game State (stored in StateMachineFlow.gameState.custom) ──

export interface WerewolfGameState {
  /** agentId → role */
  roleMap: Record<string, WerewolfRole>
  /** Ordered list of eliminated agent IDs */
  eliminatedIds: string[]
  /** Who was killed by wolves this night (null if 空刀 or saved) */
  lastNightKill: string | null
  /** Whether the witch has used her save potion (game-wide, single use) */
  witchSaveUsed: boolean
  /** Whether the witch has used her poison potion (game-wide, single use) */
  witchPoisonUsed: boolean
  /** Who the witch poisoned this night */
  witchPoisonTarget: string | null
  /** Whether the witch used a potion this night (for mutex enforcement) */
  witchUsedPotionTonight: boolean
  /** Seer's check result for the current night */
  seerResult: { targetId: string; isWerewolf: boolean } | null
  /** Night number */
  nightNumber: number
  /** Agent ID → name mapping for prompts */
  agentNames: Record<string, string>
  /** Whether hunter needs to shoot (killed by wolves or day vote, NOT by poison) */
  hunterCanShoot: boolean
  /** Agent ID of the hunter who needs to shoot (if any) */
  hunterPendingId: string | null
  /** Who the hunter shot */
  hunterShotTarget: string | null
  /** Win result (set by phase hooks) */
  winResult: WinResult
}

// ── Helpers ──────────────────────────────────────────────────

/** Helper to create a z.enum from a string array (requires non-empty) */
function toEnum(values: string[]): [string, ...string[]] {
  if (values.length === 0) throw new Error('z.enum requires at least one value')
  return values as [string, ...string[]]
}

// ── Decision Schemas (Zod) ──────────────────────────────────

/** Wolf vote — choose who to kill tonight */
export function createWolfVoteSchema(aliveNonWolfNames: string[]) {
  return z.object({
    target: z.enum(toEnum(aliveNonWolfNames)).describe(
      'Name of the player to kill tonight',
    ),
    reason: z.string().describe('Brief reason for this choice'),
  })
}

/** Seer check — choose who to investigate (excludes self) */
export function createSeerCheckSchema(alivePlayerNamesExcludingSelf: string[]) {
  return z.object({
    target: z.enum(toEnum(alivePlayerNamesExcludingSelf)).describe(
      'Name of the player to investigate',
    ),
  })
}

/**
 * Witch action — simplified schema based on available potions.
 * Only ONE potion can be used per night (mutually exclusive).
 */
export function createWitchActionSchema(
  canSave: boolean,
  canPoison: boolean,
  alivePlayerNames: string[],
) {
  if (canSave && canPoison) {
    // Both available — choose one or pass
    return z.object({
      action: z.enum(['save', 'poison', 'pass']).describe(
        'Choose ONE action: "save" to use antidote on the killed player, "poison" to kill someone, or "pass" to do nothing. You can only use ONE potion per night.',
      ),
      poisonTarget: z.enum(toEnum([...alivePlayerNames, 'none'])).describe(
        'If action is "poison", name the target. Otherwise set to "none".',
      ),
      reason: z.string().describe('Brief reasoning'),
    })
  }

  if (canSave) {
    return z.object({
      action: z.enum(['save', 'pass']).describe(
        'Choose: "save" to use antidote on the killed player, or "pass".',
      ),
      poisonTarget: z.literal('none'),
      reason: z.string().describe('Brief reasoning'),
    })
  }

  if (canPoison) {
    return z.object({
      action: z.enum(['poison', 'pass']).describe(
        'Choose: "poison" to kill someone, or "pass".',
      ),
      poisonTarget: z.enum(toEnum([...alivePlayerNames, 'none'])).describe(
        'If action is "poison", name the target. Otherwise "none".',
      ),
      reason: z.string().describe('Brief reasoning'),
    })
  }

  // No potions left
  return z.object({
    action: z.literal('pass').describe('Both potions already used. You must pass.'),
    poisonTarget: z.literal('none'),
    reason: z.string().describe('Brief reasoning'),
  })
}

/** Day vote — choose who to eliminate (or skip). Excludes self. */
export function createDayVoteSchema(alivePlayerNamesExcludingSelf: string[]) {
  return z.object({
    target: z.enum(toEnum([...alivePlayerNamesExcludingSelf, 'skip'])).describe(
      'Name of the player to eliminate, or "skip" to abstain',
    ),
    reason: z.string().describe('Public justification for your vote'),
  })
}

/** Hunter shoot — choose who to take down, or pass */
export function createHunterShootSchema(alivePlayerNames: string[]) {
  return z.object({
    shoot: z.boolean().describe('Whether to use your gun'),
    target: z.enum(toEnum([...alivePlayerNames, 'none'])).describe(
      'If shooting, name the target. Otherwise "none".',
    ),
    reason: z.string().describe('Brief reasoning'),
  })
}

// ── Win Conditions ──────────────────────────────────────────

export type WinResult = 'werewolves_win' | 'village_wins' | null

/** Check win condition: wolves win if wolves >= non-wolves */
export function checkWinCondition(
  roleMap: Record<string, WerewolfRole>,
  eliminatedIds: string[],
): WinResult {
  const eliminated = new Set(eliminatedIds)
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
