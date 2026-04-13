// ============================================================
// Agora Werewolf Mode — Phase & Transition Configuration
//
// Night order (Chinese 狼人杀): [Guard →] Wolves → Witch → Seer
// Voting: blind (simultaneous)
// Advanced rules: Guard, Idiot, Sheriff, Last Words (togglable)
// ============================================================

import type { PhaseConfig, StateMachineConfig, TransitionRule, GameState, Announcement } from '@agora/core'
import {
  createWolfVoteSchema,
  createSeerCheckSchema,
  createWitchActionSchema,
  createDayVoteSchema,
  createHunterShootSchema,
  createGuardProtectSchema,
  createSheriffVoteSchema,
  createSheriffTransferSchema,
  createLastWordsSchema,
  checkWinCondition,
  type WerewolfGameState,
  type WerewolfRole,
  type WerewolfAdvancedRules,
} from './types.js'

// ── Helpers ────────────────────────────────────────────────

function ws(gs: GameState): WerewolfGameState {
  return gs.custom as unknown as WerewolfGameState
}

function alive(gs: GameState, role: WerewolfRole): string[] {
  return [...gs.roles.entries()]
    .filter(([id, r]) => r === role && gs.activeAgentIds.has(id))
    .map(([id]) => id)
}

function aliveNonWolfNames(gs: GameState): string[] {
  const s = ws(gs)
  return [...gs.activeAgentIds]
    .filter((id) => s.roleMap[id] !== 'werewolf')
    .map((id) => s.agentNames[id] ?? id)
}

function allNames(gs: GameState): string[] {
  const s = ws(gs)
  return [...gs.activeAgentIds].map((id) => s.agentNames[id] ?? id)
}

function namesExcluding(gs: GameState, excludeId: string): string[] {
  const s = ws(gs)
  return [...gs.activeAgentIds]
    .filter((id) => id !== excludeId)
    .map((id) => s.agentNames[id] ?? id)
}

function n2id(gs: GameState, name: string): string | undefined {
  return Object.entries(ws(gs).agentNames).find(([, n]) => n === name)?.[0]
}

function emit(gs: { custom: Record<string, unknown> }, content: string, ch = 'main', meta?: Record<string, unknown>): void {
  const list = (gs.custom['_announcements'] ?? []) as Announcement[]
  list.push({ content, channelId: ch, metadata: meta })
  gs.custom['_announcements'] = list
}

function done(ctx: { turnCount: number; expectedSpeakers: number }): boolean {
  return ctx.turnCount >= ctx.expectedSpeakers
}

function doneOrEmpty(ctx: { turnCount: number; expectedSpeakers: number }): boolean {
  return ctx.turnCount >= ctx.expectedSpeakers || ctx.expectedSpeakers === 0
}

// ── Vote Tallying ──────────────────────────────────────────

function tallyVotes(
  decisions: ReadonlyMap<string, unknown>,
  gs: GameState,
  field = 'target',
  weights?: Map<string, number>,
): { winnerId: string | null; tally: Map<string, number>; skipCount: number } {
  const tally = new Map<string, number>()
  let skipCount = 0

  for (const [voterId, decision] of decisions) {
    const d = decision as Record<string, unknown>
    const name = d[field] as string
    if (name === 'skip' || name === 'none') { skipCount++; continue }
    const targetId = n2id(gs, name)
    if (targetId) {
      const w = weights?.get(voterId) ?? 1
      tally.set(targetId, (tally.get(targetId) ?? 0) + w)
    }
  }

  let maxVotes = 0
  let maxIds: string[] = []
  for (const [id, count] of tally) {
    if (count > maxVotes) { maxVotes = count; maxIds = [id] }
    else if (count === maxVotes) maxIds.push(id)
  }

  if (maxIds.length !== 1 || maxVotes <= skipCount) return { winnerId: null, tally, skipCount }
  return { winnerId: maxIds[0]!, tally, skipCount }
}

function fmtTally(tally: Map<string, number>, skipCount: number, gs: GameState): string {
  const s = ws(gs)
  const parts = [...tally.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([id, c]) => `${s.agentNames[id] ?? id}: ${c}`)
  if (skipCount > 0) parts.push(`Abstain: ${skipCount}`)
  return parts.join(', ')
}

// ── Phase Definitions ──────────────────────────────────────
// Each returns a PhaseConfig. Advanced-rule phases are separate functions.

// ── GUARD (Advanced) ───────────────────────────────────────

function guardProtectPhase(): PhaseConfig {
  return {
    name: 'guardProtect',
    channelId: 'guard-action',
    getSpeakers: (gs) => alive(gs, 'guard'),
    getSchema: (agentId, gs) => {
      const s = ws(gs)
      // Can't protect same player two nights in a row
      const excluded = s.guardLastProtectedId
      const targets = [...gs.activeAgentIds]
        .filter((id) => id !== excluded)
        .map((id) => s.agentNames[id] ?? id)
      return createGuardProtectSchema(targets)
    },
    instruction: (agentId, gs) => {
      const s = ws(gs)
      const excluded = s.guardLastProtectedId ? (s.agentNames[s.guardLastProtectedId] ?? 'someone') : null
      const base = 'Choose a player to protect tonight. They will be immune to the wolf kill.'
      return excluded
        ? `${base} You cannot protect **${excluded}** again (protected last night).`
        : base
    },
    onExit: (gs, decisions) => {
      const s = ws(gs)
      for (const [, decision] of decisions.decisions) {
        const d = decision as { target: string }
        if (d.target && d.target !== 'none') {
          const targetId = n2id(gs, d.target)
          if (targetId) s.guardProtectedId = targetId
        }
      }
    },
  }
}

// ── CORE NIGHT ─────────────────────────────────────────────

function wolfDiscussPhase(): PhaseConfig {
  return {
    name: 'wolfDiscuss',
    channelId: 'werewolf',
    getSpeakers: (gs) => alive(gs, 'werewolf'),
    instruction: 'It is nighttime. Discuss with your fellow wolves who to kill tonight.',
    maxTurns: 6,
    onEnter: (gs) => {
      const s = ws(gs)
      // Reset night state
      s.lastNightKill = null
      s.witchPoisonTarget = null
      s.witchUsedPotionTonight = false
      s.seerResult = null
      s.hunterCanShoot = false
      s.hunterPendingId = null
      s.hunterShotTarget = null
      s.pendingLastWordsIds = []
      // Guard: rotate protection tracking
      s.guardLastProtectedId = s.guardProtectedId
      s.guardProtectedId = null
    },
  }
}

function wolfVotePhase(): PhaseConfig {
  return {
    name: 'wolfVote',
    channelId: 'wolf-vote',
    getSpeakers: (gs) => alive(gs, 'werewolf'),
    getSchema: (_id, gs) => createWolfVoteSchema(aliveNonWolfNames(gs)),
    instruction: (_id, gs) => `Vote on who to kill. Targets: ${aliveNonWolfNames(gs).join(', ')}. Vote is blind.`,
    onExit: (gs, decisions) => {
      const s = ws(gs)
      const { winnerId, tally, skipCount } = tallyVotes(decisions.decisions, gs)
      if (winnerId) {
        s.lastNightKill = winnerId
        emit(gs, `Wolves agreed: **${s.agentNames[winnerId]}** is the target.`, 'werewolf')
      } else {
        s.lastNightKill = null
        emit(gs, `Wolves could not agree (${fmtTally(tally, skipCount, gs)}). 空刀 — no kill.`, 'werewolf')
      }
    },
  }
}

function witchActionPhase(): PhaseConfig {
  return {
    name: 'witchAction',
    channelId: 'witch-action',
    getSpeakers: (gs) => alive(gs, 'witch'),
    getSchema: (agentId, gs) => {
      const s = ws(gs)
      const witchIsTarget = s.lastNightKill === agentId
      const canSave = !s.witchSaveUsed && s.lastNightKill !== null && !witchIsTarget
      const canPoison = !s.witchPoisonUsed
      return createWitchActionSchema(canSave, canPoison, namesExcluding(gs, agentId))
    },
    instruction: (agentId, gs) => {
      const s = ws(gs)
      const parts: string[] = []
      if (s.witchSaveUsed) {
        parts.push('The wolves attacked someone, but you no longer know who (antidote used).')
      } else if (s.lastNightKill) {
        const name = s.agentNames[s.lastNightKill] ?? 'someone'
        if (s.lastNightKill === agentId) parts.push(`The wolves targeted **you**. You cannot save yourself.`)
        else parts.push(`The wolves chose to kill **${name}**. You may save them.`)
      } else {
        parts.push('No one was attacked tonight.')
      }
      if (!s.witchPoisonUsed) parts.push('You may use POISON.')
      parts.push('AT MOST ONE potion per night.')
      return parts.join(' ')
    },
    onExit: (gs, decisions) => {
      const s = ws(gs)
      for (const [, decision] of decisions.decisions) {
        const d = decision as { action: string; poisonTarget: string }
        if (d.action === 'save' && s.lastNightKill && !s.witchSaveUsed) {
          s.witchSaveUsed = true
          s.witchUsedPotionTonight = true
          // Don't null lastNightKill yet — dawn resolves guard+witch interaction
          s.lastNightKill = null // (if guard NOT enabled, this is final)
        } else if (d.action === 'poison' && d.poisonTarget !== 'none' && !s.witchPoisonUsed && !s.witchUsedPotionTonight) {
          s.witchPoisonUsed = true
          s.witchUsedPotionTonight = true
          const id = n2id(gs, d.poisonTarget)
          if (id) s.witchPoisonTarget = id
        }
      }
    },
  }
}

function seerCheckPhase(): PhaseConfig {
  return {
    name: 'seerCheck',
    channelId: 'seer-result',
    getSpeakers: (gs) => alive(gs, 'seer'),
    getSchema: (agentId, gs) => createSeerCheckSchema(namesExcluding(gs, agentId)),
    instruction: (agentId, gs) => `Investigate a player. Targets: ${namesExcluding(gs, agentId).join(', ')}.`,
    onExit: (gs, decisions) => {
      const s = ws(gs)
      for (const [, decision] of decisions.decisions) {
        const d = decision as { target: string }
        const id = n2id(gs, d.target)
        if (id) {
          const isWolf = s.roleMap[id] === 'werewolf'
          s.seerResult = { targetId: id, isWerewolf: isWolf }
          emit(gs, `Investigation: **${s.agentNames[id]}** is ${isWolf ? 'a WEREWOLF!' : 'NOT a werewolf.'}`, 'seer-result')
        }
      }
    },
  }
}

// ── DAWN ───────────────────────────────────────────────────

function dawnPhase(rules: WerewolfAdvancedRules): PhaseConfig {
  return {
    name: 'dawn',
    channelId: 'main',
    getSpeakers: () => [],
    onEnter: (gs) => {
      const s = ws(gs)
      const deaths: string[] = []
      const deathCauses: Record<string, string> = {}

      // Resolve wolf kill with guard protection
      if (s.lastNightKill) {
        const killId = s.lastNightKill
        const guardSaved = rules.guard && s.guardProtectedId === killId

        if (guardSaved) {
          // Guard protected → target survives (unless 同守同救 — handled below for future witch+guard same night)
          // Note: witch save already nulled lastNightKill in onExit if she saved
          // If we get here with guardSaved, witch did NOT save (lastNightKill still set)
        } else {
          // No guard protection → wolf kill applies
          if (s.roleMap[killId] === 'hunter') {
            s.hunterCanShoot = true
            s.hunterPendingId = killId
          }
          gs.activeAgentIds.delete(killId)
          s.eliminatedIds.push(killId)
          deaths.push(s.agentNames[killId] ?? killId)
          deathCauses[killId] = 'wolf'
          if (rules.lastWords) s.pendingLastWordsIds.push(killId)
        }
      }

      // Witch poison (bypasses guard)
      if (s.witchPoisonTarget && !deathCauses[s.witchPoisonTarget]) {
        const pid = s.witchPoisonTarget
        if (s.roleMap[pid] === 'hunter') {
          s.hunterCanShoot = false
          s.hunterPendingId = null
        }
        gs.activeAgentIds.delete(pid)
        s.eliminatedIds.push(pid)
        deaths.push(s.agentNames[pid] ?? pid)
        deathCauses[pid] = 'poison'
        if (rules.lastWords) s.pendingLastWordsIds.push(pid)
      }

      if (deaths.length > 0) {
        emit(gs, `Dawn breaks. Last night, **${deaths.join(' and ')}** did not survive.`)
      } else {
        emit(gs, 'Dawn breaks. Everyone survived the night!')
      }

      // Sheriff died? Need transfer
      if (rules.sheriff && s.sheriffId && (deathCauses[s.sheriffId])) {
        // Flag for sheriffTransfer phase
        gs.custom['sheriffNeedsTransfer'] = true
      }

      s.lastNightKill = null
      s.seerResult = null
      s.witchPoisonTarget = null
      s.winResult = checkWinCondition(s.roleMap, s.eliminatedIds, s.idiotRevealedIds)
    },
  }
}

// ── LAST WORDS (Advanced) ──────────────────────────────────

function lastWordsPhase(phaseName: string): PhaseConfig {
  return {
    name: phaseName,
    channelId: 'main',
    getSpeakers: (gs) => {
      const s = ws(gs)
      return s.pendingLastWordsIds.filter((id) => !gs.activeAgentIds.has(id) || s.idiotRevealedIds.includes(id))
    },
    getSchema: () => createLastWordsSchema(),
    instruction: 'You have been eliminated. Share your last words with the village — any suspicions, information, or final thoughts.',
    onExit: (gs, decisions) => {
      const s = ws(gs)
      for (const [agentId, decision] of decisions.decisions) {
        const d = decision as { speech: string; revealRole: boolean }
        const name = s.agentNames[agentId] ?? agentId
        if (d.revealRole) {
          const role = s.roleMap[agentId] ?? 'unknown'
          emit(gs, `**${name}** (last words, revealing role: **${role}**): ${d.speech}`)
        } else {
          emit(gs, `**${name}** (last words): ${d.speech}`)
        }
      }
      s.pendingLastWordsIds = []
    },
  }
}

// ── HUNTER ──────────────────────────────────────────────────

function hunterShootPhase(phaseName: string): PhaseConfig {
  return {
    name: phaseName,
    channelId: 'main',
    getSpeakers: (gs) => {
      const s = ws(gs)
      return (s.hunterCanShoot && s.hunterPendingId) ? [s.hunterPendingId] : []
    },
    getSchema: (_id, gs) => createHunterShootSchema(allNames(gs)),
    instruction: (_id, gs) => `You may take one last shot! Targets: ${allNames(gs).join(', ')}. Or pass.`,
    onExit: (gs, decisions) => {
      const s = ws(gs)
      for (const [, decision] of decisions.decisions) {
        const d = decision as { shoot: boolean; target: string }
        if (d.shoot && d.target !== 'none') {
          const tid = n2id(gs, d.target)
          if (tid && gs.activeAgentIds.has(tid)) {
            s.hunterShotTarget = tid
            gs.activeAgentIds.delete(tid)
            s.eliminatedIds.push(tid)
            const hunterName = s.hunterPendingId ? (s.agentNames[s.hunterPendingId] ?? 'Hunter') : 'Hunter'
            const tName = s.agentNames[tid] ?? tid
            const tRole = s.roleMap[tid] ?? '?'
            emit(gs, `**${hunterName}** fires! **${tName}** (${tRole}) is taken down.`)
            // If shot player is sheriff, need transfer
            if (s.advancedRules.sheriff && s.sheriffId === tid) {
              gs.custom['sheriffNeedsTransfer'] = true
            }
          }
        }
      }
      s.hunterCanShoot = false
      s.hunterPendingId = null
      s.winResult = checkWinCondition(s.roleMap, s.eliminatedIds, s.idiotRevealedIds)
    },
  }
}

// ── SHERIFF (Advanced) ─────────────────────────────────────

function sheriffElectionPhase(): PhaseConfig {
  return {
    name: 'sheriffElection',
    channelId: 'day-vote', // blind voting
    getSpeakers: (gs) => [...gs.activeAgentIds],
    getSchema: (_id, gs) => createSheriffVoteSchema(namesExcluding(gs, _id)),
    instruction: (_id, gs) => `Day 1 Sheriff Election! Vote for who should be sheriff. Targets: ${namesExcluding(gs, _id).join(', ')}. Sheriff gets 1.5x vote weight.`,
    onExit: (gs, decisions) => {
      const s = ws(gs)
      const { winnerId, tally, skipCount } = tallyVotes(decisions.decisions, gs)
      const tallyStr = fmtTally(tally, skipCount, gs)
      if (winnerId) {
        s.sheriffId = winnerId
        s.sheriffElected = true
        emit(gs, `Sheriff Election: ${tallyStr}. **${s.agentNames[winnerId]}** is elected Sheriff! (1.5x vote weight)`)
      } else {
        emit(gs, `Sheriff Election: ${tallyStr}. No majority — this game has no Sheriff.`)
      }
    },
  }
}

function sheriffTransferPhase(phaseName: string): PhaseConfig {
  return {
    name: phaseName,
    channelId: 'main',
    getSpeakers: (gs) => {
      const s = ws(gs)
      if (gs.custom['sheriffNeedsTransfer'] && s.sheriffId) return [s.sheriffId]
      return []
    },
    getSchema: (_id, gs) => createSheriffTransferSchema(allNames(gs)),
    instruction: (_id, gs) => `You are the Sheriff and have been eliminated. Transfer your badge to an alive player, or destroy it. Targets: ${allNames(gs).join(', ')}.`,
    onExit: (gs, decisions) => {
      const s = ws(gs)
      for (const [, decision] of decisions.decisions) {
        const d = decision as { target: string }
        if (d.target === 'destroy') {
          const oldName = s.sheriffId ? (s.agentNames[s.sheriffId] ?? 'Sheriff') : 'Sheriff'
          emit(gs, `**${oldName}** destroys the Sheriff badge. There is no more Sheriff.`)
          s.sheriffId = null
        } else {
          const newId = n2id(gs, d.target)
          if (newId && gs.activeAgentIds.has(newId)) {
            const oldName = s.sheriffId ? (s.agentNames[s.sheriffId] ?? 'Sheriff') : 'Sheriff'
            s.sheriffId = newId
            emit(gs, `**${oldName}** transfers the Sheriff badge to **${s.agentNames[newId]}**.`)
          }
        }
      }
      gs.custom['sheriffNeedsTransfer'] = false
    },
  }
}

// ── DAY PHASES ─────────────────────────────────────────────

function dayDiscussPhase(): PhaseConfig {
  return {
    name: 'dayDiscuss',
    channelId: 'main',
    getSpeakers: (gs) => {
      const s = ws(gs)
      const speakers = [...gs.activeAgentIds]
      // Sheriff speaks first if enabled
      if (s.advancedRules.sheriff && s.sheriffId && gs.activeAgentIds.has(s.sheriffId)) {
        const idx = speakers.indexOf(s.sheriffId)
        if (idx > 0) { speakers.splice(idx, 1); speakers.unshift(s.sheriffId) }
      }
      // Shuffle the rest
      for (let i = speakers.length - 1; i > (s.sheriffId ? 1 : 0); i--) {
        const j = Math.floor(Math.random() * (i + 1))
        if (j > (s.sheriffId ? 0 : -1)) {
          ;[speakers[i], speakers[j]] = [speakers[j]!, speakers[i]!]
        }
      }
      return speakers
    },
    instruction: 'Daytime discussion. Share suspicions, defend yourself. Voting follows.',
    maxTurns: 12,
  }
}

function dayVotePhase(rules: WerewolfAdvancedRules): PhaseConfig {
  return {
    name: 'dayVote',
    channelId: 'day-vote',
    getSpeakers: (gs) => {
      const s = ws(gs)
      // Revealed idiots cannot vote
      const revealedSet = new Set(s.idiotRevealedIds)
      return [...gs.activeAgentIds].filter((id) => !revealedSet.has(id))
    },
    getSchema: (agentId, gs) => createDayVoteSchema(namesExcluding(gs, agentId)),
    instruction: (agentId, gs) => `Vote to eliminate. Targets: ${namesExcluding(gs, agentId).join(', ')}. Or "skip". Blind vote.`,
    onExit: (gs, decisions) => {
      const s = ws(gs)

      // Sheriff 1.5x vote weight
      let weights: Map<string, number> | undefined
      if (rules.sheriff && s.sheriffId && gs.activeAgentIds.has(s.sheriffId)) {
        weights = new Map()
        weights.set(s.sheriffId, 1.5)
      }

      const { winnerId, tally, skipCount } = tallyVotes(decisions.decisions, gs, 'target', weights)
      const tallyStr = fmtTally(tally, skipCount, gs)

      if (winnerId) {
        // IDIOT CHECK — if voted player is unrevealed idiot, they survive
        if (rules.idiot && s.roleMap[winnerId] === 'idiot' && !s.idiotRevealedIds.includes(winnerId)) {
          s.idiotRevealedIds.push(winnerId)
          const name = s.agentNames[winnerId] ?? winnerId
          emit(gs, `Vote: ${tallyStr}. **${name}** was voted out — but reveals they are the **Village Idiot**! They survive but lose voting rights.`)
          // Idiot stays in activeAgentIds but can't vote anymore
        } else {
          // Normal elimination
          if (s.roleMap[winnerId] === 'hunter') {
            s.hunterCanShoot = true
            s.hunterPendingId = winnerId
          }
          if (rules.sheriff && s.sheriffId === winnerId) {
            gs.custom['sheriffNeedsTransfer'] = true
          }
          gs.activeAgentIds.delete(winnerId)
          s.eliminatedIds.push(winnerId)
          const name = s.agentNames[winnerId] ?? winnerId
          const role = s.roleMap[winnerId] ?? '?'
          emit(gs, `Vote: ${tallyStr}. **${name}** eliminated. They were a **${role}**.`)
          if (rules.lastWords) s.pendingLastWordsIds.push(winnerId)
        }
      } else {
        emit(gs, `Vote: ${tallyStr}. No majority — 平安日 (peaceful day).`)
      }

      s.winResult = checkWinCondition(s.roleMap, s.eliminatedIds, s.idiotRevealedIds)
      s.nightNumber++
    },
  }
}

// ── WIN / TERMINAL ─────────────────────────────────────────

function winCheck(phaseName: string): PhaseConfig {
  return { name: phaseName, channelId: 'main', getSpeakers: () => [] }
}

function wolvesWinPhase(): PhaseConfig {
  return {
    name: 'werewolvesWin', channelId: 'main', getSpeakers: () => [],
    onEnter: (gs) => {
      const s = ws(gs)
      const wolves = Object.entries(s.roleMap).filter(([, r]) => r === 'werewolf').map(([id]) => s.agentNames[id] ?? id)
      emit(gs, `**THE WEREWOLVES WIN!** The wolves (${wolves.join(', ')}) have overrun the village.`)
    },
  }
}

function villageWinPhase(): PhaseConfig {
  return {
    name: 'villageWins', channelId: 'main', getSpeakers: () => [],
    onEnter: (gs) => { emit(gs, `**THE VILLAGE WINS!** All werewolves eliminated.`) },
  }
}

// ── STATE MACHINE BUILDER ──────────────────────────────────

/**
 * Build the StateMachineConfig based on enabled advanced rules.
 * Conditionally injects Guard, Idiot, Sheriff, Last Words phases.
 */
export function createWerewolfStateMachineConfig(rules: WerewolfAdvancedRules = {}): StateMachineConfig {
  const phases: PhaseConfig[] = []
  const transitions: TransitionRule[] = []

  // ─── Night Start ───
  const nightEntry = rules.guard ? 'guardProtect' : 'wolfDiscuss'

  if (rules.guard) {
    phases.push(guardProtectPhase())
    transitions.push({ from: 'guardProtect', to: 'wolfDiscuss', condition: doneOrEmpty })
  }

  // ─── Core Night ───
  phases.push(wolfDiscussPhase(), wolfVotePhase(), witchActionPhase(), seerCheckPhase())
  transitions.push(
    { from: 'wolfDiscuss', to: 'wolfVote', condition: done },
    { from: 'wolfVote', to: 'witchAction', condition: done },
    { from: 'witchAction', to: 'seerCheck', condition: doneOrEmpty },
    { from: 'seerCheck', to: 'dawn', condition: doneOrEmpty },
  )

  // ─── Dawn ───
  phases.push(dawnPhase(rules))

  // Post-dawn chain: dawn → [lastWords] → hunterShoot → [sheriffTransfer] → checkWin
  let afterDawn = 'dawn'

  if (rules.lastWords) {
    phases.push(lastWordsPhase('lastWordsDawn'))
    transitions.push({ from: afterDawn, to: 'lastWordsDawn', condition: () => true })
    afterDawn = 'lastWordsDawn'
  }

  phases.push(hunterShootPhase('hunterShoot'))
  transitions.push({ from: afterDawn, to: 'hunterShoot', condition: doneOrEmpty })
  afterDawn = 'hunterShoot'

  if (rules.sheriff) {
    phases.push(sheriffTransferPhase('sheriffTransferNight'))
    transitions.push({ from: afterDawn, to: 'sheriffTransferNight', condition: doneOrEmpty })
    afterDawn = 'sheriffTransferNight'
  }

  phases.push(winCheck('checkWinAfterNight'))
  transitions.push({ from: afterDawn, to: 'checkWinAfterNight', condition: doneOrEmpty })

  // Win checks after night
  transitions.push(
    { from: 'checkWinAfterNight', to: 'werewolvesWin', condition: (ctx) => ws(ctx.gameState).winResult === 'werewolves_win' },
    { from: 'checkWinAfterNight', to: 'villageWins', condition: (ctx) => ws(ctx.gameState).winResult === 'village_wins' },
  )

  // ─── Day Start ───
  // Sheriff election on Day 1 only (if enabled)
  const dayEntry = rules.sheriff ? 'sheriffGate' : 'dayDiscuss'

  if (rules.sheriff) {
    // Gate phase — checks if it's Day 1
    phases.push({
      name: 'sheriffGate', channelId: 'main', getSpeakers: () => [],
    })
    phases.push(sheriffElectionPhase())
    transitions.push(
      { from: 'checkWinAfterNight', to: 'sheriffGate', condition: () => true },
      { from: 'sheriffGate', to: 'sheriffElection', condition: (ctx) => !ws(ctx.gameState).sheriffElected },
      { from: 'sheriffGate', to: 'dayDiscuss', condition: () => true },
      { from: 'sheriffElection', to: 'dayDiscuss', condition: done },
    )
  } else {
    transitions.push({ from: 'checkWinAfterNight', to: 'dayDiscuss', condition: () => true })
  }

  // ─── Day Discussion + Vote ───
  phases.push(dayDiscussPhase(), dayVotePhase(rules))
  transitions.push(
    { from: 'dayDiscuss', to: 'dayVote', condition: done },
  )

  // Post-vote chain: dayVote → [lastWords] → hunterShoot → [sheriffTransfer] → checkWin
  let afterVote = 'dayVote'

  if (rules.lastWords) {
    phases.push(lastWordsPhase('lastWordsVote'))
    transitions.push({ from: afterVote, to: 'lastWordsVote', condition: done })
    afterVote = 'lastWordsVote'
  } else {
    // dayVote done triggers next phase
  }

  phases.push(hunterShootPhase('hunterShootAfterVote'))
  transitions.push({ from: afterVote, to: 'hunterShootAfterVote', condition: doneOrEmpty })
  afterVote = 'hunterShootAfterVote'

  if (rules.sheriff) {
    phases.push(sheriffTransferPhase('sheriffTransferVote'))
    transitions.push({ from: afterVote, to: 'sheriffTransferVote', condition: doneOrEmpty })
    afterVote = 'sheriffTransferVote'
  }

  phases.push(winCheck('checkWinAfterVote'))
  transitions.push({ from: afterVote, to: 'checkWinAfterVote', condition: doneOrEmpty })

  // Win checks after vote
  transitions.push(
    { from: 'checkWinAfterVote', to: 'werewolvesWin', condition: (ctx) => ws(ctx.gameState).winResult === 'werewolves_win' },
    { from: 'checkWinAfterVote', to: 'villageWins', condition: (ctx) => ws(ctx.gameState).winResult === 'village_wins' },
    { from: 'checkWinAfterVote', to: nightEntry, condition: () => true },
  )

  // ─── Terminal ───
  phases.push(wolvesWinPhase(), villageWinPhase())

  return {
    phases,
    transitions,
    initialPhase: nightEntry,
    terminalPhases: ['werewolvesWin', 'villageWins'],
  }
}
