// ============================================================
// POST /api/rooms — Create a roundtable debate
// ============================================================

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { AIAgent, Room, RoundRobinFlow, EventBus, TokenAccountant } from '@agora/core'
import { createGenerateFn, buildPricingMap, createCostCalculator } from '@agora/llm'
import type { LLMProvider, ModelConfig, PersonaConfig } from '@agora/shared'
import {
  createRoom,
  updateRoomStatus,
  type AgentInfo,
} from '../../lib/room-store'
import {
  registerRuntime,
  disposeRuntime,
} from '../../lib/runtime-registry'
import {
  flushRuntimePending,
  wireEventPersistence,
} from '../../lib/persist-runtime'

interface AgentInput {
  name: string
  persona: string
  model: string
  provider?: string
}

interface CreateRoomBody {
  topic: string
  rounds: number
  agents: AgentInput[]
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
    const body = (await request.json()) as CreateRoomBody

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

    // Persist room shell to DB
    await createRoom({
      id: roomId,
      modeId: 'roundtable',
      topic: body.topic,
      config: { topic: body.topic, rounds: body.rounds, agents: body.agents },
      agents: agentInfos,
      currentRound: 1,
    })

    // Build room + register runtime + wire persistence
    const room = new Room(
      { id: roomId, name: body.topic, modeId: 'roundtable', topic: body.topic, maxAgents: 8 },
      eventBus,
    )
    for (const agent of aiAgents) room.addAgent(agent)

    const pricingMap = await buildPricingMap(
      aiAgents.map((a) => ({ provider: a.config.model.provider, modelId: a.config.model.modelId })),
    )
    const accountant = new TokenAccountant(eventBus, createCostCalculator(pricingMap))

    const flow = new RoundRobinFlow({ rounds: body.rounds })
    const runtime = registerRuntime(roomId, { eventBus, room, flow, accountant })
    wireEventPersistence(roomId, eventBus, runtime)

    // Return roomId immediately; game runs in background until completion
    waitUntil(
      room
        .start(flow)
        .then(async () => {
          await flushRuntimePending(runtime)
          await updateRoomStatus(roomId, 'completed')
          disposeRuntime(roomId)
        })
        .catch(async (error) => {
          console.error(`Room ${roomId} failed:`, error)
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
    console.error('Failed to create room:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create room' },
      { status: 500 },
    )
  }
}
