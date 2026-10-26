// Room creation from a teamId copies member persona/systemPrompt into the
// room, so it must apply the same owner-or-template rule as GET /teams/:id.
// Downstream steps are stubbed so a request that passes the gate stops at
// a recognisable 400 instead of creating anything.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  team: null as Record<string, unknown> | null,
}))

vi.mock('../../app/lib/supabase-server', () => ({ getAuthUser: async () => state.user }))
vi.mock('../../app/lib/team-store', () => ({
  getTeam: async () => state.team,
  getMembers: async () => [],
}))
vi.mock('../../app/lib/team-room', () => ({
  buildTeamSnapshot: async () => ({ agents: [], leaderAgentId: null }),
}))
vi.mock('../../app/lib/language', () => ({
  resolveAgentLanguage: async () => 'zh',
  buildLanguageDirective: () => '',
}))
vi.mock('../../app/lib/room-store', () => ({
  createRoom: vi.fn(),
  setGameState: vi.fn(),
  updateRoomStatus: vi.fn(),
  listCompletedRooms: vi.fn(),
}))
vi.mock('workflow/api', () => ({ start: vi.fn() }))
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }))

import { POST as createRoundtable } from '../../app/api/rooms/route'
import { POST as createOpenChat } from '../../app/api/rooms/open-chat/route'
import { POST as createWerewolf } from '../../app/api/rooms/werewolf/route'

const routes = [
  ['roundtable', createRoundtable, { topic: 't', rounds: 2, teamId: 'team-a' }, 'Team needs at least 2 members'],
  ['open-chat', createOpenChat, { topic: 't', teamId: 'team-a' }, 'Team has no members'],
  ['werewolf', createWerewolf, { teamId: 'team-a' }, 'werewolf requires 6-12'],
] as const

function post(body: unknown, cookie?: string) {
  return new NextRequest('http://x/api/rooms', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  })
}

beforeEach(() => {
  state.user = null
  state.team = { id: 'team-a', isTemplate: false, createdBy: 'user-a', name: 'A' }
})

describe.each(routes)('POST create %s from a teamId', (_mode, POST, body, passedGateError) => {
  it("another signed-in user cannot use A's private team (404 like a missing team)", async () => {
    state.user = { id: 'user-b', email: 'b@x' }
    const res = await POST(post(body))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Team not found' })
  })

  it('a forged legacy agora-uid cookie is not an identity', async () => {
    state.user = { id: 'user-b', email: 'b@x' }
    const res = await POST(post(body, 'agora-uid=user-a'))
    expect(res.status).toBe(404)
  })

  it('the owner passes the team gate (unchanged)', async () => {
    state.user = { id: 'user-a', email: 'a@x' }
    const res = await POST(post(body))
    expect(JSON.stringify(await res.json())).toContain(passedGateError)
  })

  it('anyone signed in can use a template team (unchanged)', async () => {
    state.user = { id: 'user-b', email: 'b@x' }
    state.team = { id: 'team-a', isTemplate: true, createdBy: null, name: 'T' }
    const res = await POST(post(body))
    expect(JSON.stringify(await res.json())).toContain(passedGateError)
  })
})
