// Werewolf hidden-information boundary for /messages and /events:
// seat claims need proof, in-progress gameState is projected per
// viewer, and the raw timeline is owner-only until the game ends.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  snapshot: null as Record<string, unknown> | null,
  messages: [] as Array<{ id: string; channelId: string; timestamp: number }>,
  events: [] as Array<{ index: number; type: string }>,
}))

vi.mock('../../app/lib/supabase-server', () => ({
  getAuthUser: async () => state.user,
}))
vi.mock('../../app/lib/room-store', () => ({
  getRoomSnapshot: async () => state.snapshot,
  getRoom: async () => state.snapshot,
  getMessagesSince: async () => state.messages,
  getEventsSince: async () => state.events,
  getEventCount: async () => state.events.length,
}))

import { GET as getMessages } from '../../app/api/rooms/[id]/messages/route'
import { GET as getEvents } from '../../app/api/rooms/[id]/events/route'
import { signSeatToken } from '../../app/lib/seat-tokens'

const ROOM = 'room-1'
const OWNER = 'owner-uid'
const roleAssignments = { wolf1: 'werewolf', wolf2: 'werewolf', seer1: 'seer', witch1: 'witch', vil1: 'villager' }
const fullGameState = {
  currentPhase: 'witchAction',
  nightNumber: 2,
  eliminatedIds: ['vil1'],
  winResult: null,
  roleMap: roleAssignments,
  lastNightKill: 'seer1',
  witchSaveUsed: false,
  witchPoisonUsed: false,
  witchPoisonTarget: null,
  seerResult: { targetId: 'wolf1', isWerewolf: true },
  guardProtectedId: null,
  guardLastProtectedId: null,
  advancedRules: { guard: false },
}

function werewolfRoom(status = 'running'): Record<string, unknown> {
  return {
    modeId: 'werewolf',
    status,
    createdBy: OWNER,
    // PR #1 stores role-bearing prompts on seats; they must not reach players.
    agents: Object.keys(roleAssignments).map((id) => ({
      id,
      name: id,
      model: 'm',
      provider: 'p',
      isHuman: id === 'wolf1',
      systemPrompt: `YOUR ROLE: ${roleAssignments[id as keyof typeof roleAssignments]}`,
      persona: 'p',
    })),
    roleAssignments,
    gameState: structuredClone(fullGameState),
    currentRound: 1,
    currentPhase: null,
    config: null,
    topic: '',
    tokenSummary: null,
    advancedRules: null,
    thinkingAgentId: null,
    error: null,
  }
}

async function poll(query = '', headers: Record<string, string> = {}) {
  const res = await getMessages(new Request(`http://x/api/rooms/${ROOM}/messages${query}`, { headers }), {
    params: Promise.resolve({ id: ROOM }),
  })
  // Seat checks downgrade to the observer view; they never fail the poll.
  expect(res.status).toBe(200)
  return (await res.json()) as {
    messages: Array<{ channelId: string }>
    agents: Array<Record<string, unknown>>
    roleAssignments: Record<string, string> | null
    gameState: Record<string, unknown> | null
    thinkingAgentId: string | null
    viewerRole: string
  }
}

const channels = (body: { messages: Array<{ channelId: string }> }) =>
  [...new Set(body.messages.map((m) => m.channelId))].sort()

beforeAll(() => {
  process.env.AGORA_SEAT_SECRET = 'test-secret-for-seat-tokens-0123456789abcdef'
})

beforeEach(() => {
  state.user = null
  state.snapshot = werewolfRoom()
  state.messages = [
    { id: 'm1', channelId: 'main', timestamp: 1 },
    { id: 'm2', channelId: 'werewolf', timestamp: 2 },
    { id: 'm3', channelId: 'seer-result', timestamp: 3 },
    { id: 'm4', channelId: 'system', timestamp: 4 },
  ]
  state.events = [
    { index: 0, type: 'message:created' },
    { index: 1, type: 'message:created' },
  ]
})

describe('GET /api/rooms/:id/messages — werewolf visibility', () => {
  it('anonymous observer: public channels, no roles, no roleMap or night state', async () => {
    const body = await poll()
    expect(body.viewerRole).toBe('observer')
    expect(channels(body)).toEqual(['main', 'system'])
    expect(body.roleAssignments).toEqual({})
    expect(body.gameState).toEqual({
      currentPhase: 'witchAction',
      nightNumber: 2,
      eliminatedIds: ['vil1'],
      winResult: null,
      advancedRules: { guard: false },
    })
  })

  it('forged ?seat= without proof stays an observer (was: wolf view)', async () => {
    const body = await poll('?seat=wolf1')
    expect(body.viewerRole).toBe('observer')
    expect(channels(body)).toEqual(['main', 'system'])
    expect(body.roleAssignments).toEqual({})
    expect(body.gameState).not.toHaveProperty('roleMap')
  })

  it('a token for a different seat does not unlock the claimed seat', async () => {
    const token = await signSeatToken({ roomId: ROOM, agentId: 'vil1' })
    const body = await poll('?seat=wolf1', { authorization: `Bearer ${token}` })
    expect(body.viewerRole).toBe('observer')
    expect(channels(body)).toEqual(['main', 'system'])
  })

  it('garbage or expired-looking tokens still get a 200 observer view (polling never stops)', async () => {
    const body = await poll('?seat=wolf1', { authorization: 'Bearer not-a-jwt' })
    expect(body.viewerRole).toBe('observer')
  })

  it('missing AGORA_SEAT_SECRET does not turn a seat claim into an error', async () => {
    const saved = process.env.AGORA_SEAT_SECRET
    delete process.env.AGORA_SEAT_SECRET
    try {
      const body = await poll('?seat=wolf1', { authorization: 'Bearer x.y.z' })
      expect(body.viewerRole).toBe('observer')
    } finally {
      process.env.AGORA_SEAT_SECRET = saved
    }
  })

  it('a token for another room does not unlock the seat', async () => {
    const token = await signSeatToken({ roomId: 'other-room', agentId: 'wolf1' })
    const body = await poll('?seat=wolf1', { authorization: `Bearer ${token}` })
    expect(body.viewerRole).toBe('observer')
  })

  it('guest wolf with a valid seat token: wolf channels + fellow wolves, no roleMap', async () => {
    const token = await signSeatToken({ roomId: ROOM, agentId: 'wolf1' })
    const body = await poll('?seat=wolf1', { authorization: `Bearer ${token}` })
    expect(body.viewerRole).toBe('werewolf')
    expect(channels(body)).toEqual(['main', 'system', 'werewolf'])
    expect(body.roleAssignments).toEqual({ wolf1: 'werewolf', wolf2: 'werewolf' })
    expect(body.gameState).not.toHaveProperty('roleMap')
    expect(body.gameState).not.toHaveProperty('seerResult')
    expect(body.gameState?.['lastNightKill']).toBe('seer1')
  })

  it('guest witch keeps the fields the witch panel reads', async () => {
    const token = await signSeatToken({ roomId: ROOM, agentId: 'witch1' })
    const body = await poll('?seat=witch1', { authorization: `Bearer ${token}` })
    expect(body.viewerRole).toBe('witch')
    expect(body.roleAssignments).toEqual({ witch1: 'witch' })
    expect(body.gameState).toMatchObject({ lastNightKill: 'seer1', witchSaveUsed: false, witchPoisonUsed: false })
    expect(body.gameState).not.toHaveProperty('seerResult')
  })

  it('observers and players never get seat systemPrompt/persona', async () => {
    const token = await signSeatToken({ roomId: ROOM, agentId: 'wolf1' })
    for (const body of [await poll(), await poll('?seat=wolf1', { authorization: `Bearer ${token}` })]) {
      expect(body.agents).toHaveLength(5)
      for (const agent of body.agents) {
        expect(Object.keys(agent).sort()).toEqual(
          ['id', 'isHuman', 'model', 'name', 'provider'].sort(),
        )
      }
      expect(JSON.stringify(body)).not.toContain('YOUR ROLE')
    }
  })

  it('lobby: a guest with a seat token sees the shared ready state', async () => {
    state.snapshot = werewolfRoom('lobby')
    ;(state.snapshot['gameState'] as Record<string, unknown>)['seatReady'] = { wolf1: true, vil1: false }
    const token = await signSeatToken({ roomId: ROOM, agentId: 'wolf1' })
    const body = await poll('?seat=wolf1', { authorization: `Bearer ${token}` })
    expect(body.gameState?.['seatReady']).toEqual({ wolf1: true, vil1: false })
    expect((await poll()).gameState?.['seatReady']).toEqual({ wolf1: true, vil1: false })
  })

  it('owner without a seat is the spectator: everything (unchanged)', async () => {
    state.user = { id: OWNER }
    const body = await poll()
    expect(body.viewerRole).toBe('spectator')
    expect(channels(body)).toEqual(['main', 'seer-result', 'system', 'werewolf'])
    expect(body.roleAssignments).toEqual(roleAssignments)
    expect(body.gameState).toEqual(fullGameState)
    expect(body.agents[0]?.['systemPrompt']).toBe('YOUR ROLE: werewolf')
  })

  it('owner on their own seat (no token) gets that seat\'s player view (unchanged)', async () => {
    state.user = { id: OWNER }
    const body = await poll('?seat=seer1')
    expect(body.viewerRole).toBe('seer')
    expect(channels(body)).toEqual(['main', 'seer-result', 'system'])
    expect(body.roleAssignments).toEqual({ seer1: 'seer' })
    expect(body.gameState?.['seerResult']).toEqual({ targetId: 'wolf1', isWerewolf: true })
  })

  it('completed game: full reveal of roles and gameState for everyone (unchanged)', async () => {
    state.snapshot = werewolfRoom('completed')
    const body = await poll()
    expect(body.roleAssignments).toEqual(roleAssignments)
    expect(body.gameState).toEqual(fullGameState)
    expect(body.agents[0]?.['systemPrompt']).toBe('YOUR ROLE: werewolf')
  })

  describe('night thinkingAgentId', () => {
    const seatPoll = async (seat: string) => {
      const token = await signSeatToken({ roomId: ROOM, agentId: seat })
      return poll(`?seat=${seat}`, { authorization: `Bearer ${token}` })
    }
    const atPhase = (phase: string, thinking: string | null) => {
      ;(state.snapshot!['gameState'] as Record<string, unknown>)['currentPhase'] = phase
      state.snapshot!['thinkingAgentId'] = thinking
    }

    it('wolf phase: observers and non-wolves get the night placeholder, wolves see the seat', async () => {
      atPhase('wolfDiscuss', 'wolf2')
      expect((await poll()).thinkingAgentId).toBe('night')
      expect((await poll('?seat=wolf2')).thinkingAgentId).toBe('night') // unproven claim
      expect((await seatPoll('seer1')).thinkingAgentId).toBe('night')
      expect((await seatPoll('wolf1')).thinkingAgentId).toBe('wolf2')
    })

    it('witch phase: only the witch sees the acting seat, even when no one is acting', async () => {
      atPhase('witchAction', 'witch1')
      expect((await seatPoll('wolf1')).thinkingAgentId).toBe('night')
      expect((await seatPoll('witch1')).thinkingAgentId).toBe('witch1')
      atPhase('witchAction', null)
      expect((await seatPoll('vil1')).thinkingAgentId).toBe('night')
    })

    it('seer phase: hidden from everyone but the seer', async () => {
      atPhase('seerCheck', 'seer1')
      expect((await seatPoll('vil1')).thinkingAgentId).toBe('night')
      expect((await seatPoll('seer1')).thinkingAgentId).toBe('seer1')
    })

    it('day phases, the spectator owner and finished games keep the real seat', async () => {
      atPhase('dayDiscuss', 'vil1')
      expect((await poll()).thinkingAgentId).toBe('vil1')
      atPhase('wolfVote', 'wolf2')
      state.user = { id: OWNER }
      expect((await poll()).thinkingAgentId).toBe('wolf2')
      state.user = null
      state.snapshot!['status'] = 'completed'
      expect((await poll()).thinkingAgentId).toBe('wolf2')
    })
  })

  it('non-werewolf rooms are unfiltered (unchanged)', async () => {
    state.snapshot = { ...werewolfRoom(), modeId: 'open-chat', gameState: { waitingForHuman: 'a1', x: 1 } }
    const body = await poll()
    expect(body.viewerRole).toBe('spectator')
    expect(body.gameState).toEqual({ waitingForHuman: 'a1', x: 1 })
  })
})

describe('GET /api/rooms/:id/events — werewolf timeline', () => {
  const fetchEvents = async () => {
    const res = await getEvents(new Request(`http://x/api/rooms/${ROOM}/events`), {
      params: Promise.resolve({ id: ROOM }),
    })
    return (await res.json()) as { events: unknown[]; total: number; status: string }
  }

  it('in-progress game: non-owner gets an empty page with the same shape', async () => {
    const body = await fetchEvents()
    expect(body).toEqual({ events: [], total: 0, status: 'running' })
  })

  it('in-progress game: owner gets the full timeline (unchanged)', async () => {
    state.user = { id: OWNER }
    expect((await fetchEvents()).events).toHaveLength(2)
  })

  it('completed game: anyone gets the full timeline for replay (unchanged)', async () => {
    state.snapshot = werewolfRoom('completed')
    const body = await fetchEvents()
    expect(body.events).toHaveLength(2)
    expect(body.total).toBe(2)
  })

  it('non-werewolf rooms: anyone gets the timeline (unchanged)', async () => {
    state.snapshot = { ...werewolfRoom(), modeId: 'roundtable' }
    expect((await fetchEvents()).events).toHaveLength(2)
  })
})
