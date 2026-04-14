// ============================================================
// POST /api/rooms/werewolf — Create a werewolf game
// ============================================================

import { NextResponse } from 'next/server'
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

// The LLM package types the schema as ZodSchema; core types it as unknown.
// These are structurally incompatible at the parameter position, so cast.
const _createGenFn: (model: ModelConfig) => GenerateFn = createGenerateFn
const _createObjFn: (model: ModelConfig) => GenerateObjectFn = (m) =>
  createGenerateObjectFn(m) as unknown as GenerateObjectFn
import {
  setRoomState,
  addMessage,
  updateRoomStatus,
  setThinkingAgent,
  setCurrentPhase,
  setAccountant,
  setGameState,
  addEvent,
} from '../../../lib/room-store'
import type { RoomState, AgentInfo } from '../../../lib/room-store'

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

    // Collect agent info for room store
    const agentInfos: AgentInfo[] = result.room
      .getAgentIds()
      .map((id) => {
        const agent = result.room.getAgent(id)!
        return {
          id,
          name: agent.config.name,
          model: agent.config.model.modelId,
          provider: agent.config.model.provider,
        }
      })

    // Role assignments for the frontend
    const roleAssignments: Record<string, string> = {}
    for (const [id, role] of Object.entries(result.roleAssignments)) {
      roleAssignments[id] = role
    }

    const roomState: RoomState = {
      id: roomId,
      topic: 'Werewolf',
      rounds: 0, // not used by werewolf
      modeId: 'werewolf',
      agents: agentInfos,
      messages: [],
      events: [],
      status: 'running',
      currentRound: 1,
      thinkingAgentId: null,
      currentPhase: null,
      roleAssignments,
      advancedRules: advancedRules as Record<string, boolean>,
    }
    setRoomState(roomId, roomState)

    // Wire the token accountant
    const pricingMap = await buildPricingMap(agentConfigs.map((a) => a.model))
    const calculateCost = createCostCalculator(pricingMap)
    const accountant = new TokenAccountant(result.eventBus, calculateCost)
    setAccountant(roomId, accountant)

    // Wire event bus → room store
    result.eventBus.on('message:created', (event) => {
      addMessage(roomId, event.message)
      addEvent(roomId, event)
    })

    result.eventBus.on('agent:thinking', (event) => {
      setThinkingAgent(roomId, event.agentId)
      addEvent(roomId, event)
    })

    result.eventBus.on('agent:done', (event) => {
      setThinkingAgent(roomId, null)
      addEvent(roomId, event)
    })

    result.eventBus.on('phase:changed', (event) => {
      setCurrentPhase(roomId, event.phase)
      addEvent(roomId, event)

      // Snapshot the custom game state after each phase for the frontend
      const gs = result.flow.getGameState()
      setGameState(roomId, { ...(gs.custom as Record<string, unknown>) })
    })

    result.eventBus.on('room:ended', () => {
      // Final state snapshot so the winner + eliminated ids land in the UI
      const gs = result.flow.getGameState()
      setGameState(roomId, { ...(gs.custom as Record<string, unknown>) })
      updateRoomStatus(roomId, 'completed')
    })

    // Start the game in the background
    result.room.start(result.flow).catch((error) => {
      console.error(`Werewolf room ${roomId} failed:`, error)
      updateRoomStatus(roomId, 'error')
    })

    return NextResponse.json({ roomId })
  } catch (error) {
    console.error('Failed to create werewolf game:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create game' },
      { status: 500 },
    )
  }
}
