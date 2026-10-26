// GET /api/teams/:id and /api/teams/:id/members — templates public,
// private teams only for the identity that lists them under "mine".

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  team: null as Record<string, unknown> | null,
}))

vi.mock('../../app/lib/supabase-server', () => ({ getAuthUser: async () => state.user }))
vi.mock('../../app/lib/team-store', () => ({
  getTeam: async () => state.team,
  getTeamWithMembers: async () => (state.team ? { team: state.team, members: [{ agentId: 'a1' }] } : null),
  getMembers: async () => [{ agentId: 'a1' }],
  updateTeam: vi.fn(),
  deleteTeam: vi.fn(),
  addMember: vi.fn(),
  setMembers: vi.fn(),
}))
vi.mock('../../app/lib/agent-store', () => ({ getAgents: vi.fn() }))

import { GET as getTeamRoute } from '../../app/api/teams/[id]/route'
import { GET as getMembersRoute } from '../../app/api/teams/[id]/members/route'

const req = (cookie?: string) =>
  new NextRequest('http://x/api/teams/t1', { headers: cookie ? { cookie } : {} })
const ctx = { params: Promise.resolve({ id: 't1' }) }

beforeEach(() => {
  state.user = null
  state.team = { id: 't1', isTemplate: false, createdBy: 'owner-uid' }
})

describe.each([
  ['GET /api/teams/:id', getTeamRoute],
  ['GET /api/teams/:id/members', getMembersRoute],
])('%s', (_name, GET) => {
  it('template teams stay public', async () => {
    state.team = { id: 't1', isTemplate: true, createdBy: null }
    expect((await GET(req(), ctx)).status).toBe(200)
  })
  it('anonymous caller gets 404 for a private team', async () => {
    expect((await GET(req(), ctx)).status).toBe(404)
  })
  it('another signed-in user gets 404', async () => {
    state.user = { id: 'other' }
    expect((await GET(req(), ctx)).status).toBe(404)
  })
  it('owner session reads it', async () => {
    state.user = { id: 'owner-uid' }
    expect((await GET(req(), ctx)).status).toBe(200)
  })
  it('a forged legacy agora-uid cookie for the owner id is not an identity', async () => {
    expect((await GET(req('agora-uid=owner-uid'), ctx)).status).toBe(404)
  })
  it('missing team is 404 (unchanged)', async () => {
    state.team = null
    expect((await GET(req(), ctx)).status).toBe(404)
  })
})
