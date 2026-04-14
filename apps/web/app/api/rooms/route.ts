// ============================================================
// POST /api/rooms — Create a room and start the debate
// ============================================================

import { NextResponse } from 'next/server'
import { AIAgent, Room, RoundRobinFlow, EventBus, TokenAccountant } from '@agora/core'
import { createGenerateFn, buildPricingMap, createCostCalculator } from '@agora/llm'
import type { LLMProvider, ModelConfig, PersonaConfig } from '@agora/shared'
import {
  setRoomState,
  addMessage,
  updateRoomStatus,
  setThinkingAgent,
  setCurrentRound,
  setCurrentPhase,
  setAccountant,
  addEvent,
} from '../../lib/room-store'
import type { RoomState, AgentInfo } from '../../lib/room-store'

interface AgentInput {
  name: string
  persona: string
  model: string // e.g. "claude-sonnet-4-20250514", "gpt-4o", "gpt-5.4", "gemini-2.0-flash"
  provider?: string // e.g. "anthropic", "openai", "azure-openai", "google"
}

interface CreateRoomBody {
  topic: string
  rounds: number
  agents: AgentInput[]
}

/** Map model ID to provider */
function resolveProvider(modelId: string): LLMProvider {
  if (modelId.startsWith('claude')) return 'anthropic'
  if (modelId.startsWith('gpt')) return 'openai'
  if (modelId.startsWith('gemini')) return 'google'
  if (modelId.startsWith('deepseek')) return 'deepseek'
  throw new Error(`Unknown model: ${modelId}`)
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateRoomBody

    // Validate input
    if (!body.topic || typeof body.topic !== 'string') {
      return NextResponse.json({ error: 'topic is required' }, { status: 400 })
    }
    if (!body.agents || body.agents.length < 2) {
      return NextResponse.json({ error: 'At least 2 agents required' }, { status: 400 })
    }
    if (!body.rounds || body.rounds < 1 || body.rounds > 10) {
      return NextResponse.json({ error: 'rounds must be 1-10' }, { status: 400 })
    }

    const roomId = crypto.randomUUID()
    const eventBus = new EventBus()

    // Build agents
    const agentInfos: AgentInfo[] = []
    const aiAgents: AIAgent[] = []

    for (const agentInput of body.agents) {
      const agentId = crypto.randomUUID()
      const provider = (agentInput.provider as LLMProvider) ?? resolveProvider(agentInput.model)

      const modelConfig: ModelConfig = {
        provider,
        modelId: agentInput.model,
        temperature: 0.8,
        maxTokens: 1024,
      }

      const persona: PersonaConfig = {
        name: agentInput.name,
        description: agentInput.persona,
      }

      const generateFn = createGenerateFn(modelConfig)

      const agent = new AIAgent(
        {
          id: agentId,
          name: agentInput.name,
          persona,
          model: modelConfig,
          systemPrompt: [
            `You are participating in a structured debate on the topic: "${body.topic}".`,
            `Your role is ${agentInput.name}: ${agentInput.persona}`,
            'Keep your responses focused and concise (2-4 paragraphs).',
            'Engage with what other participants have said. Build on, challenge, or nuance their points.',
            'Be substantive and specific. Avoid generic platitudes.',
          ].join('\n'),
        },
        generateFn,
      )

      aiAgents.push(agent)
      agentInfos.push({
        id: agentId,
        name: agentInput.name,
        model: agentInput.model,
        provider,
      })
    }

    // Create room
    const room = new Room(
      {
        id: roomId,
        name: body.topic,
        modeId: 'roundtable',
        topic: body.topic,
        maxAgents: 8,
      },
      eventBus,
    )

    // Add agents to room
    for (const agent of aiAgents) {
      room.addAgent(agent)
    }

    // Initialize room state in store
    const roomState: RoomState = {
      id: roomId,
      topic: body.topic,
      rounds: body.rounds,
      modeId: 'roundtable',
      agents: agentInfos,
      messages: [],
      events: [],
      status: 'running',
      currentRound: 1,
      thinkingAgentId: null,
      currentPhase: null,
    }
    setRoomState(roomId, roomState)

    // Wire token accountant (pricing resolved from LiteLLM once per process)
    const pricingMap = await buildPricingMap(
      aiAgents.map((a) => ({ provider: a.config.model.provider, modelId: a.config.model.modelId })),
    )
    const calculateCost = createCostCalculator(pricingMap)
    const accountant = new TokenAccountant(eventBus, calculateCost)
    setAccountant(roomId, accountant)

    // Persist token:recorded events in the room event log for observability
    eventBus.on('token:recorded', (event) => {
      addEvent(roomId, event)
    })

    // Wire up event bus to update room store
    eventBus.on('message:created', (event) => {
      addMessage(roomId, event.message)
      addEvent(roomId, event)
    })

    eventBus.on('agent:thinking', (event) => {
      setThinkingAgent(roomId, event.agentId)
      addEvent(roomId, event)
    })

    eventBus.on('agent:done', (event) => {
      setThinkingAgent(roomId, null)
      addEvent(roomId, event)
    })

    eventBus.on('round:changed', (event) => {
      setCurrentRound(roomId, event.round)
      addEvent(roomId, event)
    })

    eventBus.on('phase:changed', (event) => {
      setCurrentPhase(roomId, event.phase)
      addEvent(roomId, event)
    })

    eventBus.on('room:ended', () => {
      updateRoomStatus(roomId, 'completed')
    })

    // Start the debate in the background (don't await)
    const flow = new RoundRobinFlow({ rounds: body.rounds })
    room.start(flow).catch((error) => {
      console.error(`Room ${roomId} failed:`, error)
      updateRoomStatus(roomId, 'error')
      const roomState2 = roomState
      if (roomState2) {
        roomState2.error = error instanceof Error ? error.message : String(error)
      }
    })

    return NextResponse.json({ roomId })
  } catch (error) {
    console.error('Failed to create room:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create room' },
      { status: 500 },
    )
  }
}
