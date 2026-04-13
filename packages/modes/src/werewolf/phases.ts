// ============================================================
// Agora Werewolf Mode — Phase & Transition Configuration
//
// Night order (Chinese 狼人杀): Wolves → Witch → Seer
// Voting: blind (simultaneous) for both wolf and day votes
// ============================================================

import type { PhaseConfig, StateMachineConfig, GameState, Announcement } from '@agora/core'
import {
  createWolfVoteSchema,
  createSeerCheckSchema,
  createWitchActionSchema,
  createDayVoteSchema,
  createHunterShootSchema,
  checkWinCondition,
  type WerewolfGameState,
  type WerewolfRole,
} from './types.js'

// ── Helpers ────────────────────────────────────────────────

function ws(gameState: GameState): WerewolfGameState {
  return gameState.custom as unknown as WerewolfGameState
}

function getAliveByRole(gameState: GameState, role: WerewolfRole): string[] {
  return [...gameState.roles.entries()]
    .filter(([id, r]) => r === role && gameState.activeAgentIds.has(id))
    .map(([id]) => id)
}

function getAliveNonWolfNames(gameState: GameState): string[] {
  const s = ws(gameState)
  return [...gameState.activeAgentIds]
    .filter((id) => s.roleMap[id] !== 'werewolf')
    .map((id) => s.agentNames[id] ?? id)
}

function getAllAliveNames(gameState: GameState): string[] {
  const s = ws(gameState)
  return [...gameState.activeAgentIds].map((id) => s.agentNames[id] ?? id)
}

function getAllAliveNamesExcluding(gameState: GameState, excludeId: string): string[] {
  const s = ws(gameState)
  return [...gameState.activeAgentIds]
    .filter((id) => id !== excludeId)
    .map((id) => s.agentNames[id] ?? id)
}

function nameToId(gameState: GameState, name: string): string | undefined {
  const s = ws(gameState)
  return Object.entries(s.agentNames).find(([, n]) => n === name)?.[0]
}

function announce(
  gameState: { custom: Record<string, unknown> },
  content: string,
  channelId = 'main',
  metadata?: Record<string, unknown>,
): void {
  const list = (gameState.custom['_announcements'] ?? []) as Announcement[]
  list.push({ content, channelId, metadata })
  gameState.custom['_announcements'] = list
}

function allSpoken(ctx: { turnCount: number; expectedSpeakers: number }): boolean {
  return ctx.turnCount >= ctx.expectedSpeakers
}

/** Tally votes and return the winner. Returns null on tie or no majority. */
function tallyVotes(
  decisions: ReadonlyMap<string, unknown>,
  gameState: GameState,
  targetField = 'target',
): { winnerId: string | null; tally: Map<string, number>; skipCount: number } {
  const tally = new Map<string, number>()
  let skipCount = 0

  for (const [, decision] of decisions) {
    const d = decision as Record<string, unknown>
    const targetName = d[targetField] as string
    if (targetName === 'skip' || targetName === 'none') {
      skipCount++
      continue
    }
    const targetId = nameToId(gameState, targetName)
    if (targetId) {
      tally.set(targetId, (tally.get(targetId) ?? 0) + 1)
    }
  }

  // Find max votes
  let maxVotes = 0
  let maxIds: string[] = []
  for (const [id, count] of tally) {
    if (count > maxVotes) {
      maxVotes = count
      maxIds = [id]
    } else if (count === maxVotes) {
      maxIds.push(id)
    }
  }

  // Tie (multiple players with same max) or all skipped → no winner
  if (maxIds.length !== 1 || maxVotes <= skipCount) {
    return { winnerId: null, tally, skipCount }
  }

  return { winnerId: maxIds[0]!, tally, skipCount }
}

/** Format a vote tally as a human-readable string */
function formatVoteTally(
  tally: Map<string, number>,
  skipCount: number,
  gameState: GameState,
): string {
  const s = ws(gameState)
  const parts = [...tally.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([id, count]) => `${s.agentNames[id] ?? id}: ${count} vote${count !== 1 ? 's' : ''}`)
  if (skipCount > 0) {
    parts.push(`Abstain: ${skipCount}`)
  }
  return parts.join(', ')
}

// ── Phase Definitions ──────────────────────────────────────

function wolfDiscussPhase(): PhaseConfig {
  return {
    name: 'wolfDiscuss',
    channelId: 'werewolf',
    getSpeakers: (gs) => getAliveByRole(gs, 'werewolf'),
    instruction: 'It is nighttime. Discuss with your fellow wolves who to kill tonight. Consider who might be the seer or witch — they are your biggest threats.',
    maxTurns: 6,
    onEnter: (gs) => {
      // Reset all night-scoped state at the start of each night
      const s = ws(gs)
      s.lastNightKill = null
      s.witchPoisonTarget = null
      s.witchUsedPotionTonight = false
      s.seerResult = null
      s.hunterCanShoot = false
      s.hunterPendingId = null
      s.hunterShotTarget = null
    },
  }
}

function wolfVotePhase(): PhaseConfig {
  return {
    name: 'wolfVote',
    channelId: 'wolf-vote', // blind channel — no subscribers
    getSpeakers: (gs) => getAliveByRole(gs, 'werewolf'),
    getSchema: (_agentId, gs) => createWolfVoteSchema(getAliveNonWolfNames(gs)),
    instruction: (_agentId, gs) => {
      const targets = getAliveNonWolfNames(gs)
      return `Vote on who to kill tonight. Available targets: ${targets.join(', ')}. Your vote is secret — other wolves cannot see it.`
    },
    onExit: (gs, decisions) => {
      const s = ws(gs)
      const { winnerId, tally, skipCount } = tallyVotes(decisions.decisions, gs)

      if (winnerId) {
        s.lastNightKill = winnerId
        const targetName = s.agentNames[winnerId] ?? winnerId
        announce(gs, `Wolves agreed: **${targetName}** is the target tonight.`, 'werewolf')
      } else {
        // 空刀 — wolves disagree
        s.lastNightKill = null
        const tallyStr = formatVoteTally(tally, skipCount, gs)
        announce(gs, `Wolves could not agree on a target (${tallyStr}). No one was attacked tonight.`, 'werewolf')
      }
    },
  }
}

/** Witch action phase — Chinese 狼人杀 order: wolves → WITCH → seer */
function witchActionPhase(): PhaseConfig {
  return {
    name: 'witchAction',
    channelId: 'witch-action',
    getSpeakers: (gs) => getAliveByRole(gs, 'witch'),
    getSchema: (agentId, gs) => {
      const s = ws(gs)
      const witchIsTarget = s.lastNightKill === agentId
      // Cannot self-save (Chinese 狼人杀 rule)
      const canSave = !s.witchSaveUsed && s.lastNightKill !== null && !witchIsTarget
      const canPoison = !s.witchPoisonUsed
      const aliveNames = getAllAliveNamesExcluding(gs, agentId) // can't poison self either
      return createWitchActionSchema(canSave, canPoison, aliveNames)
    },
    instruction: (agentId, gs) => {
      const s = ws(gs)
      const parts: string[] = []

      // If save potion already used, witch doesn't know who was killed (Chinese rule)
      if (s.witchSaveUsed) {
        parts.push('The wolves attacked someone tonight, but you can no longer see who (your antidote has been used).')
      } else if (s.lastNightKill) {
        const killedName = s.agentNames[s.lastNightKill] ?? 'someone'
        const witchIsTarget = s.lastNightKill === agentId
        if (witchIsTarget) {
          parts.push(`Tonight, the wolves chose to kill **you**. Unfortunately, you cannot save yourself.`)
        } else {
          parts.push(`Tonight, the wolves chose to kill **${killedName}**.`)
          parts.push('You may use your ANTIDOTE to save them.')
        }
      } else {
        parts.push('The wolves failed to agree on a target tonight. No one was attacked.')
      }

      if (!s.witchPoisonUsed) {
        parts.push('You may use your POISON to kill any player.')
      }

      parts.push('You can use AT MOST ONE potion per night.')

      if (s.witchSaveUsed && s.witchPoisonUsed) {
        parts.push('Both your potions have been used. You must pass.')
      }

      return parts.join(' ')
    },
    onExit: (gs, decisions) => {
      const s = ws(gs)
      for (const [, decision] of decisions.decisions) {
        const d = decision as { action: string; poisonTarget: string }
        if (d.action === 'save' && s.lastNightKill && !s.witchSaveUsed) {
          s.witchSaveUsed = true
          s.witchUsedPotionTonight = true
          s.lastNightKill = null // saved!
        } else if (d.action === 'poison' && d.poisonTarget && d.poisonTarget !== 'none' && !s.witchPoisonUsed) {
          // Enforce mutex: if save was used this night, ignore poison
          if (!s.witchUsedPotionTonight) {
            s.witchPoisonUsed = true
            s.witchUsedPotionTonight = true
            const poisonId = nameToId(gs, d.poisonTarget)
            if (poisonId) {
              s.witchPoisonTarget = poisonId
            }
          }
        }
      }
    },
  }
}

/** Seer check phase — after witch in Chinese 狼人杀 order */
function seerCheckPhase(): PhaseConfig {
  return {
    name: 'seerCheck',
    channelId: 'seer-result',
    getSpeakers: (gs) => getAliveByRole(gs, 'seer'),
    getSchema: (agentId, gs) => {
      // Seer cannot investigate themselves
      const targets = getAllAliveNamesExcluding(gs, agentId)
      return createSeerCheckSchema(targets)
    },
    instruction: (agentId, gs) => {
      const targets = getAllAliveNamesExcluding(gs, agentId)
      return `Choose a player to investigate. You will learn if they are a werewolf. Available targets: ${targets.join(', ')}.`
    },
    onExit: (gs, decisions) => {
      const s = ws(gs)
      for (const [, decision] of decisions.decisions) {
        const d = decision as { target: string }
        const targetId = nameToId(gs, d.target)
        if (targetId) {
          const isWerewolf = s.roleMap[targetId] === 'werewolf'
          s.seerResult = { targetId, isWerewolf }
          const targetName = s.agentNames[targetId] ?? targetId
          announce(
            gs,
            `Your investigation reveals: **${targetName}** is ${isWerewolf ? 'a WEREWOLF!' : 'NOT a werewolf.'}`,
            'seer-result',
          )
        }
      }
    },
  }
}

/** Dawn phase — apply all deaths, check hunter trigger */
function dawnPhase(): PhaseConfig {
  return {
    name: 'dawn',
    channelId: 'main',
    getSpeakers: () => [],
    onEnter: (gs) => {
      const s = ws(gs)
      const deaths: string[] = []
      const deathCauses: Record<string, string> = {}

      // Apply wolf kill
      if (s.lastNightKill) {
        const killId = s.lastNightKill
        // Check if hunter was killed by wolves → can shoot
        if (s.roleMap[killId] === 'hunter') {
          s.hunterCanShoot = true
          s.hunterPendingId = killId
        }
        gs.activeAgentIds.delete(killId)
        s.eliminatedIds.push(killId)
        deaths.push(s.agentNames[killId] ?? killId)
        deathCauses[killId] = 'wolf'
      }

      // Apply witch poison (if not already dead from wolf kill)
      if (s.witchPoisonTarget && !deathCauses[s.witchPoisonTarget]) {
        const poisonId = s.witchPoisonTarget
        // Witch poison seals hunter's gun
        if (s.roleMap[poisonId] === 'hunter') {
          // Hunter killed by poison CANNOT shoot
          s.hunterCanShoot = false
          s.hunterPendingId = null
        }
        gs.activeAgentIds.delete(poisonId)
        s.eliminatedIds.push(poisonId)
        deaths.push(s.agentNames[poisonId] ?? poisonId)
        deathCauses[poisonId] = 'poison'
      }

      // Announce
      if (deaths.length > 0) {
        announce(gs, `Dawn breaks. Last night, **${deaths.join(' and ')}** did not survive.`)
      } else {
        announce(gs, 'Dawn breaks. Everyone survived the night!')
      }

      // Reset per-night state that's no longer needed
      s.lastNightKill = null
      s.seerResult = null
      s.witchPoisonTarget = null

      // Check win condition
      s.winResult = checkWinCondition(s.roleMap, s.eliminatedIds)
    },
  }
}

/** Hunter shoot phase — if hunter died from wolves or day vote (not poison) */
function hunterShootPhase(): PhaseConfig {
  return {
    name: 'hunterShoot',
    channelId: 'main',
    getSpeakers: (gs) => {
      const s = ws(gs)
      // Hunter can shoot even though they're "dead" — use pendingId
      if (s.hunterCanShoot && s.hunterPendingId) {
        return [s.hunterPendingId]
      }
      return []
    },
    getSchema: (_agentId, gs) => {
      const aliveNames = getAllAliveNames(gs)
      return createHunterShootSchema(aliveNames)
    },
    instruction: (_agentId, gs) => {
      const aliveNames = getAllAliveNames(gs)
      return `You have been eliminated, but as the Hunter you may take one last shot! Choose a player to shoot, or pass. Available targets: ${aliveNames.join(', ')}.`
    },
    onExit: (gs, decisions) => {
      const s = ws(gs)
      for (const [, decision] of decisions.decisions) {
        const d = decision as { shoot: boolean; target: string }
        if (d.shoot && d.target && d.target !== 'none') {
          const targetId = nameToId(gs, d.target)
          if (targetId && gs.activeAgentIds.has(targetId)) {
            s.hunterShotTarget = targetId
            gs.activeAgentIds.delete(targetId)
            s.eliminatedIds.push(targetId)
            const hunterName = s.hunterPendingId ? (s.agentNames[s.hunterPendingId] ?? 'Hunter') : 'Hunter'
            const targetName = s.agentNames[targetId] ?? targetId
            const targetRole = s.roleMap[targetId] ?? 'unknown'
            announce(gs, `**${hunterName}** fires their last shot! **${targetName}** (${targetRole}) is taken down.`)
          }
        }
      }
      // Clear hunter state
      s.hunterCanShoot = false
      s.hunterPendingId = null

      // Recheck win condition after hunter shot
      s.winResult = checkWinCondition(s.roleMap, s.eliminatedIds)
    },
  }
}

function dayDiscussPhase(): PhaseConfig {
  return {
    name: 'dayDiscuss',
    channelId: 'main',
    getSpeakers: (gs) => {
      // Randomize speaking order each day
      const alive = [...gs.activeAgentIds]
      for (let i = alive.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[alive[i], alive[j]] = [alive[j]!, alive[i]!]
      }
      return alive
    },
    instruction: 'It is daytime. Discuss who you suspect of being a werewolf. Share observations, defend yourself if accused. After discussion, you will vote to eliminate someone.',
    maxTurns: 12,
  }
}

function dayVotePhase(): PhaseConfig {
  return {
    name: 'dayVote',
    channelId: 'day-vote', // blind channel — no subscribers
    getSpeakers: (gs) => [...gs.activeAgentIds],
    getSchema: (agentId, gs) => {
      // Cannot vote for self
      const aliveNames = getAllAliveNamesExcluding(gs, agentId)
      return createDayVoteSchema(aliveNames)
    },
    instruction: (agentId, gs) => {
      const aliveNames = getAllAliveNamesExcluding(gs, agentId)
      return `Vote to eliminate a player. Choose from: ${aliveNames.join(', ')}. Or "skip" to abstain. Your vote is secret until all votes are cast.`
    },
    onExit: (gs, decisions) => {
      const s = ws(gs)
      const { winnerId, tally, skipCount } = tallyVotes(decisions.decisions, gs)
      const tallyStr = formatVoteTally(tally, skipCount, gs)

      if (winnerId) {
        // Check if hunter is being voted out → can shoot
        if (s.roleMap[winnerId] === 'hunter') {
          s.hunterCanShoot = true
          s.hunterPendingId = winnerId
        }

        gs.activeAgentIds.delete(winnerId)
        s.eliminatedIds.push(winnerId)
        const name = s.agentNames[winnerId] ?? winnerId
        const role = s.roleMap[winnerId] ?? 'unknown'
        announce(gs, `Vote results: ${tallyStr}. **${name}** has been eliminated. They were a **${role}**.`)
      } else {
        // 平安日 — tie or no majority
        announce(gs, `Vote results: ${tallyStr}. No majority reached — no one was eliminated today.`)
      }

      // Check win condition
      s.winResult = checkWinCondition(s.roleMap, s.eliminatedIds)

      s.nightNumber++
    },
  }
}

// ── State Machine Config ───────────────────────────────────

/** Create the full StateMachineConfig for a werewolf game */
export function createWerewolfStateMachineConfig(): StateMachineConfig {
  return {
    phases: [
      // Night phases (Chinese order: wolves → witch → seer)
      wolfDiscussPhase(),
      wolfVotePhase(),
      witchActionPhase(),
      seerCheckPhase(),
      dawnPhase(),
      // Post-dawn hunter
      hunterShootPhase(),
      // Post-dawn win check
      { name: 'checkWinAfterNight', channelId: 'main', getSpeakers: () => [] },
      // Day phases
      dayDiscussPhase(),
      dayVotePhase(),
      // Post-vote hunter
      {
        ...hunterShootPhase(),
        name: 'hunterShootAfterVote',
      },
      // Post-vote win check
      { name: 'checkWinAfterVote', channelId: 'main', getSpeakers: () => [] },
      // Terminal phases
      {
        name: 'werewolvesWin',
        channelId: 'main',
        getSpeakers: () => [],
        onEnter: (gs) => {
          const s = ws(gs)
          const wolves = Object.entries(s.roleMap)
            .filter(([, r]) => r === 'werewolf')
            .map(([id]) => s.agentNames[id] ?? id)
          announce(gs, `**THE WEREWOLVES WIN!** The wolves (${wolves.join(', ')}) have overrun the village.`)
        },
      },
      {
        name: 'villageWins',
        channelId: 'main',
        getSpeakers: () => [],
        onEnter: (gs) => {
          announce(gs, `**THE VILLAGE WINS!** All werewolves have been eliminated. Peace returns.`)
        },
      },
    ],
    transitions: [
      // Night sequence (Chinese 狼人杀 order)
      { from: 'wolfDiscuss', to: 'wolfVote', condition: (ctx) => allSpoken(ctx) },
      { from: 'wolfVote', to: 'witchAction', condition: (ctx) => allSpoken(ctx) },
      { from: 'witchAction', to: 'seerCheck', condition: (ctx) => allSpoken(ctx) || ctx.expectedSpeakers === 0 },
      { from: 'seerCheck', to: 'dawn', condition: (ctx) => allSpoken(ctx) || ctx.expectedSpeakers === 0 },

      // Dawn → hunter shoot (if applicable) → win check
      { from: 'dawn', to: 'hunterShoot', condition: () => true },
      { from: 'hunterShoot', to: 'checkWinAfterNight', condition: (ctx) => allSpoken(ctx) || ctx.expectedSpeakers === 0 },

      // After night: win or proceed to day
      { from: 'checkWinAfterNight', to: 'werewolvesWin', condition: (ctx) => ws(ctx.gameState).winResult === 'werewolves_win' },
      { from: 'checkWinAfterNight', to: 'villageWins', condition: (ctx) => ws(ctx.gameState).winResult === 'village_wins' },
      { from: 'checkWinAfterNight', to: 'dayDiscuss', condition: () => true },

      // Day sequence
      { from: 'dayDiscuss', to: 'dayVote', condition: (ctx) => allSpoken(ctx) },
      { from: 'dayVote', to: 'hunterShootAfterVote', condition: (ctx) => allSpoken(ctx) },
      { from: 'hunterShootAfterVote', to: 'checkWinAfterVote', condition: (ctx) => allSpoken(ctx) || ctx.expectedSpeakers === 0 },

      // After vote: win or next night
      { from: 'checkWinAfterVote', to: 'werewolvesWin', condition: (ctx) => ws(ctx.gameState).winResult === 'werewolves_win' },
      { from: 'checkWinAfterVote', to: 'villageWins', condition: (ctx) => ws(ctx.gameState).winResult === 'village_wins' },
      { from: 'checkWinAfterVote', to: 'wolfDiscuss', condition: () => true },
    ],
    initialPhase: 'wolfDiscuss',
    terminalPhases: ['werewolvesWin', 'villageWins'],
  }
}
