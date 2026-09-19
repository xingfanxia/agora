// ============================================================
// Phase 4.5d-2.14 — Werewolf night phases (WDK port)
// ============================================================
//
// Implements the night-cycle phase steps that werewolf-workflow.ts's
// dispatch loop calls. Split out from werewolf-workflow.ts to keep
// each file under the 800-line ceiling (CLAUDE.md File Organization).
//
// SCOPE OF THIS FILE:
//   * runGuardProtect  — single-speaker structured (advanced rule)
//   * runWolfDiscuss   — round-robin chat (wolves coordinate)
//   * runWolfVote      — parallel blind vote, tally, lastNightKill
//   * runWitchAction   — single-speaker structured (save/poison/pass)
//   * runSeerCheck     — single-speaker structured (investigate)
//   * runDawn          — pure computation (resolve deaths, announce)
//
// Day phases (2.15) and triggered phases (2.16: hunter, sheriff
// transfer) live in sibling files when they ship.
//
// Each `runXxx` is a workflow-body helper (no `use step` / no
// `use workflow` marker — inherits the workflow context from the
// caller). Inside, it calls workflow steps via the shared step
// factories in werewolf-workflow.ts:
//   * generateAgentReply / generateAgentDecision (LLM)
//   * persistAgentMessage (writes message:created)
//   * recordTurnUsage (token cost)
//   * emitPhaseAnnouncement (system announcement)
//   * transitionPhase (atomic gameState advance)
//
// IDEMPOTENCY: each per-speaker step has a deterministic message id
// derived from (phaseTag, roomId, cycleId, agentId). Combined with
// events_message_id_uq partial UNIQUE, retries are no-op. The
// `transitionPhase` step at the end is the boundary: once
// currentPhase advances, the workflow restart can't re-enter this
// phase because the dispatch switch picks up the new phase.

import { createHook, FatalError } from 'workflow'
import { sleep } from 'workflow'
import {
  aliveIds,
  aliveIdsByRole,
  aliveNamesExcluding,
  aliveNonWolfNames,
  allAliveNames,
  cycleId as makeCycleId,
  generateAgentDecision,
  generateAgentReply,
  emitPhaseAnnouncement,
  markRunningAgainForWerewolf,
  markWaitingForWerewolfHuman,
  nameToIdMap,
  persistAgentMessage,
  recordTurnUsage,
  tallyVotes,
  transitionPhase,
  werewolfStrings,
  werewolfWolfDiscussToken,
  werewolfWolfVoteToken,
  type HumanWolfDiscussPayload,
  type HumanWolfVotePayload,
  type WerewolfPersistedState,
  type WerewolfLanguage,
} from './werewolf-workflow.js'
import {
  checkWinCondition,
} from '@agora/modes'
import type { WerewolfAgentSnapshot } from './werewolf-workflow.js'
import type { WerewolfRole } from '@agora/modes'

// ── Phase tags (for deterministic message ids) ─────────────
//
// Two-letter tags following the design memo's convention. Pinning
// here so 2.14b / 2.15 / 2.16 never accidentally collide. The full
// id format is `ww-${phaseTag}-${roomId}-${cycleId}-${agentId}`.
//
// The `wd-` from the design memo (day-vote) is renamed to `dv-` here
// because we already use `wd` for wolf-discuss. Day-vote in 2.15
// will use `dv`; this file's choice is consistent with that.

const PHASE_TAGS = {
  guardProtect: 'gp',
  wolfDiscuss: 'wd',
  wolfVote: 'wv',
  witchAction: 'wa',
  seerCheck: 'sc',
  dawn: 'dn',
} as const

// Wolf-discuss grace: 90s (same as day-discuss). Wolf-discuss is
// usually shorter than day chat per real-world werewolf flow but
// the typing budget should match — humans need think + type time
// regardless of phase.
const WOLF_DISCUSS_GRACE_MS = 90_000

// Wolf-vote grace: 45s (same as day-vote). Pinned target structured
// choice — quick decision, not extended thinking.
const WOLF_VOTE_GRACE_MS = 45_000

// Module-scoped unique-symbol sentinels for Promise.race timeouts.
// TS1335 forbids `unique symbol` inside function bodies; module scope
// is required. Same pattern as DAY_VOTE_TIMEOUT / DAY_DISCUSS_TIMEOUT.
const WOLF_DISCUSS_TIMEOUT: unique symbol = Symbol('wolf-discuss-timeout')
const WOLF_VOTE_TIMEOUT: unique symbol = Symbol('wolf-vote-timeout')

// ── runWolfDiscuss ─────────────────────────────────────────

export async function runWolfDiscuss(
  roomId: string,
  agents: readonly WerewolfAgentSnapshot[],
  state: WerewolfPersistedState,
  _language: WerewolfLanguage,
): Promise<void> {
  void _language
  // Each alive wolf speaks ONCE per discussion phase. The legacy
  // (packages/modes/src/werewolf/phases.ts) caps at maxTurns=6 with
  // a getSpeakers-based done predicate — at 3-4 wolves that's
  // typically one round each. We match the common case and skip
  // multi-round discussion for MVP; if game balance later needs
  // multiple rounds, extend this loop.
  const wolves = aliveIdsByRole(state, 'werewolf')
  if (wolves.length === 0) {
    // No wolves alive somehow — game should already be over. Defensive
    // transition to dawn so the loop progresses to a win-check.
    await transitionPhase({
      roomId,
      nextPhase: 'wolfVote',
      stateMerge: {},
    })
    return
  }

  const cycle = makeCycleId(state.nightNumber, false)

  // Sequential, not Promise.all: wolves can see each other's prior
  // messages, so coordination depends on prior wolves' content
  // landing in the events log first. Parallel would fork their
  // contexts. (Wolf-vote in the next phase IS parallel — votes are
  // blind so each wolf decides on the same prior context.)
  for (const wolfId of wolves) {
    const agent = agents.find((a) => a.id === wolfId)
    if (!agent) {
      throw new FatalError(
        `runWolfDiscuss: agent ${wolfId} (alive wolf) not in snapshot`,
      )
    }

    // Human wolves get the same sequential pause-and-prompt pattern
    // as dayDiscuss — markWaiting on this seat → hook race → markRunning
    // → persist or skip-on-timeout. Channel is 'werewolf' so only
    // wolves see the human's message in their context.
    if (agent.isHuman) {
      await collectHumanWolfDiscuss({
        roomId,
        nightNumber: state.nightNumber,
        speakerId: wolfId,
        speakerName: agent.name,
        cycleStr: cycle,
      })
      continue
    }

    const reply = await generateAgentReply({
      roomId,
      agentId: wolfId,
      systemPrompt: agent.systemPrompt,
      provider: agent.model.provider,
      modelId: agent.model.modelId,
      maxTokens: agent.model.maxTokens ?? 1500,
      instruction: 'It is nighttime. Discuss with your fellow wolves who to kill tonight.',
      channelId: 'werewolf',
    })

    const messageId = await persistAgentMessage({
      roomId,
      agentId: wolfId,
      agentName: agent.name,
      content: reply.content,
      channelId: 'werewolf',
      phaseTag: PHASE_TAGS.wolfDiscuss,
      cycleId: cycle,
      decision: null,
    })

    await recordTurnUsage({
      roomId,
      agentId: wolfId,
      messageId,
      provider: agent.model.provider,
      modelId: agent.model.modelId,
      usage: reply.usage,
    })
  }

  // Reset night state at the discussion → vote boundary. Mirrors the
  // legacy `wolfDiscussPhase().onEnter` but applied at exit since we
  // initialize state in initializeGameState; the wolfDiscuss → wolfVote
  // transition is the natural place to clear last-night artifacts
  // (they were already consumed by the prior dawn).
  await transitionPhase({
    roomId,
    nextPhase: 'wolfVote',
    stateMerge: {
      lastNightKill: null,
      witchPoisonTarget: null,
      witchUsedPotionTonight: false,
      seerResult: null,
      hunterCanShoot: false,
      hunterPendingId: null,
      hunterShotTarget: null,
      pendingLastWordsIds: [],
      // Guard rotates protection tracking (last-night protected can't
      // be protected again this night).
      guardLastProtectedId: state.guardProtectedId,
      guardProtectedId: null,
    },
  })
}

// ── runWolfVote ────────────────────────────────────────────

export async function runWolfVote(
  roomId: string,
  agents: readonly WerewolfAgentSnapshot[],
  state: WerewolfPersistedState,
  language: WerewolfLanguage,
): Promise<void> {
  const S = werewolfStrings(language)
  const wolves = aliveIdsByRole(state, 'werewolf')
  if (wolves.length === 0) {
    await transitionPhase({
      roomId,
      nextPhase: 'witchAction',
      stateMerge: { lastNightKill: null },
    })
    return
  }

  const cycle = makeCycleId(state.nightNumber, false)
  const targetNames = aliveNonWolfNames(state)

  if (targetNames.length === 0) {
    // No targets — wolves win by attrition. Set lastNightKill null
    // and let dawn → checkWinAfterNight resolve the win.
    await transitionPhase({
      roomId,
      nextPhase: 'witchAction',
      stateMerge: { lastNightKill: null },
    })
    return
  }

  // Parallel: wolf-vote is blind — each wolf decides on the same
  // prior context (the wolf-chat that just ended). Promise.all over
  // step calls is supported by WDK; each LLM call gets its own
  // step-result cache so retries don't re-pay.
  const decisions = await Promise.all(
    wolves.map(async (wolfId) => {
      const agent = agents.find((a) => a.id === wolfId)
      if (!agent) {
        throw new FatalError(
          `runWolfVote: agent ${wolfId} (alive wolf) not in snapshot`,
        )
      }
      // Human wolves get a parallel hook + sleep race, same shape as
      // collectHumanDayVote. The race outcome is mapped onto the same
      // {target, reason} decision shape as AI votes so the tally code
      // doesn't care whether the vote came from an LLM step or a
      // human resumeHook.
      if (agent.isHuman) {
        const decision = await collectHumanWolfVote({
          roomId,
          nightNumber: state.nightNumber,
          voterId: wolfId,
          voterName: agent.name,
          cycleStr: cycle,
          targetsList: targetNames,
          language,
        })
        return [wolfId, decision] as const
      }

      const result = await generateAgentDecision({
        roomId,
        agentId: wolfId,
        systemPrompt: agent.systemPrompt,
        provider: agent.model.provider,
        modelId: agent.model.modelId,
        maxTokens: agent.model.maxTokens ?? 1500,
        instruction: `Vote on who to kill. Targets: ${targetNames.join(', ')}. Vote is blind.`,
        channelId: 'wolf-vote',
        decision: { kind: 'wolfVote', targets: targetNames },
      })

      const decision = result.object as { target: string; reason: string }

      const messageId = await persistAgentMessage({
        roomId,
        agentId: wolfId,
        agentName: agent.name,
        content: S.voteCast(decision.target, decision.reason),
        channelId: 'wolf-vote',
        phaseTag: PHASE_TAGS.wolfVote,
        cycleId: cycle,
        decision: decision as unknown as Record<string, unknown>,
      })

      await recordTurnUsage({
        roomId,
        agentId: wolfId,
        messageId,
        provider: agent.model.provider,
        modelId: agent.model.modelId,
        usage: result.usage,
      })

      return [wolfId, decision] as const
    }),
  )

  // Tally + announce + transition. tallyVotes is a pure helper so we
  // run it inline; the announcement + transition are atomic via a
  // single transitionPhase step (read-merge-write).
  const decisionMap = new Map<string, unknown>(decisions)
  const nameToId = nameToIdMap(state)
  const tally = tallyVotes(decisionMap, nameToId)

  const tallyParts: string[] = []
  for (const [id, count] of tally.tally.entries()) {
    tallyParts.push(`${state.agentNames[id] ?? id}: ${count}`)
  }
  if (tally.skipCount > 0) tallyParts.push(`Abstain: ${tally.skipCount}`)
  const tallyStr = tallyParts.join(', ')

  const announcement = tally.winnerId
    ? `Wolves agreed: **${state.agentNames[tally.winnerId] ?? tally.winnerId}** is the target. (${tallyStr})`
    : `Wolves could not agree (${tallyStr}). 空刀 — no kill.`

  await emitPhaseAnnouncement({
    roomId,
    channelId: 'werewolf',
    phaseTag: PHASE_TAGS.wolfVote,
    cycleId: cycle,
    slot: 'tally',
    content: announcement,
  })

  await transitionPhase({
    roomId,
    nextPhase: 'witchAction',
    stateMerge: {
      lastNightKill: tally.winnerId,
    },
  })
}

// ── Human helpers (wolfDiscuss + wolfVote) ─────────────────
//
// Mirror dayDiscuss / dayVote's hook + sleep race pattern, scoped to
// the night-cycle wolf channel. Two distinct token namespaces
// (werewolf-wolf-discuss vs werewolf-wolf-vote) so a stale resume
// can't accidentally land on the wrong phase.
//
// LOAD-BEARING: markWaitingForWerewolfHuman BEFORE createHook in
// the chat path. Same rationale as collectHumanDayDiscuss — the
// breadcrumb commits before the hook so a fast resumeHook from the
// endpoint won't beat the waiting marker.

interface CollectHumanWolfDiscussInput {
  readonly roomId: string
  readonly nightNumber: number
  readonly speakerId: string
  readonly speakerName: string
  readonly cycleStr: string
}

async function collectHumanWolfDiscuss(
  input: CollectHumanWolfDiscussInput,
): Promise<void> {
  await markWaitingForWerewolfHuman({
    roomId: input.roomId,
    agentId: input.speakerId,
    phaseTag: 'wolfDiscuss',
  })

  using hook = createHook<HumanWolfDiscussPayload>({
    token: werewolfWolfDiscussToken(input.roomId, input.nightNumber, input.speakerId),
  })

  const result = await Promise.race<HumanWolfDiscussPayload | typeof WOLF_DISCUSS_TIMEOUT>([
    hook,
    sleep(WOLF_DISCUSS_GRACE_MS).then(() => WOLF_DISCUSS_TIMEOUT),
  ])

  await markRunningAgainForWerewolf({ roomId: input.roomId })

  if (typeof result === 'symbol') return
  const text = typeof result.text === 'string' ? result.text.trim() : ''
  if (text.length === 0) return

  await persistAgentMessage({
    roomId: input.roomId,
    agentId: input.speakerId,
    agentName: input.speakerName,
    content: text,
    channelId: 'werewolf', // wolves-only channel
    phaseTag: PHASE_TAGS.wolfDiscuss,
    cycleId: input.cycleStr,
    decision: null,
  })
}

interface CollectHumanWolfVoteInput {
  readonly roomId: string
  readonly nightNumber: number
  readonly voterId: string
  readonly voterName: string
  readonly cycleStr: string
  readonly targetsList: readonly string[]
  readonly language: WerewolfLanguage
}

/**
 * Parallel wolf-vote collector for a single human wolf. Returns a
 * decision in the same {target, reason} shape as AI votes so
 * runWolfVote's tally code is shape-agnostic. NO markWaiting call
 * here: wolf-vote runs all wolves' hooks in parallel via Promise.all,
 * room stays at status='running' across the whole vote phase
 * (matches collectHumanDayVote — no waitingForHuman breadcrumb).
 *
 * The UI uses the existing VotePanel with turnId='wolf-vote' (already
 * wired in HumanPlayBar.tsx for currentPhase==='wolfVote').
 */
async function collectHumanWolfVote(
  input: CollectHumanWolfVoteInput,
): Promise<HumanWolfVotePayload> {
  void input.targetsList
  const S = werewolfStrings(input.language)
  using hook = createHook<HumanWolfVotePayload>({
    token: werewolfWolfVoteToken(input.roomId, input.nightNumber, input.voterId),
  })

  const result = await Promise.race<HumanWolfVotePayload | typeof WOLF_VOTE_TIMEOUT>([
    hook,
    sleep(WOLF_VOTE_GRACE_MS).then(() => WOLF_VOTE_TIMEOUT),
  ])

  let decision: HumanWolfVotePayload
  if (typeof result === 'symbol') {
    decision = { target: 'skip', reason: S.humanTimeoutAbstain }
  } else {
    decision = {
      target:
        typeof result.target === 'string' && result.target.length > 0
          ? result.target
          : 'skip',
      reason: typeof result.reason === 'string' ? result.reason : '',
    }
  }

  // Persist the human's vote message inline (same shape as AI votes
  // for downstream tally / replay). Channel is wolf-vote so the kill
  // decision is logged to the wolves-only audit channel.
  await persistAgentMessage({
    roomId: input.roomId,
    agentId: input.voterId,
    agentName: input.voterName,
    content: S.voteCast(decision.target, decision.reason ?? ''),
    channelId: 'wolf-vote',
    phaseTag: PHASE_TAGS.wolfVote,
    cycleId: input.cycleStr,
    decision: decision as unknown as Record<string, unknown>,
  })

  return decision
}

// ── runGuardProtect (advanced rule) ────────────────────────

export async function runGuardProtect(
  roomId: string,
  agents: readonly WerewolfAgentSnapshot[],
  state: WerewolfPersistedState,
  _language: WerewolfLanguage,
): Promise<void> {
  void _language
  // Guard runs ONLY when the advanced rule is enabled. If the
  // dispatch reaches this branch with rules.guard=false, treat as
  // a no-op transition. Defensive — initializeGameState wouldn't
  // set currentPhase='guardProtect' without rules.guard.
  if (!state.advancedRules.guard) {
    await transitionPhase({ roomId, nextPhase: 'wolfDiscuss', stateMerge: {} })
    return
  }

  const guards = aliveIdsByRole(state, 'guard')
  if (guards.length === 0) {
    // No guard alive — skip phase, transition to wolves.
    await transitionPhase({ roomId, nextPhase: 'wolfDiscuss', stateMerge: {} })
    return
  }

  const guardId = guards[0]!
  const agent = agents.find((a) => a.id === guardId)
  if (!agent) {
    throw new FatalError(
      `runGuardProtect: agent ${guardId} (alive guard) not in snapshot`,
    )
  }

  const cycle = makeCycleId(state.nightNumber, false)

  // Target list excludes the previously-protected player (同守同救
  // rule: can't protect same player two nights in a row). Empty
  // string excluder is safe — no agent has empty id.
  const excluded = state.guardLastProtectedId ?? ''
  const targetIds = aliveIds(state).filter((id) => id !== excluded)
  const targets = targetIds.map((id) => state.agentNames[id] ?? id)

  if (targets.length === 0) {
    // Pathological — all alive players are excluded. Skip.
    await transitionPhase({ roomId, nextPhase: 'wolfDiscuss', stateMerge: {} })
    return
  }

  let protectedTargetId: string | null = null
  if (agent.isHuman) {
    // MVP: humans skip night actions (fallback). 2.18+ can extend
    // human-input to night phases if desired.
    protectedTargetId = null
  } else {
    const excludedName = state.guardLastProtectedId
      ? (state.agentNames[state.guardLastProtectedId] ?? 'someone')
      : null
    const instruction = excludedName
      ? `Choose a player to protect tonight. They will be immune to the wolf kill. You cannot protect **${excludedName}** again (protected last night).`
      : 'Choose a player to protect tonight. They will be immune to the wolf kill.'

    const result = await generateAgentDecision({
      roomId,
      agentId: guardId,
      systemPrompt: agent.systemPrompt,
      provider: agent.model.provider,
      modelId: agent.model.modelId,
      maxTokens: agent.model.maxTokens ?? 1500,
      instruction,
      channelId: 'guard-action',
      decision: { kind: 'guardProtect', targets },
    })

    const decision = result.object as { target: string; reason: string }

    const messageId = await persistAgentMessage({
      roomId,
      agentId: guardId,
      agentName: agent.name,
      content: `Protects **${decision.target}** tonight: ${decision.reason}`,
      channelId: 'guard-action',
      phaseTag: PHASE_TAGS.guardProtect,
      cycleId: cycle,
      decision: decision as unknown as Record<string, unknown>,
    })

    await recordTurnUsage({
      roomId,
      agentId: guardId,
      messageId,
      provider: agent.model.provider,
      modelId: agent.model.modelId,
      usage: result.usage,
    })

    if (decision.target !== 'none') {
      const id = nameToIdMap(state).get(decision.target)
      if (id) protectedTargetId = id
    }
  }

  await transitionPhase({
    roomId,
    nextPhase: 'wolfDiscuss',
    stateMerge: { guardProtectedId: protectedTargetId },
  })
}

// ── runWitchAction ─────────────────────────────────────────

export async function runWitchAction(
  roomId: string,
  agents: readonly WerewolfAgentSnapshot[],
  state: WerewolfPersistedState,
  _language: WerewolfLanguage,
): Promise<void> {
  const witches = aliveIdsByRole(state, 'witch')
  if (witches.length === 0) {
    await transitionPhase({ roomId, nextPhase: 'seerCheck', stateMerge: {} })
    return
  }

  const witchId = witches[0]!
  const agent = agents.find((a) => a.id === witchId)
  if (!agent) {
    throw new FatalError(
      `runWitchAction: agent ${witchId} (alive witch) not in snapshot`,
    )
  }

  const cycle = makeCycleId(state.nightNumber, false)

  // Save mechanics: witch can save unless the wolf-kill targeted
  // herself (rule: 不能自救 — can't save self) AND she hasn't used
  // the antidote yet.
  const witchIsTarget = state.lastNightKill === witchId
  const canSave = !state.witchSaveUsed && state.lastNightKill !== null && !witchIsTarget
  const canPoison = !state.witchPoisonUsed

  // Apply mutations to a working state so we can compute the merge.
  let nextWitchSaveUsed = state.witchSaveUsed
  let nextWitchPoisonUsed = state.witchPoisonUsed
  let nextWitchPoisonTarget: string | null = state.witchPoisonTarget
  let nextWitchUsedPotionTonight = state.witchUsedPotionTonight
  let nextLastNightKill: string | null = state.lastNightKill

  if (agent.isHuman) {
    // MVP: humans skip night actions.
  } else {
    const alivePlayers = allAliveNames(state)

    const parts: string[] = []
    if (state.witchSaveUsed) {
      parts.push('The wolves attacked someone, but you no longer know who (antidote already used).')
    } else if (state.lastNightKill) {
      const targetName = state.agentNames[state.lastNightKill] ?? 'someone'
      if (witchIsTarget) {
        parts.push(`The wolves targeted **you**. You cannot save yourself.`)
      } else {
        parts.push(`The wolves chose to kill **${targetName}**. You may save them.`)
      }
    } else {
      parts.push('No one was attacked tonight.')
    }
    if (canPoison) parts.push('You may use POISON.')
    parts.push('AT MOST ONE potion per night.')

    const result = await generateAgentDecision({
      roomId,
      agentId: witchId,
      systemPrompt: agent.systemPrompt,
      provider: agent.model.provider,
      modelId: agent.model.modelId,
      maxTokens: agent.model.maxTokens ?? 1500,
      instruction: parts.join(' '),
      channelId: 'witch-action',
      decision: { kind: 'witchAction', canSave, canPoison, alivePlayers },
    })

    const decision = result.object as {
      action: 'save' | 'poison' | 'pass'
      poisonTarget: string
      reason: string
    }

    let summary = `Passes: ${decision.reason}`
    if (decision.action === 'save' && canSave) {
      nextWitchSaveUsed = true
      nextWitchUsedPotionTonight = true
      // Saving nulls lastNightKill (wolves' victim survives). Guard
      // already-protected case is handled in dawn.
      nextLastNightKill = null
      summary = `Uses ANTIDOTE: ${decision.reason}`
    } else if (
      decision.action === 'poison' &&
      decision.poisonTarget !== 'none' &&
      canPoison &&
      !nextWitchUsedPotionTonight
    ) {
      const id = nameToIdMap(state).get(decision.poisonTarget)
      if (id) {
        nextWitchPoisonUsed = true
        nextWitchUsedPotionTonight = true
        nextWitchPoisonTarget = id
        summary = `Uses POISON on **${decision.poisonTarget}**: ${decision.reason}`
      }
    }

    const messageId = await persistAgentMessage({
      roomId,
      agentId: witchId,
      agentName: agent.name,
      content: summary,
      channelId: 'witch-action',
      phaseTag: PHASE_TAGS.witchAction,
      cycleId: cycle,
      decision: decision as unknown as Record<string, unknown>,
    })

    await recordTurnUsage({
      roomId,
      agentId: witchId,
      messageId,
      provider: agent.model.provider,
      modelId: agent.model.modelId,
      usage: result.usage,
    })
  }

  await transitionPhase({
    roomId,
    nextPhase: 'seerCheck',
    stateMerge: {
      witchSaveUsed: nextWitchSaveUsed,
      witchPoisonUsed: nextWitchPoisonUsed,
      witchPoisonTarget: nextWitchPoisonTarget,
      witchUsedPotionTonight: nextWitchUsedPotionTonight,
      lastNightKill: nextLastNightKill,
    },
  })
}

// ── runSeerCheck ───────────────────────────────────────────

export async function runSeerCheck(
  roomId: string,
  agents: readonly WerewolfAgentSnapshot[],
  state: WerewolfPersistedState,
  _language: WerewolfLanguage,
): Promise<void> {
  const seers = aliveIdsByRole(state, 'seer')
  if (seers.length === 0) {
    await transitionPhase({ roomId, nextPhase: 'dawn', stateMerge: {} })
    return
  }

  const seerId = seers[0]!
  const agent = agents.find((a) => a.id === seerId)
  if (!agent) {
    throw new FatalError(
      `runSeerCheck: agent ${seerId} (alive seer) not in snapshot`,
    )
  }

  const cycle = makeCycleId(state.nightNumber, false)
  const targets = aliveNamesExcluding(state, seerId)

  let seerResult: { targetId: string; isWerewolf: boolean } | null = null

  if (agent.isHuman || targets.length === 0) {
    // MVP humans skip; no targets is pathological.
  } else {
    const result = await generateAgentDecision({
      roomId,
      agentId: seerId,
      systemPrompt: agent.systemPrompt,
      provider: agent.model.provider,
      modelId: agent.model.modelId,
      maxTokens: agent.model.maxTokens ?? 1500,
      instruction: `Investigate a player. Targets: ${targets.join(', ')}.`,
      channelId: 'seer-result',
      decision: { kind: 'seerCheck', targets },
    })

    const decision = result.object as { target: string }
    const id = nameToIdMap(state).get(decision.target)

    let summary = `Investigates **${decision.target}**.`
    if (id) {
      const isWolf = state.roleMap[id] === 'werewolf'
      seerResult = { targetId: id, isWerewolf: isWolf }
      summary = `Investigation: **${decision.target}** is ${isWolf ? 'a WEREWOLF' : 'NOT a werewolf'}.`
    }

    const messageId = await persistAgentMessage({
      roomId,
      agentId: seerId,
      agentName: agent.name,
      content: summary,
      channelId: 'seer-result',
      phaseTag: PHASE_TAGS.seerCheck,
      cycleId: cycle,
      decision: decision as unknown as Record<string, unknown>,
    })

    await recordTurnUsage({
      roomId,
      agentId: seerId,
      messageId,
      provider: agent.model.provider,
      modelId: agent.model.modelId,
      usage: result.usage,
    })
  }

  await transitionPhase({
    roomId,
    nextPhase: 'dawn',
    stateMerge: { seerResult },
  })
}

// ── runDawn (pure computation, no LLM) ─────────────────────

export async function runDawn(
  roomId: string,
  _agents: readonly WerewolfAgentSnapshot[],
  state: WerewolfPersistedState,
  language: WerewolfLanguage,
): Promise<void> {
  const S = werewolfStrings(language)
  // Resolve overnight deaths: wolf-kill (if not saved by witch or
  // protected by guard) + witch-poison (bypasses guard). Both
  // resolutions are computed off the persisted state, no LLM call.

  const cycle = makeCycleId(state.nightNumber, false)
  const rules = state.advancedRules

  const eliminatedSet = new Set(state.eliminatedIds)
  const activeSet = new Set(state.activeAgentIds.filter((id) => !eliminatedSet.has(id)))

  const newlyDead: string[] = []
  const deathCauses = new Map<string, 'wolf' | 'poison'>()

  // Wolf kill
  if (state.lastNightKill) {
    const targetId = state.lastNightKill
    const guardSaved = rules.guard && state.guardProtectedId === targetId
    if (!guardSaved && activeSet.has(targetId)) {
      activeSet.delete(targetId)
      eliminatedSet.add(targetId)
      newlyDead.push(targetId)
      deathCauses.set(targetId, 'wolf')
    }
  }

  // Witch poison (bypasses guard)
  if (state.witchPoisonTarget) {
    const targetId = state.witchPoisonTarget
    if (activeSet.has(targetId) && !deathCauses.has(targetId)) {
      activeSet.delete(targetId)
      eliminatedSet.add(targetId)
      newlyDead.push(targetId)
      deathCauses.set(targetId, 'poison')
    }
  }

  // Hunter trigger: hunter killed by wolf can shoot. Hunter killed
  // by poison CANNOT (毒不发刀 — poisoned hunter doesn't fire).
  let hunterCanShoot = false
  let hunterPendingId: string | null = null
  for (const [id, cause] of deathCauses) {
    if (state.roleMap[id] === 'hunter' && cause === 'wolf') {
      hunterCanShoot = true
      hunterPendingId = id
      break
    }
  }

  // Sheriff transfer flag
  let sheriffNeedsTransfer = false
  if (rules.sheriff && state.sheriffId && deathCauses.has(state.sheriffId)) {
    sheriffNeedsTransfer = true
  }

  // Pending last-words queue
  const pendingLastWordsIds: string[] = rules.lastWords ? [...newlyDead] : []

  // Announcement
  const deathNames = newlyDead.map((id) => state.agentNames[id] ?? id)
  const announcement =
    deathNames.length > 0 ? S.dawnDeath(deathNames) : S.dawnPeaceful

  await emitPhaseAnnouncement({
    roomId,
    channelId: 'main',
    phaseTag: PHASE_TAGS.dawn,
    cycleId: cycle,
    slot: 'announce',
    content: announcement,
  })

  // Win check after night deaths
  const winResult = checkWinCondition(
    state.roleMap as Record<string, WerewolfRole>,
    [...eliminatedSet],
    [...state.idiotRevealedIds],
  )

  // Determine next phase. Order in legacy state machine:
  //   dawn → [lastWordsDawn] → hunterShoot → [sheriffTransferNight] → checkWinAfterNight
  // Skip-ahead to checkWinAfterNight if win already determined.
  let nextPhase: string
  if (winResult !== null) {
    nextPhase = 'checkWinAfterNight'
  } else if (rules.lastWords && pendingLastWordsIds.length > 0) {
    nextPhase = 'lastWordsDawn'
  } else if (hunterCanShoot) {
    nextPhase = 'hunterShoot'
  } else if (sheriffNeedsTransfer) {
    nextPhase = 'sheriffTransferNight'
  } else {
    nextPhase = 'checkWinAfterNight'
  }

  await transitionPhase({
    roomId,
    nextPhase,
    stateMerge: {
      activeAgentIds: [...activeSet],
      eliminatedIds: [...eliminatedSet],
      lastNightKill: null,
      seerResult: null,
      witchPoisonTarget: null,
      hunterCanShoot,
      hunterPendingId,
      pendingLastWordsIds,
      winResult,
      sheriffNeedsTransfer,
    },
  })
}
