// ============================================================
// Agora Werewolf Mode — Phase & Transition Configuration
// ============================================================

import type { PhaseConfig, StateMachineConfig, GameState, Announcement } from '@agora/core'
import {
  createWolfVoteSchema,
  createSeerCheckSchema,
  createWitchActionSchema,
  createDayVoteSchema,
  checkWinCondition,
  type WerewolfGameState,
  type WerewolfRole,
} from './types.js'

// ── Helpers ────────────────────────────────────────────────

function getWState(gameState: GameState): WerewolfGameState {
  return gameState.custom as unknown as WerewolfGameState
}

function getAliveByRole(gameState: GameState, role: WerewolfRole): string[] {
  return [...gameState.roles.entries()]
    .filter(([id, r]) => r === role && gameState.activeAgentIds.has(id))
    .map(([id]) => id)
}

function getAliveNonWolfNames(gameState: GameState): string[] {
  const ws = getWState(gameState)
  return [...gameState.activeAgentIds]
    .filter((id) => ws.roleMap[id] !== 'werewolf')
    .map((id) => ws.agentNames[id] ?? id)
}

function getAllAliveNames(gameState: GameState): string[] {
  const ws = getWState(gameState)
  return [...gameState.activeAgentIds].map((id) => ws.agentNames[id] ?? id)
}

function nameToId(gameState: GameState, name: string): string | undefined {
  const ws = getWState(gameState)
  return Object.entries(ws.agentNames).find(([, n]) => n === name)?.[0]
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

// ── Phase Definitions ──────────────────────────────────────

function wolfDiscussPhase(): PhaseConfig {
  return {
    name: 'wolfDiscuss',
    channelId: 'werewolf',
    getSpeakers: (gs) => getAliveByRole(gs, 'werewolf'),
    instruction: 'It is nighttime. Discuss with your fellow wolves who to kill tonight. Be strategic — consider who might be the seer or witch.',
    maxTurns: 6,
  }
}

function wolfVotePhase(): PhaseConfig {
  return {
    name: 'wolfVote',
    channelId: 'werewolf',
    getSpeakers: (gs) => getAliveByRole(gs, 'werewolf'),
    getSchema: (_agentId, gs) => {
      const targets = getAliveNonWolfNames(gs)
      return createWolfVoteSchema(targets)
    },
    instruction: (_agentId, gs) => {
      const targets = getAliveNonWolfNames(gs)
      return `Vote on who to kill tonight. Available targets: ${targets.join(', ')}.`
    },
    onExit: (gs, decisions) => {
      const ws = getWState(gs)
      const votes = new Map<string, number>()
      for (const [, decision] of decisions.decisions) {
        const d = decision as { target: string }
        const targetId = nameToId(gs, d.target)
        if (targetId) {
          votes.set(targetId, (votes.get(targetId) ?? 0) + 1)
        }
      }
      let maxVotes = 0
      let killTarget: string | null = null
      for (const [id, count] of votes) {
        if (count > maxVotes) {
          maxVotes = count
          killTarget = id
        }
      }
      ws.lastNightKill = killTarget
    },
  }
}

function seerCheckPhase(): PhaseConfig {
  return {
    name: 'seerCheck',
    channelId: 'seer-result',
    getSpeakers: (gs) => getAliveByRole(gs, 'seer'),
    getSchema: (_agentId, gs) => {
      const targets = getAllAliveNames(gs)
      return createSeerCheckSchema(targets)
    },
    instruction: (_agentId, gs) => {
      const targets = getAllAliveNames(gs)
      return `Choose a player to investigate. Available targets: ${targets.join(', ')}.`
    },
    onExit: (gs, decisions) => {
      const ws = getWState(gs)
      for (const [, decision] of decisions.decisions) {
        const d = decision as { target: string }
        const targetId = nameToId(gs, d.target)
        if (targetId) {
          const isWerewolf = ws.roleMap[targetId] === 'werewolf'
          ws.seerResult = { targetId, isWerewolf }
          const targetName = ws.agentNames[targetId] ?? targetId
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

function witchActionPhase(): PhaseConfig {
  return {
    name: 'witchAction',
    channelId: 'witch-action',
    getSpeakers: (gs) => getAliveByRole(gs, 'witch'),
    getSchema: (_agentId, gs) => {
      const ws = getWState(gs)
      const aliveNames = getAllAliveNames(gs)
      return createWitchActionSchema(!ws.witchSaveUsed, !ws.witchPoisonUsed, aliveNames)
    },
    instruction: (_agentId, gs) => {
      const ws = getWState(gs)
      const killedName = ws.lastNightKill ? (ws.agentNames[ws.lastNightKill] ?? 'someone') : null
      const parts: string[] = []
      if (killedName) {
        parts.push(`Tonight, the wolves chose to kill **${killedName}**.`)
      } else {
        parts.push('The wolves failed to reach a consensus tonight.')
      }
      if (!ws.witchSaveUsed && killedName) {
        parts.push('You may use your SAVE potion to rescue them.')
      }
      if (!ws.witchPoisonUsed) {
        parts.push('You may use your POISON potion to eliminate someone.')
      }
      if (ws.witchSaveUsed && ws.witchPoisonUsed) {
        parts.push('Both your potions have been used.')
      }
      return parts.join(' ')
    },
    onExit: (gs, decisions) => {
      const ws = getWState(gs)
      for (const [, decision] of decisions.decisions) {
        const d = decision as { save: boolean; poison: string }
        if (d.save && ws.lastNightKill) {
          ws.witchSaveUsed = true
          ws.lastNightKill = null
        }
        if (d.poison && d.poison !== 'none') {
          ws.witchPoisonUsed = true
          const poisonId = nameToId(gs, d.poison)
          if (poisonId) {
            ws.witchPoisonTarget = poisonId
          }
        }
      }
    },
  }
}

function dawnPhase(): PhaseConfig {
  return {
    name: 'dawn',
    channelId: 'main',
    getSpeakers: () => [],
    onEnter: (gs) => {
      const ws = getWState(gs)
      const deaths: string[] = []

      if (ws.lastNightKill) {
        gs.activeAgentIds.delete(ws.lastNightKill)
        ws.eliminatedIds.push(ws.lastNightKill)
        deaths.push(ws.agentNames[ws.lastNightKill] ?? ws.lastNightKill)
      }

      if (ws.witchPoisonTarget) {
        gs.activeAgentIds.delete(ws.witchPoisonTarget)
        ws.eliminatedIds.push(ws.witchPoisonTarget)
        deaths.push(ws.agentNames[ws.witchPoisonTarget] ?? ws.witchPoisonTarget)
        ws.witchPoisonTarget = null
      }

      if (deaths.length > 0) {
        announce(gs, `Dawn breaks. Last night, **${deaths.join(' and ')}** did not survive.`)
      } else {
        announce(gs, 'Dawn breaks. Miraculously, everyone survived the night!')
      }

      ws.lastNightKill = null
      ws.seerResult = null

      const result = checkWinCondition(ws.roleMap, ws.eliminatedIds)
      if (result) {
        gs.custom['winResult'] = result
      }
    },
  }
}

function dayDiscussPhase(): PhaseConfig {
  return {
    name: 'dayDiscuss',
    channelId: 'main',
    getSpeakers: (gs) => [...gs.activeAgentIds],
    instruction: 'It is daytime. Discuss who you suspect of being a werewolf. Share observations, defend yourself if accused. After discussion, you will vote to eliminate someone.',
    maxTurns: 12,
  }
}

function dayVotePhase(): PhaseConfig {
  return {
    name: 'dayVote',
    channelId: 'main',
    getSpeakers: (gs) => [...gs.activeAgentIds],
    getSchema: (_agentId, gs) => {
      const aliveNames = getAllAliveNames(gs)
      return createDayVoteSchema(aliveNames)
    },
    instruction: (_agentId, gs) => {
      const aliveNames = getAllAliveNames(gs)
      return `Vote to eliminate a player. Choose from: ${aliveNames.join(', ')}. Or vote "skip" to abstain.`
    },
    onExit: (gs, decisions) => {
      const ws = getWState(gs)
      const votes = new Map<string, number>()
      let skipCount = 0

      for (const [, decision] of decisions.decisions) {
        const d = decision as { target: string; reason: string }
        if (d.target === 'skip') {
          skipCount++
          continue
        }
        const targetId = nameToId(gs, d.target)
        if (targetId) {
          votes.set(targetId, (votes.get(targetId) ?? 0) + 1)
        }
      }

      let maxVotes = 0
      let eliminateTarget: string | null = null
      for (const [id, count] of votes) {
        if (count > maxVotes) {
          maxVotes = count
          eliminateTarget = id
        }
      }

      if (eliminateTarget && maxVotes > skipCount) {
        gs.activeAgentIds.delete(eliminateTarget)
        ws.eliminatedIds.push(eliminateTarget)
        const name = ws.agentNames[eliminateTarget] ?? eliminateTarget
        const role = ws.roleMap[eliminateTarget] ?? 'unknown'
        announce(gs, `The village has voted. **${name}** has been eliminated. They were a **${role}**.`)
      } else {
        announce(gs, 'No majority reached. No one was eliminated today.')
      }

      const result = checkWinCondition(ws.roleMap, ws.eliminatedIds)
      if (result) {
        gs.custom['winResult'] = result
      }

      ws.nightNumber++
    },
  }
}

// ── State Machine Config ───────────────────────────────────

/** Create the full StateMachineConfig for a werewolf game */
export function createWerewolfStateMachineConfig(): StateMachineConfig {
  return {
    phases: [
      wolfDiscussPhase(),
      wolfVotePhase(),
      seerCheckPhase(),
      witchActionPhase(),
      dawnPhase(),
      // Separate win-check phases for post-night and post-vote
      { name: 'checkWinAfterNight', channelId: 'main', getSpeakers: () => [] },
      dayDiscussPhase(),
      dayVotePhase(),
      { name: 'checkWinAfterVote', channelId: 'main', getSpeakers: () => [] },
      // Terminal phases
      {
        name: 'werewolvesWin',
        channelId: 'main',
        getSpeakers: () => [],
        onEnter: (gs) => {
          const ws = getWState(gs)
          const wolves = Object.entries(ws.roleMap)
            .filter(([, r]) => r === 'werewolf')
            .map(([id]) => ws.agentNames[id] ?? id)
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
      // Night sequence
      { from: 'wolfDiscuss', to: 'wolfVote', condition: (ctx) => allSpoken(ctx) },
      { from: 'wolfVote', to: 'seerCheck', condition: (ctx) => allSpoken(ctx) },
      { from: 'seerCheck', to: 'witchAction', condition: (ctx) => allSpoken(ctx) || ctx.expectedSpeakers === 0 },
      { from: 'witchAction', to: 'dawn', condition: (ctx) => allSpoken(ctx) || ctx.expectedSpeakers === 0 },

      // Dawn → check win
      { from: 'dawn', to: 'checkWinAfterNight', condition: () => true },
      { from: 'checkWinAfterNight', to: 'werewolvesWin', condition: (ctx) => ctx.gameState.custom['winResult'] === 'werewolves_win' },
      { from: 'checkWinAfterNight', to: 'villageWins', condition: (ctx) => ctx.gameState.custom['winResult'] === 'village_wins' },
      { from: 'checkWinAfterNight', to: 'dayDiscuss', condition: () => true },

      // Day sequence
      { from: 'dayDiscuss', to: 'dayVote', condition: (ctx) => allSpoken(ctx) },
      { from: 'dayVote', to: 'checkWinAfterVote', condition: (ctx) => allSpoken(ctx) },

      // After vote → win or next night
      { from: 'checkWinAfterVote', to: 'werewolvesWin', condition: (ctx) => ctx.gameState.custom['winResult'] === 'werewolves_win' },
      { from: 'checkWinAfterVote', to: 'villageWins', condition: (ctx) => ctx.gameState.custom['winResult'] === 'village_wins' },
      { from: 'checkWinAfterVote', to: 'wolfDiscuss', condition: () => true },
    ],
    initialPhase: 'wolfDiscuss',
    terminalPhases: ['werewolvesWin', 'villageWins'],
  }
}
