// ============================================================
// Phase 4.5d-2.14a — Werewolf night phases (WDK port)
// ============================================================
//
// Implements the night-cycle phase steps that werewolf-workflow.ts's
// dispatch loop calls. Split out from werewolf-workflow.ts to keep
// each file under the 800-line ceiling (CLAUDE.md File Organization).
//
// SCOPE OF THIS FILE AT 4.5d-2.14a:
//   * runWolfDiscuss — round-robin chat phase (wolves coordinate)
//   * runWolfVote     — structured vote, tally, transition to witch
//
// 4.5d-2.14b adds: runWitchAction, runSeerCheck, runGuardProtect,
// runDawn. They share the same pattern (read state, run per-speaker
// steps, apply outcome, transition).
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

import { FatalError } from 'workflow'
import {
  aliveIdsByRole,
  aliveNonWolfNames,
  cycleId as makeCycleId,
  generateAgentDecision,
  generateAgentReply,
  emitPhaseAnnouncement,
  nameToIdMap,
  persistAgentMessage,
  recordTurnUsage,
  tallyVotes,
  transitionPhase,
  type WerewolfPersistedState,
} from './werewolf-workflow.js'
import { createWolfVoteSchema } from '@agora/modes'
import type { WerewolfAgentSnapshot } from './werewolf-workflow.js'

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
  wolfDiscuss: 'wd',
  wolfVote: 'wv',
} as const

// ── runWolfDiscuss ─────────────────────────────────────────

export async function runWolfDiscuss(
  roomId: string,
  agents: readonly WerewolfAgentSnapshot[],
  state: WerewolfPersistedState,
): Promise<void> {
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

    // Skip humans during night chat for MVP — human wolf coordination
    // would need a hook + sleep grace per wolf, which is complexity
    // we save for the day-vote design (2.15). For now humans observe
    // wolf-chat but don't speak in it. Future enhancement.
    if (agent.isHuman) continue

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
): Promise<void> {
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

  const schema = createWolfVoteSchema([...targetNames])

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
      // Humans skip blind wolf-vote for MVP (same reasoning as
      // wolfDiscuss). They get fallback automatically.
      if (agent.isHuman) {
        return [wolfId, { target: 'skip', reason: 'human seat — fallback abstain' }] as const
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
        schema,
      })

      const decision = result.object as { target: string; reason: string }

      const messageId = await persistAgentMessage({
        roomId,
        agentId: wolfId,
        agentName: agent.name,
        content: `Votes for **${decision.target}**: ${decision.reason}`,
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
