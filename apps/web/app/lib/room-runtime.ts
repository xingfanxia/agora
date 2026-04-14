// ============================================================
// Room runtime — Phase 4.5a durable advance loop
// ============================================================
//
// advanceRoom(roomId) runs ONE phase of a persisted room and returns.
// Each call:
//   1. loads DB state (roomRow, event count, gameState snapshot)
//   2. rebuilds the in-memory runtime via the deterministic factory
//      (same roomId seed → identical agentIds + roleMap)
//   3. replays prior message events into agents so their chat history
//      matches the original session
//   4. wires eventBus → DB persistence starting at seq=eventCount
//   5. emits room:started on the first tick
//   6. runs room.runUntilPhaseBoundary until phase transitions or game
//      completes
//   7. snapshots gameState + updates status
//   8. returns AdvanceResult
//
// Idempotency: appendEvent uses ON CONFLICT DO NOTHING, so a lost race
// between inline-self-invoke and pg_cron does not produce duplicate
// events — the loser writes nothing. Determinism guarantees both ticks
// would have computed the identical events given the identical input
// state.

import {
  StateMachineFlow,
  TokenAccountant,
  type GenerateFn,
  type GenerateObjectFn,
} from '@agora/core'
import {
  createGenerateFn,
  createGenerateObjectFn,
  buildPricingMap,
  createCostCalculator,
} from '@agora/llm'
import { createWerewolf, type WerewolfAgentConfig, type WerewolfAdvancedRules } from '@agora/modes'
import type { LLMProvider, Message, ModelConfig } from '@agora/shared'
import {
  disposeRuntime,
  registerRuntime,
} from './runtime-registry.js'
import {
  flushRuntimePending,
  wireEventPersistence,
  wireGameStateSnapshots,
} from './persist-runtime.js'
import {
  getEventsSince,
  getEventCount,
  getRoom,
  setGameState,
  updateRoomStatus,
  type AgentInfo,
} from './room-store.js'
import { buildLanguageDirective } from './language.js'

const _createGenFn: (model: ModelConfig) => GenerateFn = createGenerateFn
const _createObjFn: (model: ModelConfig) => GenerateObjectFn = (m) =>
  createGenerateObjectFn(m) as unknown as GenerateObjectFn

export type AdvanceResult =
  | { kind: 'continue' }
  | { kind: 'complete'; result: 'village_wins' | 'werewolves_win' | null }
  | { kind: 'error'; message: string }

interface PlayerInput {
  name: string
  model: string
  provider?: LLMProvider
}

interface WerewolfRoomConfig {
  players: PlayerInput[]
  advancedRules?: WerewolfAdvancedRules
  language?: 'en' | 'zh'
}

function resolveProvider(modelId: string): LLMProvider {
  if (modelId.startsWith('claude')) return 'anthropic'
  if (modelId.startsWith('gpt')) return 'openai'
  if (modelId.startsWith('gemini')) return 'google'
  if (modelId.startsWith('deepseek')) return 'deepseek'
  throw new Error(`Unknown model: ${modelId}`)
}

export async function advanceRoom(roomId: string): Promise<AdvanceResult> {
  const roomRow = await getRoom(roomId)
  if (!roomRow) return { kind: 'error', message: `Room not found: ${roomId}` }

  if (roomRow.status === 'completed') {
    const winResult =
      (roomRow.gameState as { winResult?: 'village_wins' | 'werewolves_win' | null } | null)
        ?.winResult ?? null
    return { kind: 'complete', result: winResult }
  }
  if (roomRow.status === 'error') {
    return { kind: 'error', message: roomRow.errorMessage ?? 'Room in error state' }
  }

  if (roomRow.modeId !== 'werewolf') {
    // Roundtable durable advance + other modes are follow-up work; today
    // the only mode that actually hits the 5-min wall is werewolf.
    return {
      kind: 'error',
      message: `advance not yet implemented for mode: ${roomRow.modeId}`,
    }
  }

  return advanceWerewolfRoom(roomRow)
}

// ── Werewolf advance ───────────────────────────────────────

async function advanceWerewolfRoom(
  roomRow: NonNullable<Awaited<ReturnType<typeof getRoom>>>,
): Promise<AdvanceResult> {
  const roomId = roomRow.id
  const cfg = roomRow.config as WerewolfRoomConfig
  const agentInfos = (roomRow.agents as unknown as AgentInfo[]) ?? []
  const advancedRules = cfg.advancedRules ?? {}
  const languageInstruction = cfg.language
    ? buildLanguageDirective(cfg.language)
    : undefined

  const agentConfigs: WerewolfAgentConfig[] = cfg.players.map((p) => ({
    name: p.name,
    model: {
      provider: p.provider ?? resolveProvider(p.model),
      modelId: p.model,
      temperature: 0.7,
      maxTokens: 1500,
    },
  }))

  const result = createWerewolf(
    {
      agents: agentConfigs,
      advancedRules,
      languageInstruction,
      seed: roomId,
      roomId,
      agentIds: agentInfos.map((a) => a.id),
    },
    _createGenFn,
    _createObjFn,
  )

  const eventCount = await getEventCount(roomId)
  // First-tick semantics: no events yet, OR events exist but currentPhase
  // never persisted (phase:changed never fired — degenerate partial state,
  // safer to start from initial phase than throw).
  const isFirstTick = eventCount === 0 || roomRow.currentPhase === null

  if (isFirstTick) {
    result.flow.initialize([...result.room.getAgentIds()])
  } else {
    await rehydrateWerewolfFromDb(roomRow, result)
  }

  // Wire persistence. Use a *local* RuntimeEntry — no globalThis registry
  // coupling (each tick stands alone), but we still register for the
  // existing accountant dispose + pending-promise serialization.
  const pricingMap = await buildPricingMap(agentConfigs.map((a) => a.model))
  const accountant = new TokenAccountant(
    result.eventBus,
    createCostCalculator(pricingMap),
  )
  const runtime = registerRuntime(roomId, {
    eventBus: result.eventBus,
    room: result.room,
    flow: result.flow,
    accountant,
  })
  runtime.seq = eventCount // next event gets this seq
  wireEventPersistence(roomId, result.eventBus, runtime)
  wireGameStateSnapshots(
    roomId,
    result.eventBus,
    runtime,
    () => ({ ...(result.flow.getGameState().custom as Record<string, unknown>) }),
  )

  // First tick emits room:started. Durable subsequent ticks do not.
  if (isFirstTick) {
    result.eventBus.emit({ type: 'room:started', roomId })
  }

  let tickResult: Awaited<ReturnType<typeof result.room.runUntilPhaseBoundary>>
  try {
    tickResult = await result.room.runUntilPhaseBoundary(result.flow, {
      startingPhase: isFirstTick ? null : roomRow.currentPhase,
      startingRound: isFirstTick ? 0 : roomRow.currentRound,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[advanceRoom] ${roomId} failed:`, error)
    await flushRuntimePending(runtime)
    await updateRoomStatus(roomId, 'error', msg)
    disposeRuntime(roomId)
    return { kind: 'error', message: msg }
  }

  if (tickResult.gameCompleted) {
    result.eventBus.emit({ type: 'room:ended', roomId })
  }

  // Drain pending DB writes (events + snapshots enqueued by listeners)
  await flushRuntimePending(runtime)

  // Final gameState snapshot in case the last wireGameStateSnapshots
  // listener didn't fire (e.g. game ended without phase:changed).
  const finalState = {
    ...(result.flow.getGameState().custom as Record<string, unknown>),
  }
  await setGameState(roomId, finalState)

  if (tickResult.gameCompleted) {
    await updateRoomStatus(roomId, 'completed')
    disposeRuntime(roomId)
    const winResult = finalState['winResult'] as
      | 'village_wins'
      | 'werewolves_win'
      | null
    return { kind: 'complete', result: winResult ?? null }
  }

  disposeRuntime(roomId)
  return { kind: 'continue' }
}

// ── Rehydration ────────────────────────────────────────────

async function rehydrateWerewolfFromDb(
  roomRow: NonNullable<Awaited<ReturnType<typeof getRoom>>>,
  result: ReturnType<typeof createWerewolf>,
): Promise<void> {
  const roomId = roomRow.id
  const agentIds = result.room.getAgentIds()

  // Replay message events into agents so their chat history matches the
  // original session. Done BEFORE wiring persistence so no duplicate
  // events land in DB.
  const past = await getEventsSince(roomId, -1)
  for (const entry of past) {
    if (entry.event.type === 'message:created') {
      result.room.replayMessage(entry.event.message as Message)
    }
  }

  const snapshot = (roomRow.gameState as Record<string, unknown>) ?? {}
  const rolesRaw = (snapshot['roleMap'] as Record<string, string>) ?? {}
  const roles = new Map<string, string>(Object.entries(rolesRaw))
  const eliminated = (snapshot['eliminatedIds'] as string[]) ?? []
  const eliminatedSet = new Set(eliminated)
  const activeAgentIds = new Set(agentIds.filter((id) => !eliminatedSet.has(id)))

  // Callers guarantee currentPhase is non-null (isFirstTick check in
  // advanceWerewolfRoom routes null-phase cases to initialize()).
  const phaseName = roomRow.currentPhase!

  if (!(result.flow instanceof StateMachineFlow)) {
    throw new Error(
      `Cannot rehydrate ${roomId}: werewolf factory returned non-StateMachineFlow`,
    )
  }

  result.flow.rehydrate({
    phaseName,
    round: roomRow.currentRound,
    agentIds,
    roles,
    activeAgentIds,
    custom: snapshot,
  })
}

