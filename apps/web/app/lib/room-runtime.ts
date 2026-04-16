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
import {
  createOpenChat,
  createWerewolf,
  type OpenChatAgentConfig,
  type WerewolfAgentConfig,
  type WerewolfAdvancedRules,
} from '@agora/modes'
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
  setCurrentPhase,
  setCurrentRound,
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
  | { kind: 'waiting'; agentId: string }
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
  if (roomRow.status === 'waiting') {
    const gs = roomRow.gameState as { waitingForHuman?: string } | null
    return { kind: 'waiting', agentId: gs?.waitingForHuman ?? 'unknown' }
  }

  if (roomRow.modeId === 'werewolf') return advanceWerewolfRoom(roomRow)
  if (roomRow.modeId === 'open-chat') return advanceOpenChatRoom(roomRow)

  // Roundtable durable advance is legacy `waitUntil(start)`; not yet tickable.
  return {
    kind: 'error',
    message: `advance not yet implemented for mode: ${roomRow.modeId}`,
  }
}

// ── Open-chat advance ──────────────────────────────────────

interface OpenChatRoomModeConfig {
  topic?: string
  rounds?: number
  leaderAgentId?: string | null
  language?: 'en' | 'zh'
}

async function advanceOpenChatRoom(
  roomRow: NonNullable<Awaited<ReturnType<typeof getRoom>>>,
): Promise<AdvanceResult> {
  const roomId = roomRow.id
  const modeConfig = (roomRow.modeConfig as OpenChatRoomModeConfig | null) ?? {}
  const agentInfos = (roomRow.agents as unknown as AgentInfo[]) ?? []
  if (agentInfos.length === 0) {
    return { kind: 'error', message: 'open-chat room has no agents' }
  }

  const topic = roomRow.topic ?? modeConfig.topic ?? ''
  const rounds = modeConfig.rounds ?? 3
  const leaderAgentId = modeConfig.leaderAgentId ?? null
  const languageInstruction = modeConfig.language
    ? buildLanguageDirective(modeConfig.language)
    : undefined
  const totalTurns = agentInfos.length * rounds

  const pastEvents = await getEventsSince(roomId, -1)
  const messagesSoFar = pastEvents.filter(
    (e) => e.event.type === 'message:created',
  ).length
  const eventCount = pastEvents.length

  // Already done — recover idempotently.
  if (messagesSoFar >= totalTurns) {
    await updateRoomStatus(roomId, 'completed')
    return { kind: 'complete', result: null }
  }

  const openChatAgents: OpenChatAgentConfig[] = agentInfos.map((info) =>
    toOpenChatAgentConfig(info, topic, languageInstruction),
  )

  const result = createOpenChat(
    {
      agents: openChatAgents,
      topic,
      rounds,
      leaderAgentId,
      roomId,
    },
    _createGenFn,
  )

  // Fast-forward the flow state so the NEXT tick() picks up where we left off.
  result.flow.initialize([...result.orderedAgentIds])
  for (let i = 0; i < messagesSoFar; i++) {
    result.flow.tick()
  }

  const isFirstTick = eventCount === 0

  if (!isFirstTick) {
    for (const entry of pastEvents) {
      if (entry.event.type === 'message:created') {
        result.room.replayMessage(entry.event.message as Message)
      }
    }
  }

  const pricingMap = await buildPricingMap(openChatAgents.map((a) => a.model))
  const accountant = new TokenAccountant(result.eventBus, createCostCalculator(pricingMap))
  const runtime = registerRuntime(roomId, {
    eventBus: result.eventBus,
    room: result.room,
    flow: result.flow,
    accountant,
  })
  runtime.seq = eventCount
  wireEventPersistence(roomId, result.eventBus, runtime)

  if (isFirstTick) {
    result.eventBus.emit({ type: 'room:started', roomId })
  }

  let turnResult: Awaited<ReturnType<typeof result.room.runOneTurn>>
  try {
    turnResult = await result.room.runOneTurn(result.flow, {
      startingPhase: isFirstTick ? null : (roomRow.currentPhase ?? 'discussion'),
      startingRound: isFirstTick ? 0 : roomRow.currentRound,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[advanceOpenChat] ${roomId} failed:`, error)
    await flushRuntimePending(runtime)
    await updateRoomStatus(roomId, 'error', msg)
    disposeRuntime(roomId)
    return { kind: 'error', message: msg }
  }

  // Human turn detected — pause the tick chain
  if (turnResult.waitingForHuman) {
    await flushRuntimePending(runtime)
    await setCurrentPhase(roomId, turnResult.phase || 'discussion')
    await setCurrentRound(roomId, turnResult.round)
    await setGameState(roomId, {
      topic,
      turnsCompleted: messagesSoFar,
      totalTurns,
      leaderAgentId: leaderAgentId ?? null,
      waitingForHuman: turnResult.waitingForHuman,
      waitingSince: Date.now(),
    })
    await updateRoomStatus(roomId, 'waiting')
    disposeRuntime(roomId)
    return { kind: 'waiting', agentId: turnResult.waitingForHuman }
  }

  // Checkpoint progress so /admin and /replay see it mid-run.
  await setCurrentPhase(roomId, turnResult.phase || 'discussion')
  await setCurrentRound(roomId, turnResult.round)
  const turnsCompleted = messagesSoFar + 1
  await setGameState(roomId, {
    topic,
    turnsCompleted,
    totalTurns,
    leaderAgentId: leaderAgentId ?? null,
  })

  const wasLastTurn = result.flow.isComplete()
  if (wasLastTurn) {
    result.eventBus.emit({ type: 'room:ended', roomId })
    await flushRuntimePending(runtime)
    await updateRoomStatus(roomId, 'completed')
    disposeRuntime(roomId)
    return { kind: 'complete', result: null }
  }

  await flushRuntimePending(runtime)
  disposeRuntime(roomId)
  return { kind: 'continue' }
}

function toOpenChatAgentConfig(
  info: AgentInfo,
  topic: string,
  languageInstruction: string | undefined,
): OpenChatAgentConfig {
  const style = info.style ?? {}
  const temperature = typeof style['temperature'] === 'number' ? (style['temperature'] as number) : 0.7
  const maxTokens = typeof style['maxTokens'] === 'number' ? (style['maxTokens'] as number) : 1024

  // Use snapshot's systemPrompt as-is if present; else compose a sensible
  // default from the minimal fields the werewolf-fast-path rooms persist.
  const systemPrompt =
    info.systemPrompt ??
    composeOpenChatDefaultPrompt(info.name, info.persona, topic, languageInstruction)

  return {
    id: info.id,
    name: info.name,
    persona: info.persona ?? `A participant named ${info.name}`,
    systemPrompt,
    model: {
      provider: info.provider as LLMProvider,
      modelId: info.model,
      temperature,
      maxTokens,
    },
    isHuman: info.isHuman ?? false,
  }
}

function composeOpenChatDefaultPrompt(
  name: string,
  persona: string | undefined,
  topic: string,
  languageInstruction: string | undefined,
): string {
  const parts: string[] = []
  parts.push(`你是 ${name}，正在与其他参与者围绕以下话题进行对话：`)
  parts.push(`「${topic}」`)
  if (persona) {
    parts.push('')
    parts.push(`你的身份设定：${persona}`)
  }
  parts.push('')
  parts.push('保持简洁有力（2-4 段），围绕话题提出你的观点、回应其他人的发言，推动讨论前进。')
  if (languageInstruction) {
    parts.push('')
    parts.push(languageInstruction)
  }
  return parts.join('\n')
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

  // Build a name → isHuman lookup from the agents snapshot
  const humanNames = new Set(
    agentInfos.filter((a) => a.isHuman).map((a) => a.name),
  )

  const agentConfigs: WerewolfAgentConfig[] = cfg.players.map((p) => ({
    name: p.name,
    model: {
      provider: p.provider ?? resolveProvider(p.model),
      modelId: p.model,
      temperature: 0.7,
      maxTokens: 1500,
    },
    isHuman: humanNames.has(p.name),
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
  const finalState: Record<string, unknown> = {
    ...(result.flow.getGameState().custom as Record<string, unknown>),
  }

  // Human turn detected — pause the tick chain
  if (tickResult.waitingForHuman) {
    finalState['waitingForHuman'] = tickResult.waitingForHuman
    finalState['waitingSince'] = Date.now()
    await setGameState(roomId, finalState)
    await setCurrentPhase(roomId, tickResult.phase || '')
    await setCurrentRound(roomId, tickResult.round)
    await updateRoomStatus(roomId, 'waiting')
    disposeRuntime(roomId)
    return { kind: 'waiting', agentId: tickResult.waitingForHuman }
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

