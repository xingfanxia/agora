// GET /api/agents/:id — templates public, private agents only for
// the identity that lists them under "mine".

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  agent: null as Record<string, unknown> | null,
}))

vi.mock('../../app/lib/supabase-server', () => ({ getAuthUser: async () => state.user }))
vi.mock('../../app/lib/agent-store', () => ({
  getAgent: async () => state.agent,
  listAgents: async (q: { createdBy?: string; isTemplate?: boolean }) =>
    q.createdBy === 'owner-uid' ? [{ id: 'a1', createdBy: 'owner-uid' }] : [],
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
}))

import { GET } from '../../app/api/agents/[id]/route'
import { GET as listAgentsRoute } from '../../app/api/agents/route'

async function read(cookie?: string) {
  const req = new NextRequest('http://x/api/agents/a1', { headers: cookie ? { cookie } : {} })
  return GET(req, { params: Promise.resolve({ id: 'a1' }) })
}

beforeEach(() => {
  state.user = null
  state.agent = { id: 'a1', isTemplate: false, createdBy: 'owner-uid', systemPrompt: 'secret' }
})

describe('GET /api/agents/:id', () => {
  it('template agents stay public', async () => {
    state.agent = { id: 'a1', isTemplate: true, createdBy: null, systemPrompt: 'tpl' }
    expect((await read()).status).toBe(200)
  })

  it('anonymous caller cannot read a private agent', async () => {
    const res = await read()
    expect(res.status).toBe(404)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })

  it('another signed-in user cannot read a private agent', async () => {
    state.user = { id: 'someone-else' }
    expect((await read()).status).toBe(404)
  })

  it('the owner (session) can read it', async () => {
    state.user = { id: 'owner-uid' }
    const res = await read()
    expect(res.status).toBe(200)
    expect(((await res.json()) as { agent: { systemPrompt: string } }).agent.systemPrompt).toBe('secret')
  })

  it('missing agent is 404 (unchanged)', async () => {
    state.agent = null
    expect((await read()).status).toBe(404)
  })

  it('a forged legacy agora-uid cookie for the owner id is not an identity', async () => {
    expect((await read('agora-uid=owner-uid')).status).toBe(404)
  })
})

describe('GET /api/agents?scope=mine', () => {
  const list = async (cookie?: string) => {
    const req = new NextRequest('http://x/api/agents?scope=mine', { headers: cookie ? { cookie } : {} })
    return ((await (await listAgentsRoute(req)).json()) as { agents: unknown[] }).agents
  }
  it('forged agora-uid cookie lists nothing', async () => {
    expect(await list('agora-uid=owner-uid')).toEqual([])
  })
  it('owner session lists own agents (unchanged)', async () => {
    state.user = { id: 'owner-uid' }
    expect(await list()).toHaveLength(1)
  })
})
