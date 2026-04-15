// ============================================================
// POST /api/rooms — Create a roundtable debate
// GET  /api/rooms  — List rooms (filterable by status/mode)
// ============================================================

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { AIAgent, Room, RoundRobinFlow, EventBus, TokenAccountant } from '@agora/core'

export const dynamic = 'force-dynamic'
import { createGenerateFn, buildPricingMap, createCostCalculator } from '@agora/llm'
import type { LLMProvider, ModelConfig, PersonaConfig } from '@agora/shared'
import {
  createRoom,
  listCompletedRooms,
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
import { buildLanguageDirective, resolveAgentLanguage } from '../../lib/language'
import { getTeam } from '../../lib/team-store'
import { buildTeamSnapshot } from '../../lib/team-room'
import { getUserIdFromRequest } from '../../lib/user-id'
import type { NextRequest } from 'next/server'

interface AgentInput {
  name: string
  persona: string
  model: string
  provider?: string
}

interface CreateRoomBody {
  topic: string
  rounds: number
  agents?: AgentInput[]
  teamId?: string
  language?: 'en' | 'zh'
}

function resolveProvider(modelId: string): LLMProvider {
  if (modelId.startsWith('claude')) return 'anthropic'
  if (modelId.startsWith('gpt')) return 'openai'
  if (modelId.startsWith('gemini')) return 'google'
  if (modelId.startsWith('deepseek')) return 'deepseek'
  throw new Error(`Unknown model: ${modelId}`)
}

// ── POST: create ────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateRoomBody

    if (!body.topic || typeof body.topic !== 'string') {
      return NextResponse.json({ error: 'topic is required' }, { status: 400 })
    }
    if (!body.rounds || body.rounds < 1 || body.rounds > 10) {
      return NextResponse.json({ error: 'rounds must be 1-10' }, { status: 400 })
    }

    const language = await resolveAgentLanguage(body.language)
    const languageDirective = buildLanguageDirective(language)

    const roomId = crypto.randomUUID()
    const eventBus = new EventBus()
    const createdBy = getUserIdFromRequest(request)

    const agentInfos: AgentInfo[] = []
    const aiAgents: AIAgent[] = []
    let teamId: string | null = null

    // Phase 6 — team-based creation. Build from team members.
    if (body.teamId) {
      const team = await getTeam(body.teamId)
      if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
      const { agents: snapshot } = await buildTeamSnapshot({
        team,
        topic: body.topic,
        modeId: 'roundtable',
        language,
      })
      if (snapshot.length < 2) {
        return NextResponse.json({ error: 'Team needs at least 2 members' }, { status: 400 })
      }
      teamId = team.id
      for (const info of snapshot) {
        const provider = info.provider as LLMProvider
        const modelConfig: ModelConfig = {
          provider,
          modelId: info.model,
          temperature: (info.style?.['temperature'] as number) ?? 0.8,
          maxTokens: (info.style?.['maxTokens'] as number) ?? 1024,
        }
        const persona: PersonaConfig = {
          name: info.name,
          description: info.persona ?? info.name,
        }
        const agent = new AIAgent(
          {
            id: info.id,
            name: info.name,
            persona,
            model: modelConfig,
            systemPrompt: info.systemPrompt ?? `${info.name}: ${info.persona ?? ''}`,
          },
          createGenerateFn(modelConfig),
        )
        aiAgents.push(agent)
        agentInfos.push(info)
      }
    } else {
      // Legacy ad-hoc path — body.agents provided.
      if (!body.agents || body.agents.length < 2) {
        return NextResponse.json({ error: 'At least 2 agents required' }, { status: 400 })
      }
      for (const agentInput of body.agents) {
        const agentId = crypto.randomUUID()
        const provider = (agentInput.provider as LLMProvider) ?? resolveProvider(agentInput.model)
        const modelConfig: ModelConfig = {
          provider,
          modelId: agentInput.model,
          temperature: 0.8,
          maxTokens: 1024,
        }
        const persona: PersonaConfig = { name: agentInput.name, description: agentInput.persona }

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
              '',
              languageDirective,
            ].join('\n'),
          },
          createGenerateFn(modelConfig),
        )

        aiAgents.push(agent)
        agentInfos.push({ id: agentId, name: agentInput.name, model: agentInput.model, provider })
      }
    }

    await createRoom({
      id: roomId,
      modeId: 'roundtable',
      topic: body.topic,
      config: { topic: body.topic, rounds: body.rounds, agents: body.agents ?? [], language },
      modeConfig: { topic: body.topic, rounds: body.rounds, language },
      agents: agentInfos,
      currentRound: 1,
      teamId,
      createdBy,
    })

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

// ── GET: list completed rooms ───────────────────────────────

export async function GET(request: Request) {
  const url = new URL(request.url)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10), 1), 200)
  const modeId = url.searchParams.get('mode')

  const rooms = await listCompletedRooms(limit)
  const filtered = modeId ? rooms.filter((r) => r.modeId === modeId) : rooms

  return NextResponse.json({
    rooms: filtered.map((r) => ({
      id: r.id,
      modeId: r.modeId,
      topic: r.topic,
      agents: r.agents,
      currentPhase: r.currentPhase,
      gameState: r.gameState,
      totalCost: r.totalCost,
      totalTokens: r.totalTokens,
      callCount: r.callCount,
      messageCount: r.messageCount,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
    })),
  })
}
