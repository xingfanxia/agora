// ============================================================
// Phase 4.5d-2.13 — Werewolf workflow (WDK port) — SKELETON
// ============================================================
//
// Third (and final) production WDK port. Replaces the legacy
// http_chain advance loop (`advanceWerewolfRoom` in
// `apps/web/app/lib/room-runtime.ts`) with a durable workflow that
// drives the werewolf state machine to completion.
//
// SCOPE OF THIS FILE AT 4.5d-2.13:
//   * Workflow body shell with `switch (currentPhase)` dispatch
//   * Real `generateAgentDecision` step (used by 2.14-2.16)
//   * Real `applyFallback` helper (used by 2.14-2.16)
//   * Real `tallyVotes` helper (lifted from
//     `packages/modes/src/werewolf/phases.ts`, generalized)
//   * Initialization + state-derivation + standard infrastructure
//     (emit room:started/ended, mark complete/error)
//   * NO PHASE LOGIC — all non-terminal phases throw
//     `FatalError('not yet implemented')`. Real phases land in
//     2.14 (night), 2.15 (day, the load-bearing dayVote), 2.16
//     (triggered: hunter / sheriff / idiot).
//
// Different from roundtable / open-chat in three ways:
//   1. NO fixed turn count. Phase transitions drive the loop;
//      iteration count is bounded only by `MAX_PHASE_TRANSITIONS`.
//   2. STRUCTURED LLM OUTPUT for decisions (votes, witch action,
//      etc.) — uses `createGenerateObjectFn` from `llm-factory.ts`
//      with phase-specific Zod schemas. No mock under
//      WORKFLOW_TEST=1; werewolf validation is real game playthroughs
//      (per the pre-users feedback rule).
//   3. RICH GAME STATE. Werewolf needs roles, eliminations, witch
//      potions, guard-last-protected, sheriff badge, etc. Storing
//      this in `rooms.gameState` JSONB and re-reading at the start
//      of each phase iteration matches the legacy schema and avoids
//      threading state through every step input (Rule 6).
//
// Obeys all 8 rules of the durability contract
// (`docs/design/workflow-architecture.md` § 2026-04-29):
//
//   Rule 1 (idempotent step bodies)        — Each phase step writes
//                                             a deterministic
//                                             message id derived from
//                                             (phase, roomId, cycleId,
//                                             agentId). Combined with
//                                             events_message_id_uq
//                                             partial UNIQUE, retries
//                                             are no-op.
//   Rule 2 (seq computed inside step)      — getEventCount() at write
//                                             time inside each step.
//   Rule 3 (no Realtime in steps)          — no realtime imports.
//   Rule 4 (no setTimeout in workflow)     — workflow body uses no
//                                             timers; the phase loop
//                                             reads gameState and
//                                             dispatches. Day-vote
//                                             grace window (2.15)
//                                             uses the WDK `sleep`
//                                             primitive, not setTimeout.
//   Rule 5 (flow.onMessage as single MP)   — N/A. Each step writes
//                                             ONE event; that IS the
//                                             mutation. Phase
//                                             transitions explicitly
//                                             update gameState via
//                                             setGameState — that's
//                                             the only multi-write
//                                             site, and it's a single
//                                             step body so it's atomic
//                                             at the step boundary.
//   Rule 6 (scalar step inputs)            — phaseName + roomId +
//                                             agentId. Steps derive
//                                             history + game state
//                                             from DB.
//   Rule 7 (mode-namespaced hook tokens)   — werewolfDayVoteToken
//                                             format
//                                             `agora/room/<uuid>/mode/
//                                             werewolf-day-vote/night/
//                                             <n>/seat/<id>`. Used by
//                                             2.15.
//   Rule 8 (no module-level state)         — all persistence via DB.

import { FatalError } from 'workflow'
import {
  appendEvent,
  getEventCount,
  getEventsSince,
  getMessagesSince,
  getRoom,
  refreshMessageCount,
  refreshRoomTokenAggregates as bumpRoomTokenAggregates,
  setGameState,
  updateRoomStatus,
  type AgentInfo,
} from '../lib/room-store.js'
import {
  createGenerateFn,
  createGenerateObjectFn,
} from '../lib/llm-factory.js'
import { getFallback } from '@agora/modes'
import { resolvePricing, calculateCost } from '@agora/llm'
import type { FallbackAction } from '@agora/modes'
import {
  createDayVoteSchema,
  createGuardProtectSchema,
  createSeerCheckSchema,
  createWitchActionSchema,
  createWolfVoteSchema,
} from '@agora/modes'
import type {
  WerewolfAdvancedRules,
  WerewolfRole,
} from '@agora/modes'
import type {
  LLMProvider,
  Message,
  ModelConfig,
  PlatformEvent,
  TokenUsage,
} from '@agora/shared'

// Phase implementations live in sibling files to keep this file
// under the 800-line ceiling. The `runXxx` helpers are body-helpers
// (no `use step`/`use workflow` marker) — they inherit the workflow
// context from the caller and call shared step factories defined
// below.
import {
  runDawn,
  runGuardProtect,
  runSeerCheck,
  runWitchAction,
  runWolfDiscuss,
  runWolfVote,
} from './werewolf-night-phases.js'
import {
  runCheckWinAfterNight,
  runCheckWinAfterVote,
  runDayDiscuss,
  runDayVote,
} from './werewolf-day-phases.js'

// ── Public types ───────────────────────────────────────────

/**
 * Snapshot of one werewolf seat as the workflow receives it.
 *
 * The API route (2.17) is responsible for:
 *   - Computing role assignments deterministically (via
 *     `assignWerewolfRoles` from `@agora/modes`, seeded by `roomId`)
 *   - Composing each agent's role-specific systemPrompt (via
 *     `buildRoleSystemPrompt` from `@agora/modes`)
 *   - Setting `isHuman` from the team-membership snapshot
 *
 * Workflow consumes this fully-formed and never recomputes roles —
 * keeps role-assignment determinism out of the workflow body and
 * matches roundtable/open-chat where systemPrompt is pre-composed
 * by the API route.
 */
export interface WerewolfAgentSnapshot {
  readonly id: string
  readonly name: string
  readonly persona: string
  readonly systemPrompt: string
  readonly model: ModelConfig
  readonly role: WerewolfRole
  /** True if this seat is human-controlled. Day-vote + last-words pause for input. */
  readonly isHuman?: boolean
}

/**
 * Constant persona string written into every werewolf snapshot. The
 * persona field is decorative on werewolf seats — each agent has its
 * full role-aware systemPrompt; the LLM never reads this string. Kept
 * as a const so the create-time path (apps/web/app/api/rooms/werewolf/
 * route.ts) and the lobby-resolve path (apps/web/app/lib/lobby.ts)
 * share one source.
 */
export const WEREWOLF_AGENT_PERSONA = 'A player in the werewolf game'

export interface WerewolfWorkflowInput {
  /** UUID of a room already created via createRoom() with status='running'. */
  readonly roomId: string
  /** 6..12 agents, fully snapshot-formed (role + systemPrompt resolved by route). */
  readonly agents: readonly WerewolfAgentSnapshot[]
  /** Toggle advanced rules (guard, idiot, sheriff, lastWords). */
  readonly advancedRules: WerewolfAdvancedRules
  /**
   * Deterministic seed for any stochastic decisions inside the workflow.
   * Currently unused by the skeleton (role assignment is pre-resolved by
   * the route); reserved for phases that need randomness in 2.14+.
   */
  readonly seed: string
  /**
   * Display language for system messages emitted by phase steps —
   * "Dawn breaks", vote tallies, role reveals. The agents'
   * languageInstruction (which controls their LLM output) is baked
   * into systemPrompt at the route level; this `language` only
   * controls workflow-emitted UI strings. Default 'en' if omitted.
   */
  readonly language?: 'en' | 'zh'
}

export interface WerewolfWorkflowResult {
  readonly roomId: string
  readonly winner: 'village' | 'werewolves' | null
  readonly phaseTransitions: number
}

// ── Persisted state (rooms.gameState JSONB shape) ──────────
//
// Mirrors `WerewolfGameState` from `packages/modes/src/werewolf/
// types.ts`, plus a `currentPhase` field for the workflow body's
// dispatch loop and an `activeAgentIds` array (Set is not JSONB-
// friendly). All fields are JSON-serializable so a single
// setGameState write captures the whole snapshot.
//
// LOAD-BEARING SHAPE: phase-step bodies in werewolf-night-phases.ts
// (and 2.15 / 2.16) read this directly from rooms.gameState. A
// field rename here without coordinated updates silently corrupts
// state mid-game (the next phase reads `undefined` for the renamed
// field and behaves as if it were never set).

export interface WerewolfPersistedState {
  readonly currentPhase: string
  readonly roleMap: Readonly<Record<string, WerewolfRole>>
  readonly agentNames: Readonly<Record<string, string>>
  readonly eliminatedIds: readonly string[]
  readonly activeAgentIds: readonly string[]
  readonly lastNightKill: string | null
  readonly witchSaveUsed: boolean
  readonly witchPoisonUsed: boolean
  readonly witchPoisonTarget: string | null
  readonly witchUsedPotionTonight: boolean
  readonly seerResult: { readonly targetId: string; readonly isWerewolf: boolean } | null
  readonly nightNumber: number
  readonly hunterCanShoot: boolean
  readonly hunterPendingId: string | null
  readonly hunterShotTarget: string | null
  readonly guardProtectedId: string | null
  readonly guardLastProtectedId: string | null
  readonly idiotRevealedIds: readonly string[]
  readonly sheriffId: string | null
  readonly sheriffElected: boolean
  readonly pendingLastWordsIds: readonly string[]
  readonly winResult: 'village_wins' | 'werewolves_win' | null
  readonly advancedRules: WerewolfAdvancedRules
}

// ── Pure state-lookup helpers (used by phase steps) ────────
//
// All take a snapshot of WerewolfPersistedState and return derived
// information. They're pure (no I/O) so phase steps can call them
// inline after reading state once at step entry.

/** Alive agent ids in iteration-stable order (snapshot order). */
export function aliveIds(state: WerewolfPersistedState): readonly string[] {
  const eliminated = new Set(state.eliminatedIds)
  return state.activeAgentIds.filter((id) => !eliminated.has(id))
}

/** Alive agent ids of a specific role. */
export function aliveIdsByRole(
  state: WerewolfPersistedState,
  role: WerewolfRole,
): readonly string[] {
  return aliveIds(state).filter((id) => state.roleMap[id] === role)
}

/** Map of `agentName -> agentId`, restricted to *all* agents (alive or dead). */
export function nameToIdMap(state: WerewolfPersistedState): Map<string, string> {
  const m = new Map<string, string>()
  for (const [id, name] of Object.entries(state.agentNames)) {
    m.set(name, id)
  }
  return m
}

/** Names of all alive agents in iteration-stable order. */
export function allAliveNames(state: WerewolfPersistedState): string[] {
  return aliveIds(state).map((id) => state.agentNames[id] ?? id)
}

/** Names of alive non-werewolf agents (for wolf-vote target list). */
export function aliveNonWolfNames(state: WerewolfPersistedState): string[] {
  return aliveIds(state)
    .filter((id) => state.roleMap[id] !== 'werewolf')
    .map((id) => state.agentNames[id] ?? id)
}

/** Names of alive agents excluding `excludeId` (e.g. seer can't check self). */
export function aliveNamesExcluding(
  state: WerewolfPersistedState,
  excludeId: string,
): string[] {
  return aliveIds(state)
    .filter((id) => id !== excludeId)
    .map((id) => state.agentNames[id] ?? id)
}

/** Cycle id format used in deterministic message ids: `n1`, `d1`, etc. */
export function cycleId(nightNumber: number, isDay: boolean): string {
  return `${isDay ? 'd' : 'n'}${nightNumber}`
}

// ── Hook-token contract (used by 2.15 day-vote) ────────────
//
// Deterministic per (roomId, nightNumber, seatId) so external resumers
// (the human-input endpoint, test harness) compute the token without
// round-tripping the workflow run id. Format chosen so 2.18-future
// werewolf phases (script-kill etc.) can drop in `mode/werewolf-X`
// without colliding with this namespace.
//
// LOAD-BEARING: external resumers reconstruct this exact string from
// URL params and call resumeHook. A format change without coordinated
// callers silently drops human votes on the floor. Format-pinning
// test in the durability suite must match.

export function werewolfDayVoteToken(
  roomId: string,
  nightNumber: number,
  seatId: string,
): string {
  return `agora/room/${roomId}/mode/werewolf-day-vote/night/${nightNumber}/seat/${seatId}`
}

// Day-discuss is the SEQUENTIAL human-chat phase (vs. day-vote which
// runs voters in parallel). One token per (room, day-cycle, speaker)
// so the workflow can pause on the active speaker, the UI can show the
// chat input via the existing waitingForHuman breadcrumb, and a stale
// resumeHook from a previous day cycle can't accidentally resume the
// current one. nightNumber identifies the day cycle (dayDiscuss happens
// after night N, before night N+1).

export function werewolfDayDiscussToken(
  roomId: string,
  nightNumber: number,
  seatId: string,
): string {
  return `agora/room/${roomId}/mode/werewolf-day-discuss/night/${nightNumber}/seat/${seatId}`
}

// Human chat payload — what the /api/rooms/.../human-input endpoint
// passes to resumeHook for werewolf day-discuss. LOAD-BEARING:
// the endpoint constructs this exact shape; field rename here without
// coordinated endpoint updates silently drops human chat on the floor.

export interface HumanDayDiscussPayload {
  readonly text: string
}

// ── System message localization ────────────────────────────
//
// Strings emitted by phase steps to the chat (dawn announcement,
// vote tally, role reveal at elimination). Agents' LLM output
// language is controlled separately via systemPrompt; this only
// affects the workflow's own UI prose. Caller passes `language`
// in the workflow input (defaults to 'en').

export type WerewolfLanguage = 'en' | 'zh'

interface WerewolfStrings {
  readonly dawnDeath: (names: readonly string[]) => string
  readonly dawnPeaceful: string
  readonly voteCast: (target: string, reason: string) => string
  readonly votePeaceful: (tally: string) => string
  readonly voteEliminated: (tally: string, name: string, role: string) => string
  readonly voteIdiotReveal: (tally: string, name: string) => string
  readonly fallbackAbstain: string
  readonly humanTimeoutAbstain: string
  readonly roleLabel: (role: WerewolfRole) => string
}

const WEREWOLF_STRINGS: Record<WerewolfLanguage, WerewolfStrings> = {
  en: {
    dawnDeath: (names) =>
      `Dawn breaks. Last night, **${names.join(' and ')}** did not survive.`,
    dawnPeaceful: 'Dawn breaks. Everyone survived the night!',
    voteCast: (target, reason) =>
      reason ? `Votes for **${target}**: ${reason}` : `Votes for **${target}**`,
    votePeaceful: (tally) => `Vote: ${tally}. No majority — peaceful day.`,
    voteEliminated: (tally, name, role) =>
      `Vote: ${tally}. **${name}** eliminated. They were a **${role}**.`,
    voteIdiotReveal: (tally, name) =>
      `Vote: ${tally}. **${name}** was voted out — but reveals they are the **Village Idiot**! They survive but lose voting rights.`,
    fallbackAbstain: 'human seat — fallback abstain',
    humanTimeoutAbstain: '(human seat timed out after 45s — auto-abstain)',
    roleLabel: (role) => role,
  },
  zh: {
    dawnDeath: (names) =>
      `天亮了。昨晚 **${names.join(' 与 ')}** 没能挺过这一夜。`,
    dawnPeaceful: '天亮了。昨晚平安无事。',
    voteCast: (target, reason) =>
      reason ? `投给 **${target}**：${reason}` : `投给 **${target}**`,
    votePeaceful: (tally) => `投票：${tally}。无多数票 — 平安日。`,
    voteEliminated: (tally, name, role) =>
      `投票：${tally}。**${name}** 被票出。身份是 **${role}**。`,
    voteIdiotReveal: (tally, name) =>
      `投票：${tally}。**${name}** 被票出 — 翻出白痴牌！幸存但失去后续投票权。`,
    fallbackAbstain: '人类座位 — 默认弃票',
    humanTimeoutAbstain: '（人类座位 45 秒超时 — 自动弃票）',
    roleLabel: (role) => {
      const map: Record<WerewolfRole, string> = {
        werewolf: '狼人',
        villager: '村民',
        seer: '预言家',
        witch: '女巫',
        hunter: '猎人',
        guard: '守卫',
        idiot: '白痴',
      }
      return map[role] ?? role
    },
  },
}

export function werewolfStrings(language: WerewolfLanguage | undefined): WerewolfStrings {
  return WEREWOLF_STRINGS[language ?? 'en']
}

// ── Phase tags (terminal vs non-terminal) ──────────────────

const TERMINAL_PHASES = new Set<string>(['werewolvesWin', 'villageWins', 'gameEnded'])

function isTerminalPhase(phase: string | null): boolean {
  return phase !== null && TERMINAL_PHASES.has(phase)
}

// Defends against accidental infinite loops if a phase transition
// table is misconfigured (e.g., a cycle that doesn't decrement
// alive-count). Bound is generous: a 12-player game has at most
// ~12 days * ~10 phases/day = 120 transitions; 200 leaves slack.
const MAX_PHASE_TRANSITIONS = 200

// ── Workflow ───────────────────────────────────────────────

export async function werewolfWorkflow(
  input: WerewolfWorkflowInput,
): Promise<WerewolfWorkflowResult> {
  'use workflow'

  const { roomId, agents, advancedRules, seed } = input

  // Outer try/catch is the terminal-error guard (4.5d-2.4 pattern).
  // Any throw inside the body — validation, step exhaustion, invariant
  // violation — runs through markRoomError so the room row leaves
  // 'running' and gets a recoverable error message.
  try {
    if (typeof roomId !== 'string' || roomId.length === 0) {
      throw new FatalError('roomId must be a non-empty UUID string')
    }
    // roomId embeds in werewolfDayVoteToken; reject `/` so a malformed
    // input can't silently shift the token shape and collide with
    // another room's hook namespace (Rule 7 enforcement).
    if (roomId.includes('/')) {
      throw new FatalError('roomId must not contain "/"')
    }
    if (agents.length < 6 || agents.length > 12) {
      throw new FatalError('werewolf requires 6..12 agents')
    }
    if (typeof seed !== 'string' || seed.length === 0) {
      throw new FatalError('seed must be a non-empty string')
    }
    for (const a of agents) {
      if (!a.id || a.id.length === 0) throw new FatalError('agent.id required')
      if (!a.name || a.name.length === 0) {
        throw new FatalError(`agent ${a.id}: name required`)
      }
      if (!a.systemPrompt || a.systemPrompt.length === 0) {
        throw new FatalError(`agent ${a.id}: systemPrompt required`)
      }
      if (!a.role) throw new FatalError(`agent ${a.id}: role required`)
      // Defense-in-depth: workflows accept arbitrary JSON, not the
      // TypeScript-checked WerewolfAgentSnapshot.
      if (!a.isHuman && !a.model) {
        throw new FatalError(`agent ${a.id}: model required`)
      }
      if (!a.isHuman && !ALLOWED_PROVIDERS.includes(a.model.provider)) {
        throw new FatalError(`agent ${a.id}: bad provider "${a.model.provider}"`)
      }
      if (!a.isHuman && (!a.model.modelId || a.model.modelId.length === 0)) {
        throw new FatalError(`agent ${a.id}: model.modelId required`)
      }
    }

    await emitRoomStarted({ roomId })
    await initializeGameState({ roomId, agents, advancedRules })

    // Phase loop. Each iteration:
    //   1. Read derived state (currentPhase + WerewolfGameState) from
    //      gameState JSONB.
    //   2. If terminal, exit the loop.
    //   3. Dispatch on currentPhase to the matching phase step
    //      (implementations land in 2.14-2.16). Each phase step is
    //      responsible for: running its turns, persisting messages,
    //      updating gameState (including next currentPhase via the
    //      transition table).
    //
    // The `iter` counter is purely a safety net against transition-
    // table misconfiguration; it's not load-bearing for correctness
    // (phase transitions are deterministic on game state).
    let iter = 0
    let currentPhase: string | null = null
    while (iter++ < MAX_PHASE_TRANSITIONS) {
      const derived = await deriveWerewolfState({ roomId })
      currentPhase = derived.currentPhase

      if (isTerminalPhase(currentPhase)) break

      // Dispatch shell. 2.14-2.16 fill in case branches.
      // Each branch SHOULD: run the phase, persist any agent
      // decisions/messages, mutate gameState (set next currentPhase),
      // and return cleanly so the next iteration picks up the new
      // phase.
      //
      // Phase ownership across upcoming sub-phases:
      //   2.14 NIGHT      — guardProtect, wolfDiscuss, wolfVote,
      //                     witchAction, seerCheck, dawn
      //   2.15 DAY        — sheriffGate, sheriffElection, dayDiscuss,
      //                     dayVote, lastWordsDawn, lastWordsVote
      //   2.16 TRIGGERED  — hunterShoot, hunterShootAfterVote,
      //                     sheriffTransferNight, sheriffTransferVote,
      //                     checkWinAfterNight, checkWinAfterVote
      // Cast derived state to the typed shape. initializeGameState
      // populated all WerewolfPersistedState fields; reading
      // gameState back returns Record<string, unknown> from the DB
      // driver but the SHAPE matches.
      const persistedState = derived.state as unknown as WerewolfPersistedState

      const lang: WerewolfLanguage = input.language ?? 'en'
      switch (currentPhase) {
        case 'guardProtect':
          await runGuardProtect(roomId, agents, persistedState, lang)
          break
        case 'wolfDiscuss':
          await runWolfDiscuss(roomId, agents, persistedState, lang)
          break
        case 'wolfVote':
          await runWolfVote(roomId, agents, persistedState, lang)
          break
        case 'witchAction':
          await runWitchAction(roomId, agents, persistedState, lang)
          break
        case 'seerCheck':
          await runSeerCheck(roomId, agents, persistedState, lang)
          break
        case 'dawn':
          await runDawn(roomId, agents, persistedState, lang)
          break
        case 'dayDiscuss':
          await runDayDiscuss(roomId, agents, persistedState, lang)
          break
        case 'dayVote':
          await runDayVote(roomId, agents, persistedState, lang)
          break
        case 'checkWinAfterNight':
          await runCheckWinAfterNight(roomId, agents, persistedState, lang)
          break
        case 'checkWinAfterVote':
          await runCheckWinAfterVote(roomId, agents, persistedState, lang)
          break
        // Remaining phases — implementations land in 2.16 (triggered:
        // hunterShoot*/sheriffTransfer*/sheriffElection/lastWords*).
        case 'sheriffGate':
        case 'sheriffElection':
        case 'lastWordsDawn':
        case 'lastWordsVote':
        case 'hunterShoot':
        case 'hunterShootAfterVote':
        case 'sheriffTransferNight':
        case 'sheriffTransferVote':
          // FatalError because phase logic is deterministic on game
          // state — retry won't change the outcome. Signals "code
          // not yet shipped, not transient".
          throw new FatalError(
            `werewolfWorkflow: phase "${currentPhase}" not yet implemented. ` +
              'Implementations land in 4.5d-2.16 (triggered/advanced phases).',
          )
        case null:
          throw new FatalError(
            'werewolfWorkflow: gameState.currentPhase missing — ' +
              'initializeGameState must set it before the phase loop runs.',
          )
        default:
          throw new FatalError(
            `werewolfWorkflow: unknown phase "${currentPhase}" — ` +
              'transition table or initializeGameState is misconfigured.',
          )
      }
    }

    if (iter >= MAX_PHASE_TRANSITIONS) {
      throw new FatalError(
        `werewolfWorkflow: exceeded ${MAX_PHASE_TRANSITIONS} phase transitions ` +
          `(last phase: "${currentPhase}"). Suspect a transition cycle.`,
      )
    }

    await emitRoomEnded({ roomId })
    await markRoomComplete({ roomId })

    return {
      roomId,
      winner: phaseToWinner(currentPhase),
      phaseTransitions: iter,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await markRoomError({ roomId, message })
    } catch (markErr) {
      console.error(
        `[werewolfWorkflow] markRoomError failed for room ${roomId}; ` +
          `room row stays at 'running'. Original error: ${message}`,
        markErr,
      )
      if (error instanceof Error) {
        ;(error as Error & { cause?: unknown }).cause = markErr
      }
    }
    throw error
  }
}

const ALLOWED_PROVIDERS: readonly LLMProvider[] = [
  'anthropic',
  'openai',
  'google',
  'deepseek',
]

function phaseToWinner(phase: string | null): 'village' | 'werewolves' | null {
  if (phase === 'villageWins') return 'village'
  if (phase === 'werewolvesWin') return 'werewolves'
  return null
}

// ── Helpers (will be exercised by 2.14-2.16) ───────────────

/**
 * Tally a map of (voterId -> decision) into a winner under werewolf
 * voting rules. Lifted (and generalized) from
 * `packages/modes/src/werewolf/phases.ts:tallyVotes`. Differences:
 *   - Caller passes in nameToId (a Map) instead of reading the
 *     legacy GameState shape — keeps this helper pure / decoupled
 *     from `@agora/core`.
 *   - Caller passes `field` (default `'target'`) so it works for
 *     vote, sheriff vote, hunter shoot, etc.
 *   - Caller passes optional `weights` (e.g. sheriff 1.5x).
 *
 * Returns null winner on tie OR when `skip`/`none` count >= max
 * weighted votes.
 */
export interface TallyResult {
  readonly winnerId: string | null
  readonly tally: ReadonlyMap<string, number>
  readonly skipCount: number
}

export function tallyVotes(
  decisions: ReadonlyMap<string, unknown>,
  nameToId: ReadonlyMap<string, string>,
  options: { field?: string; weights?: ReadonlyMap<string, number> } = {},
): TallyResult {
  const field = options.field ?? 'target'
  const weights = options.weights
  const tally = new Map<string, number>()
  let skipCount = 0

  for (const [voterId, decision] of decisions) {
    const d = decision as Record<string, unknown>
    const name = d[field] as string | undefined
    if (name === undefined || name === 'skip' || name === 'none') {
      skipCount++
      continue
    }
    const targetId = nameToId.get(name)
    if (targetId === undefined) continue // malformed — skip silently
    const w = weights?.get(voterId) ?? 1
    tally.set(targetId, (tally.get(targetId) ?? 0) + w)
  }

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

  // Tie OR skip plurality wins → no winner. Same rule as legacy
  // werewolf phases.ts, kept identical so day-vote semantics don't
  // shift between runtimes.
  if (maxIds.length !== 1 || maxVotes <= skipCount) {
    return { winnerId: null, tally, skipCount }
  }
  return { winnerId: maxIds[0]!, tally, skipCount }
}

/**
 * Look up the fallback policy for a werewolf phase turn. Thin wrapper
 * around `getFallback('werewolf', turnId)` — adds the mode-id so
 * callers don't repeat themselves and surfaces a clean error when
 * a phase is missing a registered policy (bug, not data).
 *
 * Phase-specific adapters (used by 2.14-2.16) call this and then
 * shape the FallbackAction into a vote-shape payload appropriate
 * for the phase. Use `assertNeverFallback` on the `default` arm of
 * any switch over `action.kind` to get a compile-time error when
 * a new FallbackAction kind is added.
 */
export function applyFallback(turnId: WerewolfFallbackTurn): FallbackAction {
  const action = getFallback('werewolf', turnId)
  if (!action) {
    throw new Error(
      `applyFallback: no fallback policy registered for werewolf:${turnId}. ` +
        'Update packages/modes/src/fallback-policies.ts.',
    )
  }
  return action
}

// Pinned to the keys actually present in the werewolf registry as of
// 4.5d-2.13. If you add a new phase here, also add to the registry
// in fallback-policies.ts. assertNeverFallback (used at the consumer
// switch-default) handles new FallbackAction *kinds*; this type
// handles new turnIds.
export type WerewolfFallbackTurn =
  | 'speak'
  | 'day-vote'
  | 'last-words'
  | 'sheriff-election'
  | 'sheriff-transfer'
  | 'wolf-speak'
  | 'wolf-vote'
  | 'witch-action'
  | 'seer-check'
  | 'guard-protect'
  | 'hunter-shoot'

// ── Steps ──────────────────────────────────────────────────

interface EmitRoomStartedInput {
  readonly roomId: string
}

async function emitRoomStarted(input: EmitRoomStartedInput): Promise<void> {
  'use step'
  const existingCount = await getEventCount(input.roomId)
  if (existingCount > 0) return

  const event: PlatformEvent = { type: 'room:started', roomId: input.roomId }
  await appendEvent(input.roomId, 0, event)
}

interface InitializeGameStateInput {
  readonly roomId: string
  readonly agents: readonly WerewolfAgentSnapshot[]
  readonly advancedRules: WerewolfAdvancedRules
}

/**
 * Build and persist the initial WerewolfGameState. Idempotent:
 * if `gameState.currentPhase` is already set, this is a no-op
 * (workflow restart from seeded state).
 *
 * The initial currentPhase depends on advanced rules:
 *   - guard enabled → 'guardProtect' (night entry)
 *   - else          → 'wolfDiscuss'
 *
 * Sheriff election fires Day 1, but Day 1 is reached via the
 * normal night-cycle exit, not at init time.
 */
async function initializeGameState(
  input: InitializeGameStateInput,
): Promise<void> {
  'use step'
  const { roomId, agents, advancedRules } = input

  const room = await getRoom(roomId)
  if (!room) {
    throw new FatalError(`initializeGameState: room ${roomId} not found`)
  }
  const existing = (room.gameState ?? {}) as Record<string, unknown>
  if (typeof existing['currentPhase'] === 'string') {
    // Already initialized (restart from seeded state) — leave alone.
    return
  }

  const roleMap: Record<string, WerewolfRole> = {}
  const agentNames: Record<string, string> = {}
  for (const a of agents) {
    roleMap[a.id] = a.role
    agentNames[a.id] = a.name
  }

  const initialPhase = advancedRules.guard ? 'guardProtect' : 'wolfDiscuss'

  // The schema mirrors `WerewolfGameState` from
  // `packages/modes/src/werewolf/types.ts`, plus a `currentPhase`
  // field for the workflow body's dispatch loop. Storing currentPhase
  // in gameState (vs. the rooms.currentPhase column the legacy path
  // uses) keeps the WDK path self-contained — when 2.18 deletes the
  // legacy path, the rooms.currentPhase column can go too.
  await setGameState(roomId, {
    ...existing,
    currentPhase: initialPhase,
    roleMap,
    agentNames,
    eliminatedIds: [],
    activeAgentIds: agents.map((a) => a.id),
    lastNightKill: null,
    witchSaveUsed: false,
    witchPoisonUsed: false,
    witchPoisonTarget: null,
    witchUsedPotionTonight: false,
    seerResult: null,
    nightNumber: 1,
    hunterCanShoot: false,
    hunterPendingId: null,
    hunterShotTarget: null,
    guardProtectedId: null,
    guardLastProtectedId: null,
    idiotRevealedIds: [],
    sheriffId: null,
    sheriffElected: false,
    pendingLastWordsIds: [],
    winResult: null,
    advancedRules,
  })
}

interface DeriveWerewolfStateInput {
  readonly roomId: string
}

/**
 * Read derived state from `rooms.gameState`. Returns the full state
 * blob plus `currentPhase` for the dispatch switch.
 *
 * Reads gameState fresh each phase iteration. Per the design memo,
 * werewolf state is too rich (witch potions, guard tracking, sheriff
 * badge, idiot reveals) to derive purely from the events log — the
 * legacy path persists snapshot to gameState column and we mirror
 * that here. Phase steps in 2.14-2.16 mutate gameState via setGameState
 * (read-merge-write within a single step body for atomicity).
 */
async function deriveWerewolfState(
  input: DeriveWerewolfStateInput,
): Promise<{
  readonly currentPhase: string | null
  readonly state: Record<string, unknown>
}> {
  'use step'
  const room = await getRoom(input.roomId)
  if (!room) {
    throw new FatalError(`deriveWerewolfState: room ${input.roomId} not found`)
  }
  const state = (room.gameState ?? {}) as Record<string, unknown>
  const currentPhase =
    typeof state['currentPhase'] === 'string' ? (state['currentPhase'] as string) : null
  return { currentPhase, state }
}

// ── Decision-generation step (used by 2.14-2.16) ───────────

/**
 * Werewolf phase decision specs. Pure POJO — WDK's step-input
 * serialization (devalue) requires plain data, no Zod schemas
 * (their closures cannot be serialized across the queue boundary).
 *
 * Each variant carries the scalar params its schema factory needs.
 * The step body switches on `kind` to call the matching factory
 * INSIDE the step (so the schema lives in step-local memory and
 * never crosses a serialization boundary). Discovered the hard way
 * via 4.5d-2.17 validation: passing `schema: ZodSchema` as a step
 * input wedged the workflow at attempt 42 with a serialization
 * error.
 *
 * Adding a new decision kind: extend this union, add a switch arm
 * in `buildDecisionSchema`, and call sites pass the new shape.
 */
export type WerewolfDecisionSpec =
  | { readonly kind: 'wolfVote'; readonly targets: readonly string[] }
  | { readonly kind: 'dayVote'; readonly targets: readonly string[] }
  | { readonly kind: 'guardProtect'; readonly targets: readonly string[] }
  | { readonly kind: 'seerCheck'; readonly targets: readonly string[] }
  | {
      readonly kind: 'witchAction'
      readonly canSave: boolean
      readonly canPoison: boolean
      readonly alivePlayers: readonly string[]
    }

function buildDecisionSchema(spec: WerewolfDecisionSpec) {
  switch (spec.kind) {
    case 'wolfVote':
      return createWolfVoteSchema([...spec.targets])
    case 'dayVote':
      return createDayVoteSchema([...spec.targets])
    case 'guardProtect':
      return createGuardProtectSchema([...spec.targets])
    case 'seerCheck':
      return createSeerCheckSchema([...spec.targets])
    case 'witchAction':
      return createWitchActionSchema(
        spec.canSave,
        spec.canPoison,
        [...spec.alivePlayers],
      )
  }
}

export interface GenerateAgentDecisionInput {
  readonly roomId: string
  readonly agentId: string
  readonly systemPrompt: string
  readonly provider: LLMProvider
  readonly modelId: string
  readonly maxTokens: number
  readonly instruction: string
  /**
   * Phase-specific filter for which prior messages this agent should
   * see. Werewolf phases are channeled (wolves see wolf-chat, seer
   * sees seer-result, etc.), but the workflow consumes a flat events
   * log. Caller passes the channel id(s) to filter on; null means
   * 'all messages this agent has access to'.
   */
  readonly channelId: string | null
  /**
   * POJO spec describing the structured-output schema. The step
   * resolves this to a ZodSchema internally — see WerewolfDecisionSpec.
   */
  readonly decision: WerewolfDecisionSpec
}

export interface GenerateAgentDecisionResult {
  readonly object: unknown
  readonly usage: TokenUsage
}

/**
 * Workflow step that generates a structured decision via Vercel AI
 * SDK's `generateObject`. Used by phase steps (vote, witch action,
 * seer check, ...).
 *
 * Step inputs are pure POJOs (Rule 6). The schema is reconstructed
 * inside the step body from the `decision` discriminated union —
 * see WerewolfDecisionSpec for why.
 */
export async function generateAgentDecision(
  input: GenerateAgentDecisionInput,
): Promise<GenerateAgentDecisionResult> {
  'use step'

  const {
    roomId,
    agentId,
    systemPrompt,
    provider,
    modelId,
    maxTokens,
    instruction,
    channelId,
    decision,
  } = input

  const schema = buildDecisionSchema(decision)

  // Read prior messages from DB. If channelId is set, filter to
  // messages this agent should see (e.g. wolves see wolf-chat).
  const allMessages: Message[] = await getMessagesSince(roomId, 0)
  const visible = channelId
    ? allMessages.filter((m: Message) => m.channelId === channelId || m.channelId === 'main')
    : allMessages

  // History role tagging matches roundtable / open-chat:
  //   own messages -> 'assistant' (raw, no name prefix)
  //   others' messages -> 'user' with `[name]:` prefix
  // (Pattern aligned in 4.5d-2.7 across runtimes; werewolf adopts the
  // same convention so structured-output prompts get the same context
  // shape as text generation.)
  const history = visible.map((m: Message) => {
    if (m.senderId === agentId) {
      return { role: 'assistant' as const, content: m.content }
    }
    return { role: 'user' as const, content: `[${m.senderName}]: ${m.content}` }
  })

  const model: ModelConfig = { provider, modelId, maxTokens }
  const generateFn = createGenerateObjectFn(model)
  const result = await generateFn(systemPrompt, history, schema, instruction)

  return { object: result.object, usage: result.usage }
}

// ── Shared phase steps (used by night / day / triggered) ───
//
// generateAgentReply: text-only LLM step (free-form chat phases —
// wolfDiscuss, dayDiscuss, lastWords). Mirrors roundtable's pattern;
// each turn is its own step so WDK caches the LLM result and a
// retry of the persistence step doesn't re-pay for the LLM call.

export interface GenerateAgentReplyInput {
  readonly roomId: string
  readonly agentId: string
  readonly systemPrompt: string
  readonly provider: LLMProvider
  readonly modelId: string
  readonly maxTokens: number
  readonly instruction?: string
  /** See generateAgentDecision.channelId for visibility-filter rationale. */
  readonly channelId: string | null
}

export interface GenerateAgentReplyResult {
  readonly content: string
  readonly usage: TokenUsage
}

export async function generateAgentReply(
  input: GenerateAgentReplyInput,
): Promise<GenerateAgentReplyResult> {
  'use step'

  const {
    roomId,
    agentId,
    systemPrompt,
    provider,
    modelId,
    maxTokens,
    instruction,
    channelId,
  } = input

  const allMessages: Message[] = await getMessagesSince(roomId, 0)
  const visible = channelId
    ? allMessages.filter(
        (m: Message) => m.channelId === channelId || m.channelId === 'main',
      )
    : allMessages

  // History role tagging matches generateAgentDecision (and the
  // 4.5d-2.7 alignment): own -> 'assistant' raw, others -> 'user'
  // with `[name]:` prefix.
  const history = visible.map((m: Message) => {
    if (m.senderId === agentId) {
      return { role: 'assistant' as const, content: m.content }
    }
    return { role: 'user' as const, content: `[${m.senderName}]: ${m.content}` }
  })

  const model: ModelConfig = { provider, modelId, maxTokens }
  const generateFn = createGenerateFn(model)
  const result = await generateFn(systemPrompt, history, instruction)

  return { content: result.content, usage: result.usage }
}

// persistAgentMessage: writes a message:created event with optional
// decision metadata (for structured phases). The deterministic
// message id derives from (phaseTag, roomId, cycleId, agentId) —
// combined with events_message_id_uq partial UNIQUE, retries are
// no-op. `decision` (if non-null) is JSON-serialized and stored in
// metadata so downstream phase outcome steps can read decisions
// from the event log when needed (e.g. last-words narrative recap).

export interface PersistAgentMessageInput {
  readonly roomId: string
  readonly agentId: string
  readonly agentName: string
  readonly content: string
  readonly channelId: string
  readonly phaseTag: string
  readonly cycleId: string
  /** Structured decision (e.g. WolfVoteSchema output). Null for chat phases. */
  readonly decision: Record<string, unknown> | null
}

export async function persistAgentMessage(
  input: PersistAgentMessageInput,
): Promise<string> {
  'use step'

  const { roomId, agentId, agentName, content, channelId, phaseTag, cycleId, decision } =
    input

  const seq = await getEventCount(roomId)
  const messageId = deriveWerewolfMessageId(phaseTag, roomId, cycleId, agentId)

  const message: Message = {
    id: messageId,
    roomId,
    senderId: agentId,
    senderName: agentName,
    content,
    channelId,
    timestamp: Date.now(),
    metadata: {
      phaseTag,
      cycleId,
      ...(decision !== null ? { decision } : {}),
    },
  }

  const event: PlatformEvent = { type: 'message:created', message }
  await appendEvent(roomId, seq, event)
  await refreshMessageCount(roomId)

  return messageId
}

// emitPhaseAnnouncement: writes a system-style message:created with
// no senderId (the legacy uses Announcement objects in flow custom
// state; for WDK we emit a message:created so the live UI renders
// it inline without a special channel). Idempotent via deterministic
// id keyed on (phaseTag, cycleId, slot) — slot is a hand-picked tag
// per call site so two announcements in the same phase don't collide.

export interface EmitPhaseAnnouncementInput {
  readonly roomId: string
  readonly channelId: string
  readonly phaseTag: string
  readonly cycleId: string
  /** Discriminator within the phase — e.g. 'tally', 'death', 'kicker'. */
  readonly slot: string
  readonly content: string
}

export async function emitPhaseAnnouncement(
  input: EmitPhaseAnnouncementInput,
): Promise<void> {
  'use step'

  const { roomId, channelId, phaseTag, cycleId, slot, content } = input

  const seq = await getEventCount(roomId)
  const messageId = `ww-${phaseTag}-${roomId}-${cycleId}-announce-${slot}`

  const message: Message = {
    id: messageId,
    roomId,
    // Empty senderId / senderName signals "system announcement" to
    // the UI. The room view renders these as italicized notices.
    senderId: '',
    senderName: '',
    content,
    channelId,
    timestamp: Date.now(),
    metadata: { phaseTag, cycleId, slot, system: true },
  }

  const event: PlatformEvent = { type: 'message:created', message }
  await appendEvent(roomId, seq, event)
  await refreshMessageCount(roomId)
}

// recordTurnUsage: token-cost tracking. Same shape as roundtable +
// open-chat, since werewolf agents are LLM seats with identical
// pricing semantics. Idempotent under both standard step retry AND
// delivery-failure-after-success retry, via the events_token_message
// _id_uq partial UNIQUE index (4.5d-2.6).

export interface RecordTurnUsageInput {
  readonly roomId: string
  readonly agentId: string
  readonly messageId: string
  readonly provider: LLMProvider
  readonly modelId: string
  readonly usage: TokenUsage
}

export async function recordTurnUsage(input: RecordTurnUsageInput): Promise<void> {
  'use step'

  const { roomId, agentId, messageId, provider, modelId, usage } = input

  const pricing = await resolvePricing(provider, modelId)
  const cost = calculateCost(usage, pricing)

  const seq = await getEventCount(roomId)
  const event: PlatformEvent = {
    type: 'token:recorded',
    roomId,
    agentId,
    messageId,
    provider,
    modelId,
    usage,
    cost,
  }
  await appendEvent(roomId, seq, event)
  await bumpRoomTokenAggregates(roomId)
}

// transitionPhase: atomic step that advances gameState.currentPhase
// (and optionally merges in additional state mutations). The
// per-phase outcome steps in werewolf-night-phases.ts call this as
// their last operation. Read-merge-write inside one step body keeps
// the transition atomic at the step boundary.

export interface TransitionPhaseInput {
  readonly roomId: string
  readonly nextPhase: string
  /**
   * Additional fields to merge into gameState alongside the phase
   * transition. Use this to bundle phase outcomes (e.g.
   * `{ lastNightKill: 'agent-X' }`) with the transition so the
   * write is atomic — a crash between separate setGameState calls
   * could leave currentPhase advanced but the outcome unrecorded.
   */
  readonly stateMerge: Readonly<Record<string, unknown>>
}

export async function transitionPhase(input: TransitionPhaseInput): Promise<void> {
  'use step'

  const { roomId, nextPhase, stateMerge } = input

  const room = await getRoom(roomId)
  if (!room) {
    throw new FatalError(`transitionPhase: room ${roomId} not found`)
  }
  const existing = (room.gameState ?? {}) as Record<string, unknown>

  await setGameState(roomId, {
    ...existing,
    ...stateMerge,
    currentPhase: nextPhase,
  })
}

// ── Standard infrastructure steps ──────────────────────────

interface EmitRoomEndedInput {
  readonly roomId: string
}

async function emitRoomEnded(input: EmitRoomEndedInput): Promise<void> {
  'use step'
  const events = await getEventsSince(input.roomId, -1)
  const alreadyEnded = events.some((e) => e.event.type === 'room:ended')
  if (alreadyEnded) return

  const seq = await getEventCount(input.roomId)
  const event: PlatformEvent = { type: 'room:ended', roomId: input.roomId }
  await appendEvent(input.roomId, seq, event)
}

interface MarkRoomCompleteInput {
  readonly roomId: string
}

async function markRoomComplete(input: MarkRoomCompleteInput): Promise<void> {
  'use step'
  await updateRoomStatus(input.roomId, 'completed')
}

interface MarkRoomErrorInput {
  readonly roomId: string
  readonly message: string
}

async function markRoomError(input: MarkRoomErrorInput): Promise<void> {
  'use step'
  // Same idempotency + sustained-DB-outage semantics as the other two
  // workflows. See roundtable-workflow.ts for the full rationale.
  await updateRoomStatus(input.roomId, 'error', input.message)
}

// ── Werewolf-human pause / resume (sequential phases) ──────
//
// Mirror of open-chat's markWaitingForHuman / markRunningAgain pattern,
// scoped for werewolf's sequential human phases (dayDiscuss, lastWords,
// future wolfDiscuss). Day-vote does NOT use these — votes collect
// in parallel, room stays 'running' across the whole vote phase.
//
// Why werewolf needs its own copy: gameState shape differs from
// open-chat (no waitingForTurnIdx — we use nightNumber + speaker as
// the cycle key in the hook token). And the runtime breadcrumb the
// human-input endpoint reads is `gameState.waitingForHuman` (matches
// HumanPlayBar's existing isMyTurn check) — keeping that shape
// shared lets the existing UI panel light up without changes.
//
// ORDERING INVARIANT (same rationale as open-chat):
// setGameState BEFORE updateRoomStatus. The endpoint validates
// `room.status === 'waiting'` first, then reads gameState.waitingForHuman.
// Reversing opens a window where status='waiting' is observable but
// the breadcrumb hasn't committed; endpoint would 403 on missing
// waitingForHuman.
//
// IDEMPOTENT: replay re-runs the read-merge with the same input —
// same output, setGameState overwrites identical content,
// updateRoomStatus is idempotent.

interface MarkWaitingForWerewolfHumanInput {
  readonly roomId: string
  readonly agentId: string
  /** Phase the human is being prompted in — used in the waiting hint. */
  readonly phaseTag: string
}

export async function markWaitingForWerewolfHuman(
  input: MarkWaitingForWerewolfHumanInput,
): Promise<void> {
  'use step'
  const { roomId, agentId, phaseTag } = input

  const room = await getRoom(roomId)
  if (!room) {
    throw new FatalError(`markWaitingForWerewolfHuman: room ${roomId} not found`)
  }
  const existing = (room.gameState ?? {}) as Record<string, unknown>

  await setGameState(roomId, {
    ...existing,
    waitingForHuman: agentId,
    waitingForPhaseTag: phaseTag,
    waitingSince: Date.now(),
  })
  await updateRoomStatus(roomId, 'waiting')
}

interface MarkRunningAgainForWerewolfInput {
  readonly roomId: string
}

export async function markRunningAgainForWerewolf(
  input: MarkRunningAgainForWerewolfInput,
): Promise<void> {
  'use step'
  const { roomId } = input

  const room = await getRoom(roomId)
  if (!room) {
    throw new FatalError(`markRunningAgainForWerewolf: room ${roomId} not found`)
  }
  const existing = (room.gameState ?? {}) as Record<string, unknown>
  const {
    waitingForHuman: _h,
    waitingForPhaseTag: _p,
    waitingSince: _s,
    ...preserved
  } = existing
  void _h
  void _p
  void _s
  await setGameState(roomId, preserved)
  await updateRoomStatus(roomId, 'running')
}

// ── Helpers (compile-time consumers) ───────────────────────

/**
 * Derive a deterministic messageId for a werewolf event.
 *
 * Format: `ww-${phaseTag}-${roomId}-${cycleId}-${agentId}` where:
 *   - `ww-` namespaces werewolf events; prevents collision with
 *     `rt-` (roundtable) and `oc-` (open-chat) on
 *     events_message_id_uq.
 *   - `phaseTag` is a short phase identifier chosen by the calling
 *     phase step (e.g. `wd` for day-vote, `wv` for wolf-vote, `wa`
 *     for witch-action). 2.14-2.16 nail down the per-phase tags.
 *   - `cycleId` is e.g. `n1` for night 1, `d1` for day 1; the
 *     calling phase step constructs it from gameState.nightNumber.
 *   - `agentId` is the seat's UUID.
 *
 * INPUT DOMAIN (callers must satisfy):
 *   - `roomId` and `agentId` MUST be UUIDs.
 *   - `phaseTag` MUST NOT contain `-` (it's a literal separator;
 *     dashes inside the tag would shift the parse boundary).
 *
 * Synthetic / test inputs that break these constraints CAN collide.
 * If the format ever changes, you MUST also reconcile any existing
 * data that may have legacy ids — and update format-pinning tests.
 */
export function deriveWerewolfMessageId(
  phaseTag: string,
  roomId: string,
  cycleId: string,
  agentId: string,
): string {
  return `ww-${phaseTag}-${roomId}-${cycleId}-${agentId}`
}

/**
 * Build a snapshot from an `AgentInfo` row + composed system prompt
 * + role + isHuman flag. Used by the API route (2.17) when starting
 * a workflow run.
 *
 * Caller is responsible for:
 *   - Composing systemPrompt via `buildRoleSystemPrompt` from
 *     `@agora/modes` (which embeds the role's strategic guidance).
 *   - Resolving roles via `assignWerewolfRoles` from `@agora/modes`
 *     (deterministic on roomId-as-seed).
 *   - Setting `isHuman` from team membership.
 */
export function toWerewolfAgentSnapshot(
  info: AgentInfo,
  systemPrompt: string,
  role: WerewolfRole,
): WerewolfAgentSnapshot {
  if (!info.persona) throw new Error(`agent ${info.id} missing persona`)
  return {
    id: info.id,
    name: info.name,
    persona: info.persona,
    systemPrompt,
    role,
    model: {
      provider: info.provider as LLMProvider,
      modelId: info.model,
      maxTokens:
        typeof info.style?.['maxTokens'] === 'number'
          ? (info.style['maxTokens'] as number)
          : 1500,
    },
    isHuman: info.isHuman === true,
  }
}
