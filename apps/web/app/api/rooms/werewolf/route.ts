// ============================================================
// POST /api/rooms/werewolf — Create a werewolf game
// ============================================================

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { TokenAccountant } from '@agora/core'
import type { GenerateFn, GenerateObjectFn } from '@agora/core'
import {
  createGenerateFn,
  createGenerateObjectFn,
  buildPricingMap,
  createCostCalculator,
} from '@agora/llm'
import { createWerewolf } from '@agora/modes'
import type { LLMProvider, ModelConfig } from '@agora/shared'
import type { WerewolfAdvancedRules } from '@agora/modes'
import {
  createRoom,
  setGameState,
  updateRoomStatus,
  type AgentInfo,
} from '../../../lib/room-store'
import {
  registerRuntime,
  disposeRuntime,
} from '../../../lib/runtime-registry'
import {
  flushRuntimePending,
  wireEventPersistence,
  wireGameStateSnapshots,
} from '../../../lib/persist-runtime'

// The LLM package types the schema as ZodSchema; core types it as unknown.
const _createGenFn: (model: ModelConfig) => GenerateFn = createGenerateFn
const _createObjFn: (model: ModelConfig) => GenerateObjectFn = (m) =>
  createGenerateObjectFn(m) as unknown as GenerateObjectFn

interface PlayerInput {
  name: string
  model: string
  provider?: LLMProvider
}

interface CreateWerewolfBody {
  players: PlayerInput[]
  advancedRules?: WerewolfAdvancedRules
}

function resolveProvider(modelId: string): LLMProvider {
  if (modelId.startsWith('claude')) return 'anthropic'
  if (modelId.startsWith('gpt')) return 'openai'
  if (modelId.startsWith('gemini')) return 'google'
  if (modelId.startsWith('deepseek')) return 'deepseek'
  throw new Error(`Unknown model: ${modelId}`)
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateWerewolfBody

    if (!body.players || body.players.length < 6 || body.players.length > 12) {
      return NextResponse.json(
        { error: 'Werewolf requires 6-12 players' },
        { status: 400 },
      )
    }

    const advancedRules = body.advancedRules ?? {}

    const agentConfigs = body.players.map((p) => ({
      name: p.name,
      model: {
        provider: p.provider ?? resolveProvider(p.model),
        modelId: p.model,
        temperature: 0.7,
        maxTokens: 1500,
      } satisfies ModelConfig,
    }))

    // Build the werewolf game
    const result = createWerewolf(
      { agents: agentConfigs, advancedRules },
      _createGenFn,
      _createObjFn,
    )

    const roomId = result.room.config.id

    // Gather agent info + role assignments for DB
    const agentInfos: AgentInfo[] = result.room.getAgentIds().map((id) => {
      const agent = result.room.getAgent(id)!
      return {
        id,
        name: agent.config.name,
        model: agent.config.model.modelId,
        provider: agent.config.model.provider,
      }
    })

    const roleAssignments: Record<string, string> = {}
    for (const [id, role] of Object.entries(result.roleAssignments)) {
      roleAssignments[id] = role
    }

    // Persist room shell
    await createRoom({
      id: roomId,
      modeId: 'werewolf',
      topic: 'Werewolf',
      config: { players: body.players, advancedRules },
      agents: agentInfos,
      roleAssignments,
      advancedRules: advancedRules as Record<string, boolean>,
    })

    // Snapshot the initial custom game state (roleMap, flags, etc.)
    await setGameState(roomId, {
      ...(result.flow.getGameState().custom as Record<string, unknown>),
    })

    // Build runtime + wire persistence
    const pricingMap = await buildPricingMap(agentConfigs.map((a) => a.model))
    const accountant = new TokenAccountant(result.eventBus, createCostCalculator(pricingMap))
    const runtime = registerRuntime(roomId, {
      eventBus: result.eventBus,
      room: result.room,
      flow: result.flow,
      accountant,
    })
    wireEventPersistence(roomId, result.eventBus, runtime)
    wireGameStateSnapshots(
      roomId,
      result.eventBus,
      runtime,
      () => ({ ...(result.flow.getGameState().custom as Record<string, unknown>) }),
    )

    // Run the game in background
    waitUntil(
      result.room
        .start(result.flow)
        .then(async () => {
          await flushRuntimePending(runtime)
          await updateRoomStatus(roomId, 'completed')
          disposeRuntime(roomId)
        })
        .catch(async (error) => {
          console.error(`Werewolf room ${roomId} failed:`, error)
          await flushRuntimePending(runtime)
          await updateRoomStatus(
            roomId,
            'error',
            error instanceof Error ? error.message : String(error),
          )
          disposeRuntime(roomId)
        }),
    )

    return NextResponse.json({ roomId })
  } catch (error) {
    console.error('Failed to create werewolf game:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create game' },
      { status: 500 },
    )
  }
}
