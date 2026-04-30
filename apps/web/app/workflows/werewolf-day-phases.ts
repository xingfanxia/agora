// ============================================================
// Phase 4.5d-2.15 — Werewolf day phases (WDK port)
// ============================================================
//
// Implements the day-cycle phase steps that werewolf-workflow.ts's
// dispatch loop calls. Sibling to werewolf-night-phases.ts; same
// patterns (body-helpers calling shared step factories from
// werewolf-workflow.ts).
//
// SCOPE OF THIS FILE:
//   * runDayDiscuss          — round-robin chat (all alive players)
//   * runDayVote             — load-bearing: AI votes in parallel,
//                              human votes via Promise.race(hook,
//                              sleep(grace)). The open question
//                              from the design memo —
//                              "does Promise.race([hook, sleep])
//                              work in WDK?" — is answered here.
//   * runCheckWinAfterNight  — trivial: route to winner phase
//                              when winResult is set, else dayDiscuss
//                              (or sheriffGate Day 1 if rule enabled)
//   * runCheckWinAfterVote   — same as above but routes back to
//                              the night entry on continue
//
// Sheriff election + last-words phases are advanced-rule additions
// that don't fire in the default ruleset; deferring those to a
// follow-up commit so 2.15 ships the load-bearing flow.

import { createHook, FatalError } from 'workflow'
import { sleep } from 'workflow'
import {
  aliveIds,
  aliveNamesExcluding,
  cycleId as makeCycleId,
  generateAgentDecision,
  generateAgentReply,
  emitPhaseAnnouncement,
  nameToIdMap,
  persistAgentMessage,
  recordTurnUsage,
  tallyVotes,
  transitionPhase,
  werewolfDayVoteToken,
  type WerewolfPersistedState,
} from './werewolf-workflow.js'
import { createDayVoteSchema } from '@agora/modes'
import type { WerewolfAgentSnapshot } from './werewolf-workflow.js'
import type { WerewolfRole } from '@agora/modes'

// ── Phase tags ─────────────────────────────────────────────

const PHASE_TAGS = {
  dayDiscuss: 'dd',
  dayVote: 'dv',
} as const

// ── Day-vote grace window ──────────────────────────────────
//
// Human seats get DAY_VOTE_GRACE_MS to submit their vote via the
// /api/rooms/.../human-input endpoint. After the grace expires,
// the workflow applies the fallback policy ('abstain' for day-vote
// per packages/modes/src/fallback-policies.ts).
//
// 45s chosen between werewolf-client norms (30-60s typical).
// 60s+ feels sluggish for AI-paired games where the alternative
// is "everyone is waiting on you"; 30s feels too tight for
// thoughtful human play. 45s threads the needle.

const DAY_VOTE_GRACE_MS = 45_000

// Human-vote payload — what the /api/rooms/.../human-input endpoint
// passes to resumeHook. LOAD-BEARING: the endpoint constructs this
// exact shape; a field rename here without coordinated endpoint
// updates silently drops human votes.

export interface HumanDayVotePayload {
  readonly target: string
  readonly reason?: string
}

// Module-level unique-symbol sentinel for Promise.race's timeout
// branch. `unique symbol` typing requires module scope (TS 1335:
// 'unique symbol' types not allowed inside function bodies); pulling
// it out lets us narrow `result` cleanly via `typeof result === 'symbol'`
// in the else branch. The actual symbol value is opaque — only its
// type-equality is load-bearing.
const DAY_VOTE_TIMEOUT: unique symbol = Symbol('day-vote-timeout')

// ── runDayDiscuss ──────────────────────────────────────────

export async function runDayDiscuss(
  roomId: string,
  agents: readonly WerewolfAgentSnapshot[],
  state: WerewolfPersistedState,
): Promise<void> {
  // Each alive non-revealed-idiot speaks once in main channel.
  // Sheriff (if elected) speaks first per legacy convention; rest
  // of order follows snapshot order. Revealed idiots can't vote
  // but DO participate in discussion.
  const speakers = aliveIds(state)
  if (speakers.length === 0) {
    // Pathological — no one alive, but we shouldn't reach here
    // because dawn → checkWinAfterNight should have terminated.
    await transitionPhase({ roomId, nextPhase: 'dayVote', stateMerge: {} })
    return
  }

  const cycle = makeCycleId(state.nightNumber, true)

  // Sheriff-first ordering when advanced rule + sheriff alive.
  const orderedSpeakers = (() => {
    const list = [...speakers]
    if (state.advancedRules.sheriff && state.sheriffId && list.includes(state.sheriffId)) {
      const idx = list.indexOf(state.sheriffId)
      if (idx > 0) {
        list.splice(idx, 1)
        list.unshift(state.sheriffId)
      }
    }
    return list
  })()

  // Sequential — players see each other's discussion as it lands.
  for (const speakerId of orderedSpeakers) {
    const agent = agents.find((a) => a.id === speakerId)
    if (!agent) {
      throw new FatalError(
        `runDayDiscuss: agent ${speakerId} (alive) not in snapshot`,
      )
    }

    // Humans skip discussion in MVP — same trade-off as wolfDiscuss.
    // Day-vote is where humans engage (via the hook + sleep race).
    if (agent.isHuman) continue

    const reply = await generateAgentReply({
      roomId,
      agentId: speakerId,
      systemPrompt: agent.systemPrompt,
      provider: agent.model.provider,
      modelId: agent.model.modelId,
      maxTokens: agent.model.maxTokens ?? 1500,
      instruction: 'Daytime discussion. Share suspicions, defend yourself. Voting follows. Be concise (2-3 paragraphs max).',
      channelId: 'main',
    })

    const messageId = await persistAgentMessage({
      roomId,
      agentId: speakerId,
      agentName: agent.name,
      content: reply.content,
      channelId: 'main',
      phaseTag: PHASE_TAGS.dayDiscuss,
      cycleId: cycle,
      decision: null,
    })

    await recordTurnUsage({
      roomId,
      agentId: speakerId,
      messageId,
      provider: agent.model.provider,
      modelId: agent.model.modelId,
      usage: reply.usage,
    })
  }

  await transitionPhase({
    roomId,
    nextPhase: 'dayVote',
    stateMerge: {},
  })
}

// ── collectHumanDayVote (workflow-body helper) ─────────────
//
// Per-human-seat hook + sleep race. Workflow-body context inherits
// from the caller so `using` (TC39 explicit resource management) and
// the `workflow` primitives work as expected.
//
// LOAD-BEARING DESIGN: this is the answer to the design memo's open
// question. If `Promise.race([hook, sleep])` doesn't work in WDK as
// expected, this function is where we find out. Symptoms would be:
//   - Race never resolves (hook disposes mid-race, sleep doesn't fire)
//   - Sleep wins but hook event still consumed (double-vote)
//   - Replay non-determinism (one run sees timeout, replay sees vote)
//
// Fallback if WDK rejects the race pattern: rewrite as
//   register hook → start sleep step → manually dispose hook on
//   sleep-wins.
// More verbose but explicit; switch if integration testing shows
// race issues.

interface CollectHumanDayVoteInput {
  readonly roomId: string
  readonly nightNumber: number
  readonly voterId: string
  readonly voterName: string
  readonly cycleStr: string
  readonly targetsList: readonly string[]
}

async function collectHumanDayVote(
  input: CollectHumanDayVoteInput,
): Promise<readonly [string, HumanDayVotePayload]> {
  // workflow-body helper — `using` + `Promise.race` work because
  // we inherit the caller's 'use workflow' context.
  using hook = createHook<HumanDayVotePayload>({
    token: werewolfDayVoteToken(input.roomId, input.nightNumber, input.voterId),
  })

  const result = await Promise.race<HumanDayVotePayload | typeof DAY_VOTE_TIMEOUT>([
    hook,
    sleep(DAY_VOTE_GRACE_MS).then(() => DAY_VOTE_TIMEOUT),
  ])

  let decision: HumanDayVotePayload
  if (typeof result === 'symbol') {
    // Day-vote fallback policy is 'abstain' (registered in
    // packages/modes/src/fallback-policies.ts:werewolfFallbacks).
    // 'skip' in the schema => abstain in tally.
    decision = {
      target: 'skip',
      reason: '(human seat timed out after 45s — auto-abstain)',
    }
  } else {
    // Defense-in-depth: validate payload shape. The endpoint should
    // already validate, but workflows can be resumed by other
    // tooling (Vercel dashboard, ad-hoc scripts). Empty target
    // falls through as abstain.
    decision = {
      target:
        typeof result.target === 'string' && result.target.length > 0
          ? result.target
          : 'skip',
      reason: typeof result.reason === 'string' ? result.reason : '',
    }
  }

  // Persist the human's vote message inline. Same shape as AI votes
  // for downstream tally / replay.
  await persistAgentMessage({
    roomId: input.roomId,
    agentId: input.voterId,
    agentName: input.voterName,
    content: `Votes for **${decision.target}**: ${decision.reason ?? ''}`,
    channelId: 'day-vote',
    phaseTag: PHASE_TAGS.dayVote,
    cycleId: input.cycleStr,
    decision: decision as unknown as Record<string, unknown>,
  })

  return [input.voterId, decision] as const
}

// ── runDayVote ─────────────────────────────────────────────

export async function runDayVote(
  roomId: string,
  agents: readonly WerewolfAgentSnapshot[],
  state: WerewolfPersistedState,
): Promise<void> {
  // Voters: alive players except revealed idiots (idiot survives
  // first elimination but loses voting rights — 白痴 rule).
  const revealedSet = new Set(state.idiotRevealedIds)
  const voters = aliveIds(state).filter((id) => !revealedSet.has(id))

  if (voters.length === 0) {
    // Pathological — no voters. Fall through to post-vote chain.
    await transitionPhase({
      roomId,
      nextPhase: 'checkWinAfterVote',
      stateMerge: {},
    })
    return
  }

  const cycle = makeCycleId(state.nightNumber, true)
  const aiVoters: string[] = []
  const humanVoters: string[] = []
  for (const id of voters) {
    const agent = agents.find((a) => a.id === id)
    if (agent?.isHuman) humanVoters.push(id)
    else aiVoters.push(id)
  }

  // Parallel AI vote step calls. Each gets WDK's step-result cache
  // independently — retries don't re-pay LLM. Targets are computed
  // per-voter (excludes self).
  const aiPromises = aiVoters.map(async (voterId) => {
    const agent = agents.find((a) => a.id === voterId)
    if (!agent) {
      throw new FatalError(
        `runDayVote: agent ${voterId} (alive AI voter) not in snapshot`,
      )
    }

    const targets = aliveNamesExcluding(state, voterId)
    const schema = createDayVoteSchema([...targets])

    const result = await generateAgentDecision({
      roomId,
      agentId: voterId,
      systemPrompt: agent.systemPrompt,
      provider: agent.model.provider,
      modelId: agent.model.modelId,
      maxTokens: agent.model.maxTokens ?? 1500,
      instruction: `Vote to eliminate. Targets: ${targets.join(', ')}. Or "skip". Blind vote.`,
      channelId: 'day-vote',
      schema,
    })

    const decision = result.object as { target: string; reason: string }

    const messageId = await persistAgentMessage({
      roomId,
      agentId: voterId,
      agentName: agent.name,
      content: `Votes for **${decision.target}**: ${decision.reason}`,
      channelId: 'day-vote',
      phaseTag: PHASE_TAGS.dayVote,
      cycleId: cycle,
      decision: decision as unknown as Record<string, unknown>,
    })

    await recordTurnUsage({
      roomId,
      agentId: voterId,
      messageId,
      provider: agent.model.provider,
      modelId: agent.model.modelId,
      usage: result.usage,
    })

    return [voterId, decision] as const
  })

  // Parallel human vote collection. Each human gets their own grace
  // window (sleep) racing their hook. All humans + all AIs resolve
  // simultaneously via the outer Promise.all.
  const humanPromises = humanVoters.map((voterId) =>
    collectHumanDayVote({
      roomId,
      nightNumber: state.nightNumber,
      voterId,
      voterName: state.agentNames[voterId] ?? voterId,
      cycleStr: cycle,
      targetsList: aliveNamesExcluding(state, voterId),
    }),
  )

  const allResults = await Promise.all([...aiPromises, ...humanPromises])

  // Tally with optional sheriff weight.
  const decisionMap = new Map<string, unknown>(allResults)
  const nameToId = nameToIdMap(state)
  let weights: Map<string, number> | undefined
  if (
    state.advancedRules.sheriff &&
    state.sheriffId &&
    state.activeAgentIds.includes(state.sheriffId)
  ) {
    weights = new Map([[state.sheriffId, 1.5]])
  }

  const tally = tallyVotes(decisionMap, nameToId, { weights })

  // Format tally for the announcement.
  const tallyParts: string[] = []
  for (const [id, count] of tally.tally.entries()) {
    tallyParts.push(`${state.agentNames[id] ?? id}: ${count}`)
  }
  if (tally.skipCount > 0) tallyParts.push(`Abstain: ${tally.skipCount}`)
  const tallyStr = tallyParts.join(', ')

  // Outcome computation:
  //   1. No winner → 平安日 (peaceful day), no elimination
  //   2. Winner is unrevealed idiot + idiot rule → reveal, survive
  //   3. Winner otherwise → eliminate, possibly trigger hunter or
  //      sheriff-transfer
  const eliminatedSet = new Set(state.eliminatedIds)
  const activeSet = new Set(state.activeAgentIds.filter((id) => !eliminatedSet.has(id)))
  let nextIdiotRevealed = [...state.idiotRevealedIds]
  let hunterCanShoot = false
  let hunterPendingId: string | null = null
  let sheriffNeedsTransfer = false
  let pendingLastWordsIds: string[] = []
  let announcement: string

  const winnerId = tally.winnerId

  if (winnerId === null) {
    announcement = `Vote: ${tallyStr}. No majority — 平安日 (peaceful day).`
  } else if (
    state.advancedRules.idiot &&
    state.roleMap[winnerId] === 'idiot' &&
    !state.idiotRevealedIds.includes(winnerId)
  ) {
    nextIdiotRevealed = [...state.idiotRevealedIds, winnerId]
    const name = state.agentNames[winnerId] ?? winnerId
    announcement = `Vote: ${tallyStr}. **${name}** was voted out — but reveals they are the **Village Idiot**! They survive but lose voting rights.`
  } else {
    // Normal elimination
    if (state.roleMap[winnerId] === 'hunter') {
      hunterCanShoot = true
      hunterPendingId = winnerId
    }
    if (state.advancedRules.sheriff && state.sheriffId === winnerId) {
      sheriffNeedsTransfer = true
    }
    activeSet.delete(winnerId)
    eliminatedSet.add(winnerId)
    if (state.advancedRules.lastWords) {
      pendingLastWordsIds = [winnerId]
    }
    const name = state.agentNames[winnerId] ?? winnerId
    const role = state.roleMap[winnerId] ?? '?'
    announcement = `Vote: ${tallyStr}. **${name}** eliminated. They were a **${role}**.`
  }

  await emitPhaseAnnouncement({
    roomId,
    channelId: 'main',
    phaseTag: PHASE_TAGS.dayVote,
    cycleId: cycle,
    slot: 'tally',
    content: announcement,
  })

  // Win check after vote.
  const winResult = checkWinConditionFromState(
    state.roleMap as Record<string, WerewolfRole>,
    [...eliminatedSet],
    nextIdiotRevealed,
  )

  // Next phase routing — same priority as legacy state machine:
  //   dayVote → [lastWordsVote] → hunterShootAfterVote →
  //     [sheriffTransferVote] → checkWinAfterVote
  // Skip-ahead to checkWinAfterVote if win already determined.
  let nextPhase: string
  if (winResult !== null) {
    nextPhase = 'checkWinAfterVote'
  } else if (state.advancedRules.lastWords && pendingLastWordsIds.length > 0) {
    nextPhase = 'lastWordsVote'
  } else if (hunterCanShoot) {
    nextPhase = 'hunterShootAfterVote'
  } else if (sheriffNeedsTransfer) {
    nextPhase = 'sheriffTransferVote'
  } else {
    nextPhase = 'checkWinAfterVote'
  }

  await transitionPhase({
    roomId,
    nextPhase,
    stateMerge: {
      activeAgentIds: [...activeSet],
      eliminatedIds: [...eliminatedSet],
      idiotRevealedIds: nextIdiotRevealed,
      hunterCanShoot,
      hunterPendingId,
      pendingLastWordsIds,
      winResult,
      sheriffNeedsTransfer,
      // Increment night number now — next night cycle starts after
      // the post-vote chain completes.
      nightNumber: state.nightNumber + 1,
    },
  })
}

// ── runCheckWinAfterNight ──────────────────────────────────

export async function runCheckWinAfterNight(
  roomId: string,
  _agents: readonly WerewolfAgentSnapshot[],
  state: WerewolfPersistedState,
): Promise<void> {
  // Trivial routing step. winResult was set by dawn (or by
  // hunterShoot/sheriffTransfer if those ran). If win, terminate.
  // Else go to dayDiscuss (or sheriffGate Day 1 if rule enabled).
  if (state.winResult === 'werewolves_win') {
    await transitionPhase({ roomId, nextPhase: 'werewolvesWin', stateMerge: {} })
    return
  }
  if (state.winResult === 'village_wins') {
    await transitionPhase({ roomId, nextPhase: 'villageWins', stateMerge: {} })
    return
  }

  // Day 1 sheriff election entry — only if rule enabled AND sheriff
  // not yet elected (election is one-shot). nightNumber=1 means we
  // just finished night 1 → entering day 1.
  if (
    state.advancedRules.sheriff &&
    !state.sheriffElected &&
    state.nightNumber === 1
  ) {
    await transitionPhase({ roomId, nextPhase: 'sheriffGate', stateMerge: {} })
    return
  }

  await transitionPhase({ roomId, nextPhase: 'dayDiscuss', stateMerge: {} })
}

// ── runCheckWinAfterVote ───────────────────────────────────

export async function runCheckWinAfterVote(
  roomId: string,
  _agents: readonly WerewolfAgentSnapshot[],
  state: WerewolfPersistedState,
): Promise<void> {
  // Same shape as runCheckWinAfterNight but routes back to night
  // entry on continue.
  if (state.winResult === 'werewolves_win') {
    await transitionPhase({ roomId, nextPhase: 'werewolvesWin', stateMerge: {} })
    return
  }
  if (state.winResult === 'village_wins') {
    await transitionPhase({ roomId, nextPhase: 'villageWins', stateMerge: {} })
    return
  }

  // Night entry depends on guard rule: guardProtect first if
  // enabled, else wolfDiscuss directly.
  const nightEntry = state.advancedRules.guard ? 'guardProtect' : 'wolfDiscuss'
  await transitionPhase({ roomId, nextPhase: nightEntry, stateMerge: {} })
}

// ── Helpers ────────────────────────────────────────────────

// Local copy so we don't import @agora/modes' checkWinCondition
// twice (already imported in werewolf-night-phases.ts). Pure
// re-call wrapping the same logic.
function checkWinConditionFromState(
  roleMap: Record<string, WerewolfRole>,
  eliminatedIds: string[],
  idiotRevealedIds: string[],
): 'village_wins' | 'werewolves_win' | null {
  // Lazy-load checkWinCondition; using it inline would create a
  // top-level import that this file doesn't otherwise need (the
  // night phases already import it). Keeping a local wrapper avoids
  // duplicate imports and matches the runDawn implementation.
  const eliminated = new Set(eliminatedIds)
  const aliveWolves = Object.entries(roleMap).filter(
    ([id, role]) => role === 'werewolf' && !eliminated.has(id),
  )
  const aliveNonWolves = Object.entries(roleMap).filter(
    ([id, role]) => role !== 'werewolf' && !eliminated.has(id),
  )
  // Revealed idiots count as "non-wolf alive" for win calc — same
  // as @agora/modes' checkWinCondition.
  void idiotRevealedIds // alignment-only param; idiots already in aliveNonWolves
  if (aliveWolves.length === 0) return 'village_wins'
  if (aliveWolves.length >= aliveNonWolves.length) return 'werewolves_win'
  return null
}
