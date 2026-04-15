// ============================================================
// GET    /api/agents/[id]   — fetch one (anyone can read templates + own)
// PATCH  /api/agents/[id]   — update (owner only, not templates)
// DELETE /api/agents/[id]   — delete (owner only, not templates)
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import {
  deleteAgent,
  getAgent,
  updateAgent,
  type AgentStyle,
  type UpdateAgentArgs,
} from '../../../lib/agent-store'
import { getUserIdFromRequest } from '../../../lib/user-id'

export const dynamic = 'force-dynamic'

interface RouteCtx {
  params: Promise<{ id: string }>
}

// ── GET ────────────────────────────────────────────────────

export async function GET(_request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const agent = await getAgent(id)
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ agent })
}

// ── PATCH ──────────────────────────────────────────────────

export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const uid = getUserIdFromRequest(request)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await getAgent(id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Templates are read-only to everyone in V1.
  if (existing.isTemplate) {
    return NextResponse.json({ error: 'Templates are read-only' }, { status: 403 })
  }
  if (existing.createdBy !== uid) {
    return NextResponse.json({ error: 'Not owner' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const patch: UpdateAgentArgs = {}

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'name must be non-empty string' }, { status: 400 })
    }
    patch.name = body.name.trim()
  }
  if (body.persona !== undefined) {
    if (typeof body.persona !== 'string' || body.persona.length > 4000) {
      return NextResponse.json({ error: 'persona invalid' }, { status: 400 })
    }
    patch.persona = body.persona.trim()
  }
  if (body.systemPrompt !== undefined) {
    if (body.systemPrompt === null) {
      patch.systemPrompt = null
    } else if (typeof body.systemPrompt === 'string') {
      if (body.systemPrompt.length > 8000) {
        return NextResponse.json({ error: 'systemPrompt too long' }, { status: 400 })
      }
      patch.systemPrompt = body.systemPrompt.length > 0 ? body.systemPrompt : null
    } else {
      return NextResponse.json({ error: 'systemPrompt invalid' }, { status: 400 })
    }
  }
  if (body.modelProvider !== undefined) {
    if (typeof body.modelProvider !== 'string') {
      return NextResponse.json({ error: 'modelProvider invalid' }, { status: 400 })
    }
    patch.modelProvider = body.modelProvider
  }
  if (body.modelId !== undefined) {
    if (typeof body.modelId !== 'string' || body.modelId.trim().length === 0) {
      return NextResponse.json({ error: 'modelId invalid' }, { status: 400 })
    }
    patch.modelId = body.modelId.trim()
  }
  if (body.avatarSeed !== undefined) {
    if (typeof body.avatarSeed !== 'string' || body.avatarSeed.trim().length === 0) {
      return NextResponse.json({ error: 'avatarSeed invalid' }, { status: 400 })
    }
    patch.avatarSeed = body.avatarSeed.trim()
  }
  if (body.style !== undefined) {
    if (typeof body.style !== 'object' || body.style === null || Array.isArray(body.style)) {
      return NextResponse.json({ error: 'style must be an object' }, { status: 400 })
    }
    patch.style = body.style as AgentStyle
  }

  const updated = await updateAgent(id, patch)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ agent: updated })
}

// ── DELETE ─────────────────────────────────────────────────

export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  const { id } = await ctx.params
  const uid = getUserIdFromRequest(request)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await getAgent(id)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.isTemplate) {
    return NextResponse.json({ error: 'Templates are read-only' }, { status: 403 })
  }
  if (existing.createdBy !== uid) {
    return NextResponse.json({ error: 'Not owner' }, { status: 403 })
  }

  const ok = await deleteAgent(id)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ deleted: true })
}
