// ============================================================
// Tests — Werewolf factory determinism
// ============================================================
//
// Phase 4.5a requirement: given the same seed + inputs, createWerewolf
// must produce identical roomId, agentIds, and roleAssignments. This
// is what lets room-runtime rehydrate in-memory game objects from DB
// state during a tick (no roleMap persistence needed beyond the
// denormalized snapshot).

import { describe, expect, it } from 'vitest'
import {
  createSeededPrng,
  seededShuffle,
  seededUuid,
  seededUuidList,
} from '@agora/shared'
import { createWerewolf } from '../src/werewolf/index.js'
import type { WerewolfAgentConfig } from '../src/werewolf/index.js'

// ── No-op LLM stubs ────────────────────────────────────────

const stubGen = () =>
  async () => ({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } })
const stubObj = () =>
  async () => ({ object: {}, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } })

function makeAgents(n: number): WerewolfAgentConfig[] {
  const models = Array.from({ length: n }, (_, i) => ({
    provider: 'anthropic' as const,
    modelId: 'claude-opus-4-7',
    maxTokens: 1500,
  }))
  return models.map((m, i) => ({ name: `P${i}`, model: m }))
}

// ── Seeded PRNG primitives ─────────────────────────────────

describe('seeded primitives', () => {
  it('createSeededPrng is deterministic per seed', () => {
    const a = createSeededPrng('room-abc')
    const b = createSeededPrng('room-abc')
    const seq1 = Array.from({ length: 10 }, () => a())
    const seq2 = Array.from({ length: 10 }, () => b())
    expect(seq1).toEqual(seq2)
  })

  it('createSeededPrng diverges across different seeds', () => {
    const a = createSeededPrng('room-abc')
    const b = createSeededPrng('room-xyz')
    const seq1 = Array.from({ length: 10 }, () => a())
    const seq2 = Array.from({ length: 10 }, () => b())
    expect(seq1).not.toEqual(seq2)
  })

  it('seededShuffle is deterministic and non-mutating', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const prng1 = createSeededPrng('shuffle-seed')
    const prng2 = createSeededPrng('shuffle-seed')
    const shuffled1 = seededShuffle(prng1, input)
    const shuffled2 = seededShuffle(prng2, input)
    expect(shuffled1).toEqual(shuffled2)
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) // source not mutated
    expect(shuffled1.sort()).toEqual(input.slice().sort()) // contents preserved
  })

  it('seededUuid returns a v4-shaped lowercase string', () => {
    const id = seededUuid('room-1', 'agent:0')
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('seededUuid is deterministic per (seed, salt)', () => {
    expect(seededUuid('s', 'a')).toBe(seededUuid('s', 'a'))
    expect(seededUuid('s', 'a')).not.toBe(seededUuid('s', 'b'))
  })

  it('seededUuidList returns N distinct ids for N distinct salts', () => {
    const ids = seededUuidList('room-1', 9)
    expect(ids).toHaveLength(9)
    expect(new Set(ids).size).toBe(9)
  })

  it('seededShuffle handles empty + single-element arrays', () => {
    const prng = createSeededPrng('edge')
    expect(seededShuffle(prng, [])).toEqual([])
    expect(seededShuffle(prng, ['only'])).toEqual(['only'])
  })

  it('seededUuid coerces number salt to string (0 and "0" match)', () => {
    expect(seededUuid('seed', 0)).toBe(seededUuid('seed', '0'))
  })
})

// ── createWerewolf factory determinism ─────────────────────

describe('createWerewolf determinism', () => {
  it('produces identical roomId for same seed', () => {
    const agents = makeAgents(9)
    const r1 = createWerewolf({ agents, seed: 'same-seed' }, stubGen, stubObj)
    const r2 = createWerewolf({ agents, seed: 'same-seed' }, stubGen, stubObj)
    expect(r1.room.config.id).toBe(r2.room.config.id)
  })

  it('produces identical agentIds for same seed (order-preserved)', () => {
    const agents = makeAgents(9)
    const r1 = createWerewolf({ agents, seed: 'seed-a' }, stubGen, stubObj)
    const r2 = createWerewolf({ agents, seed: 'seed-a' }, stubGen, stubObj)
    const ids1 = r1.room.getAgentIds()
    const ids2 = r2.room.getAgentIds()
    expect(ids1).toEqual(ids2)
  })

  it('produces identical roleAssignments for same seed', () => {
    const agents = makeAgents(12)
    const r1 = createWerewolf(
      { agents, seed: 'seed-b', advancedRules: { guard: true, lastWords: true } },
      stubGen,
      stubObj,
    )
    const r2 = createWerewolf(
      { agents, seed: 'seed-b', advancedRules: { guard: true, lastWords: true } },
      stubGen,
      stubObj,
    )
    expect(r1.roleAssignments).toEqual(r2.roleAssignments)
  })

  it('different seeds produce different roleAssignments', () => {
    const agents = makeAgents(9)
    const r1 = createWerewolf({ agents, seed: 'seed-one' }, stubGen, stubObj)
    const r2 = createWerewolf({ agents, seed: 'seed-two' }, stubGen, stubObj)
    // Role assignments map from different agentIds (seed-derived) so direct
    // compare doesn't work; compare by-position via agent name.
    const byName1 = Object.fromEntries(
      r1.room.getAgentIds().map((id) => [r1.agentNames[id], r1.roleAssignments[id]]),
    )
    const byName2 = Object.fromEntries(
      r2.room.getAgentIds().map((id) => [r2.agentNames[id], r2.roleAssignments[id]]),
    )
    expect(byName1).not.toEqual(byName2)
  })

  it('honors pre-generated agentIds when provided', () => {
    const agents = makeAgents(6)
    const customIds = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000005',
      '00000000-0000-4000-8000-000000000006',
    ]
    const r = createWerewolf(
      { agents, seed: 'any-seed', agentIds: customIds },
      stubGen,
      stubObj,
    )
    expect(r.room.getAgentIds()).toEqual(customIds)
  })

  it('throws when agentIds length mismatches agents length', () => {
    const agents = makeAgents(6)
    expect(() =>
      createWerewolf(
        { agents, seed: 's', agentIds: ['one-id'] },
        stubGen,
        stubObj,
      ),
    ).toThrow(/agentIds.length/)
  })

  it('without seed, falls back to non-deterministic (roomIds differ across calls)', () => {
    const agents = makeAgents(6)
    const r1 = createWerewolf({ agents }, stubGen, stubObj)
    const r2 = createWerewolf({ agents }, stubGen, stubObj)
    expect(r1.room.config.id).not.toBe(r2.room.config.id)
  })

  it('honors explicit roomId override even when seed is set', () => {
    const agents = makeAgents(6)
    const explicitId = '11111111-1111-4111-8111-111111111111'
    const r = createWerewolf(
      { agents, seed: 'seed', roomId: explicitId },
      stubGen,
      stubObj,
    )
    expect(r.room.config.id).toBe(explicitId)
  })

  it('rehydration: (agentIds from DB, seed=roomId) gives same roleMap as original (seed-only) run', () => {
    // First run: seed generates ids + shuffle
    const agents = makeAgents(9)
    const original = createWerewolf({ agents, seed: 'rehydrate-test' }, stubGen, stubObj)
    const originalIds = original.room.getAgentIds()

    // Rehydrate: same seed, explicit agentIds from DB (simulating loadRoomState)
    const rehydrated = createWerewolf(
      { agents, seed: 'rehydrate-test', agentIds: originalIds, roomId: original.room.config.id },
      stubGen,
      stubObj,
    )

    expect(rehydrated.room.config.id).toBe(original.room.config.id)
    expect(rehydrated.room.getAgentIds()).toEqual(originalIds)
    expect(rehydrated.roleAssignments).toEqual(original.roleAssignments)
  })
})
