// ============================================================
// GET  /api/agents          — list (filter: mine|templates|all)
// POST /api/agents          — create agent (requires UID cookie)
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { createAgent, listAgents, type AgentStyle } from '../../lib/agent-store'
import { getReaderId, requireAuthUserId } from '../../lib/auth'

export const dynamic = 'force-dynamic'

const VALID_PROVIDERS = ['anthropic', 'openai', 'google', 'deepseek'] as const
type Provider = (typeof VALID_PROVIDERS)[number]

interface CreateAgentBody {
  name?: unknown
  persona?: unknown
  systemPrompt?: unknown
  modelProvider?: unknown
  modelId?: unknown
  style?: unknown
  avatarSeed?: unknown
}

// ── GET ────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const scope = url.searchParams.get('scope') // 'mine' | 'templates' | null (all visible)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '200', 10), 1), 500)
  const uid = await getReaderId(request)

  if (scope === 'mine') {
    if (!uid) return NextResponse.json({ agents: [] })
    const rows = await listAgents({ createdBy: uid, limit })
    return NextResponse.json({ agents: rows })
  }
  if (scope === 'templates') {
    const rows = await listAgents({ isTemplate: true, limit })
    return NextResponse.json({ agents: rows })
  }

  // Default: templates + my agents (union). Templates first.
  const [templates, mine] = await Promise.all([
    listAgents({ isTemplate: true, limit }),
    uid ? listAgents({ createdBy: uid, limit }) : Promise.resolve([]),
  ])
  return NextResponse.json({ agents: [...templates, ...mine] })
}

// ── POST ───────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await requireAuthUserId()
  if (!auth.ok) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }
  const uid = auth.id

  let body: CreateAgentBody
  try {
    body = (await request.json()) as CreateAgentBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const validation = validateCreate(body)
  if ('error' in validation) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const created = await createAgent({
    createdBy: uid,
    name: validation.name,
    persona: validation.persona,
    systemPrompt: validation.systemPrompt,
    modelProvider: validation.modelProvider,
    modelId: validation.modelId,
    style: validation.style,
    avatarSeed: validation.avatarSeed,
    isTemplate: false,
  })

  return NextResponse.json({ agent: created }, { status: 201 })
}

// ── Validation ─────────────────────────────────────────────

type Validated = {
  name: string
  persona: string
  systemPrompt: string | null
  modelProvider: Provider
  modelId: string
  style: AgentStyle
  avatarSeed: string
}

function validateCreate(body: CreateAgentBody): Validated | { error: string } {
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return { error: 'name is required' }
  }
  if (body.name.length > 100) return { error: 'name too long (max 100)' }

  if (typeof body.persona !== 'string' || body.persona.trim().length === 0) {
    return { error: 'persona is required' }
  }
  if (body.persona.length > 4000) return { error: 'persona too long (max 4000)' }

  if (typeof body.modelProvider !== 'string' || !VALID_PROVIDERS.includes(body.modelProvider as Provider)) {
    return { error: `modelProvider must be one of ${VALID_PROVIDERS.join(', ')}` }
  }
  if (typeof body.modelId !== 'string' || body.modelId.trim().length === 0) {
    return { error: 'modelId is required' }
  }
  if (typeof body.avatarSeed !== 'string' || body.avatarSeed.trim().length === 0) {
    return { error: 'avatarSeed is required' }
  }

  let systemPrompt: string | null = null
  if (body.systemPrompt !== undefined && body.systemPrompt !== null) {
    if (typeof body.systemPrompt !== 'string') {
      return { error: 'systemPrompt must be a string' }
    }
    if (body.systemPrompt.length > 8000) return { error: 'systemPrompt too long (max 8000)' }
    systemPrompt = body.systemPrompt.length > 0 ? body.systemPrompt : null
  }

  let style: AgentStyle = {}
  if (body.style !== undefined) {
    if (typeof body.style !== 'object' || body.style === null || Array.isArray(body.style)) {
      return { error: 'style must be an object' }
    }
    style = body.style as AgentStyle
  }

  return {
    name: body.name.trim(),
    persona: body.persona.trim(),
    systemPrompt,
    modelProvider: body.modelProvider as Provider,
    modelId: body.modelId.trim(),
    style,
    avatarSeed: body.avatarSeed.trim(),
  }
}
