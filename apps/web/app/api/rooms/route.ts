// ============================================================
// POST /api/rooms — Create a roundtable debate
// GET  /api/rooms  — List rooms (filterable by status/mode)
// ============================================================

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { start } from 'workflow/api'
import { AIAgent, Room, RoundRobinFlow, EventBus, TokenAccountant } from '@agora/core'

export const dynamic = 'force-dynamic'
// Phase 4.5d-2.3: createGenerateFn now sourced from local factory so
// the http_chain path uses the same deterministic-mock seam the WDK
// workflow uses under WORKFLOW_TEST=1 (cross-runtime equivalence).
// Pricing helpers stay on @agora/llm -- they don't touch the LLM.
import { createGenerateFn } from '../../lib/llm-factory'
import { buildPricingMap, createCostCalculator } from '@agora/llm'
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
import { requireAuthUserId } from '../../lib/auth'
import {
  roundtableWorkflow,
  toRoundtableAgentSnapshot,
} from '../../workflows/roundtable-workflow'
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
  // Phase 4.5d-2.2 — durable runtime. Default 'http_chain' (legacy).
  // Set to 'wdk' for new rooms that should run on Workflow DevKit.
  // Per the durability contract, runtime is fixed at creation.
  runtime?: 'http_chain' | 'wdk'
}

function composeAdHocSystemPrompt(
  agentName: string,
  persona: string,
  topic: string,
  languageDirective: string,
): string {
  return [
    `You are participating in a structured debate on the topic: "${topic}".`,
    `Your role is ${agentName}: ${persona}`,
    'Keep your responses focused and concise (2-4 paragraphs).',
    'Engage with what other participants have said. Build on, challenge, or nuance their points.',
    'Be substantive and specific. Avoid generic platitudes.',
    '',
    languageDirective,
  ].join('\n')
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
    const auth = await requireAuthUserId()
    if (!auth.ok) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }
    const createdBy = auth.id

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
          maxTokens: 1024,
        }
        const persona: PersonaConfig = { name: agentInput.name, description: agentInput.persona }
        // Compose once, use in both places (AIAgent for legacy http_chain
        // and AgentInfo for WDK roundtable workflow). Previously the
        // ad-hoc path inlined this into AIAgent and never persisted; the
        // WDK workflow needs it from AgentInfo.
        const systemPrompt = composeAdHocSystemPrompt(
          agentInput.name,
          agentInput.persona,
          body.topic,
          languageDirective,
        )

        const agent = new AIAgent(
          {
            id: agentId,
            name: agentInput.name,
            persona,
            model: modelConfig,
            systemPrompt,
          },
          createGenerateFn(modelConfig),
        )

        aiAgents.push(agent)
        agentInfos.push({
          id: agentId,
          name: agentInput.name,
          model: agentInput.model,
          provider,
          persona: agentInput.persona,
          systemPrompt,
        })
      }
    }

    // Default to http_chain to match historical behavior. Toggle to
    // 'wdk' explicitly via body. New default may flip to 'wdk' for
    // roundtable once 4.5d-2.3 cross-runtime equivalence test passes.
    const runtime: 'http_chain' | 'wdk' = body.runtime === 'wdk' ? 'wdk' : 'http_chain'

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
      runtime,
    })

    if (runtime === 'wdk') {
      // WDK path: skip in-memory Room/AIAgent/Flow/Accountant entirely.
      // The workflow body owns its own LLM calls + persistence per the
      // durability contract. Build agent snapshots from AgentInfo and
      // hand them off to the workflow.
      //
      // Wrapped in try/catch: createRoom already committed by this point.
      // If snapshot-build or start() throws, the room row would otherwise
      // stay at status='running' forever (markOrphanedAsError now skips
      // WDK rooms intentionally). Flip to 'error' explicitly so the row
      // is recoverable and observable.
      try {
        const snapshots = agentInfos.map((info) => {
          if (!info.systemPrompt) {
            throw new Error(`agent ${info.id} missing systemPrompt for WDK runtime`)
          }
          return toRoundtableAgentSnapshot(info, info.systemPrompt)
        })

        // start() returns immediately after enqueueing. The workflow
        // runs durably in the WDK runtime; in-flight step failures
        // surface inside the workflow and are caught by its outer
        // try/catch (see roundtableWorkflow's terminal-error guard
        // landed in 4.5d-2.4). This await ONLY blocks on enqueue.
        await start(roundtableWorkflow, [
          {
            roomId,
            agents: snapshots,
            topic: body.topic,
            rounds: body.rounds,
          },
        ])

        return NextResponse.json({ roomId, runtime: 'wdk' })
      } catch (workflowStartError) {
        const msg =
          workflowStartError instanceof Error
            ? workflowStartError.message
            : String(workflowStartError)
        console.error(`[wdk-start] ${roomId} failed to enqueue:`, workflowStartError)
        await updateRoomStatus(roomId, 'error', `WDK enqueue failed: ${msg}`)
        return NextResponse.json(
          { error: 'Failed to start WDK runtime', roomId },
          { status: 500 },
        )
      }
    }

    // http_chain path (legacy, default until cross-runtime parity proven).
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
    const httpChainRuntime = registerRuntime(roomId, { eventBus, room, flow, accountant })
    wireEventPersistence(roomId, eventBus, httpChainRuntime)

    waitUntil(
      room
        .start(flow)
        .then(async () => {
          await flushRuntimePending(httpChainRuntime)
          await updateRoomStatus(roomId, 'completed')
          disposeRuntime(roomId)
        })
        .catch(async (error) => {
          console.error(`Room ${roomId} failed:`, error)
          await flushRuntimePending(httpChainRuntime)
          await updateRoomStatus(
            roomId,
            'error',
            error instanceof Error ? error.message : String(error),
          )
          disposeRuntime(roomId)
        }),
    )

    return NextResponse.json({ roomId, runtime: 'http_chain' })
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
