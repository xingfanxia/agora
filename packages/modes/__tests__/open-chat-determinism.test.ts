// ============================================================
// Open-chat — determinism tests
// ============================================================
//
// Open-chat is a pure transformation from (agents, leaderId) → ordered
// roster + RoundRobinFlow. No PRNG, no role shuffle — so "determinism"
// here means: same config → identical ordered ids + same flow state.

import { describe, expect, it } from 'vitest'
import type { GenerateFn } from '@agora/core'
import type { ModelConfig } from '@agora/shared'
import { createOpenChat, type OpenChatAgentConfig } from '../src/open-chat/index.js'

const stubGenerate: GenerateFn = async () => ({
  content: '',
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
  },
})

const makeGenFn = (_model: ModelConfig) => stubGenerate

const sampleAgents = (ids = ['a-1', 'a-2', 'a-3']): OpenChatAgentConfig[] =>
  ids.map((id) => ({
    id,
    name: id,
    persona: `persona for ${id}`,
    systemPrompt: `prompt for ${id}`,
    model: { provider: 'anthropic', modelId: 'claude-opus-4-7', maxTokens: 1024 },
  }))

describe('createOpenChat determinism', () => {
  it('preserves config order when no leader is set', () => {
    const result = createOpenChat(
      { agents: sampleAgents(['a', 'b', 'c']), topic: 't', roomId: 'room-1' },
      makeGenFn,
    )
    expect([...result.orderedAgentIds]).toEqual(['a', 'b', 'c'])
  })

  it('places leader at index 0 when set', () => {
    const result = createOpenChat(
      {
        agents: sampleAgents(['a', 'b', 'c']),
        topic: 't',
        roomId: 'room-1',
        leaderAgentId: 'b',
      },
      makeGenFn,
    )
    expect([...result.orderedAgentIds]).toEqual(['b', 'a', 'c'])
  })

  it('keeps others in config order when leader extracted', () => {
    const result = createOpenChat(
      {
        agents: sampleAgents(['alpha', 'beta', 'gamma', 'delta']),
        topic: 't',
        roomId: 'room-1',
        leaderAgentId: 'gamma',
      },
      makeGenFn,
    )
    expect([...result.orderedAgentIds]).toEqual(['gamma', 'alpha', 'beta', 'delta'])
  })

  it('is idempotent: same config → same ordered ids on repeat call', () => {
    const config = {
      agents: sampleAgents(['x', 'y', 'z']),
      topic: 't',
      roomId: 'room-42',
      leaderAgentId: 'y',
    }
    const first = createOpenChat(config, makeGenFn)
    const second = createOpenChat({ ...config, roomId: 'room-43' }, makeGenFn) // different roomId should not reorder
    expect([...first.orderedAgentIds]).toEqual([...second.orderedAgentIds])
  })

  it('defaults rounds to 3, clamps out-of-range', () => {
    const r1 = createOpenChat(
      { agents: sampleAgents(), topic: 't', roomId: 'r-1' },
      makeGenFn,
    )
    expect(r1.rounds).toBe(3)

    const r2 = createOpenChat(
      { agents: sampleAgents(), topic: 't', roomId: 'r-2', rounds: 0 },
      makeGenFn,
    )
    expect(r2.rounds).toBe(1)

    const r3 = createOpenChat(
      { agents: sampleAgents(), topic: 't', roomId: 'r-3', rounds: 99 },
      makeGenFn,
    )
    expect(r3.rounds).toBe(10)

    const r4 = createOpenChat(
      { agents: sampleAgents(), topic: 't', roomId: 'r-4', rounds: 5 },
      makeGenFn,
    )
    expect(r4.rounds).toBe(5)
  })

  it('rejects empty roster', () => {
    expect(() =>
      createOpenChat({ agents: [], topic: 't', roomId: 'r' }, makeGenFn),
    ).toThrow(/at least one agent/)
  })

  it('rejects roster >12', () => {
    const twelve = sampleAgents(Array.from({ length: 13 }, (_, i) => `a-${i}`))
    expect(() =>
      createOpenChat({ agents: twelve, topic: 't', roomId: 'r' }, makeGenFn),
    ).toThrow(/at most 12 agents/)
  })

  it('ignores a leaderAgentId that is not in the roster (defensive fallback)', () => {
    const result = createOpenChat(
      {
        agents: sampleAgents(['a', 'b']),
        topic: 't',
        roomId: 'r',
        leaderAgentId: 'ghost',
      },
      makeGenFn,
    )
    expect([...result.orderedAgentIds]).toEqual(['a', 'b'])
  })

  it('RoundRobinFlow ticks deterministically from ordered ids', () => {
    const { flow, orderedAgentIds } = createOpenChat(
      {
        agents: sampleAgents(['a', 'b', 'c']),
        topic: 't',
        roomId: 'r',
        leaderAgentId: 'c',
        rounds: 2,
      },
      makeGenFn,
    )
    flow.initialize([...orderedAgentIds])

    const speakers: string[] = []
    while (!flow.isComplete()) {
      const t = flow.tick()
      if (t.isComplete) break
      speakers.push(t.nextSpeakers[0]!)
    }
    // Round 1: c, a, b. Round 2: c, a, b.
    expect(speakers).toEqual(['c', 'a', 'b', 'c', 'a', 'b'])
  })
})
