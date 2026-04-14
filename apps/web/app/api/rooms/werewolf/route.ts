// ============================================================
// POST /api/rooms/werewolf — Create a werewolf game (Phase 4.5a)
// ============================================================
//
// Creates the DB row, pre-computes deterministic roleAssignments, and
// fires the first /api/rooms/tick invocation in the background. The
// durable runtime (room-runtime.ts) then walks the game to completion
// via chained ticks, each bounded to ~60s.
//
// Legacy note: this previously bundled the entire game into a single
// waitUntil(room.start(flow)) — which hit Vercel's 5-min function wall
// for werewolf. That path is gone.

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import type { GenerateFn, GenerateObjectFn } from '@agora/core'
import {
  createGenerateFn,
  createGenerateObjectFn,
} from '@agora/llm'
import { createWerewolf } from '@agora/modes'
import type { LLMProvider, ModelConfig } from '@agora/shared'
import type { WerewolfAdvancedRules } from '@agora/modes'
import { createRoom, setGameState, type AgentInfo } from '../../../lib/room-store'
import { buildLanguageDirective, resolveAgentLanguage } from '../../../lib/language'

export const dynamic = 'force-dynamic'

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
  language?: 'en' | 'zh'
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
    const language = await resolveAgentLanguage(body.language)
    const languageDirective = buildLanguageDirective(language)

    const agentConfigs = body.players.map((p) => ({
      name: p.name,
      model: {
        provider: p.provider ?? resolveProvider(p.model),
        modelId: p.model,
        temperature: 0.7,
        maxTokens: 1500,
      } satisfies ModelConfig,
    }))

    // Generate roomId upfront — it seeds deterministic agentId + role
    // shuffle so rehydration during ticks produces identical state.
    const roomId = crypto.randomUUID()

    // Build the runtime solely to get deterministic agentIds +
    // roleAssignments for the DB snapshot. We discard the runtime; the
    // first tick rebuilds a fresh one from the DB row.
    const result = createWerewolf(
      {
        agents: agentConfigs,
        advancedRules,
        languageInstruction: languageDirective,
        seed: roomId,
        roomId,
      },
      _createGenFn,
      _createObjFn,
    )

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

    // Persist room shell. `language` is stored in config so the tick
    // rehydration path can rebuild agents with the same language
    // directive.
    await createRoom({
      id: roomId,
      modeId: 'werewolf',
      topic: 'Werewolf',
      config: { players: body.players, advancedRules, language },
      agents: agentInfos,
      roleAssignments,
      advancedRules: advancedRules as Record<string, boolean>,
    })

    // Snapshot the initial WerewolfGameState so rehydration has a
    // baseline even if the first tick errors before phase:changed fires.
    await setGameState(roomId, {
      ...(result.flow.getGameState().custom as Record<string, unknown>),
    })

    // Fire the first tick asynchronously.
    const tickUrl = new URL('/api/rooms/tick', request.url)
    tickUrl.searchParams.set('id', roomId)
    waitUntil(
      fetch(tickUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      }).catch((err) =>
        console.error(`[werewolf-create] ${roomId} first-tick fetch failed:`, err),
      ),
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
