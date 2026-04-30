// ============================================================
// Phase 4.5d-2.13 -- werewolf workflow skeleton helpers
// ============================================================
//
// Same shape as roundtable-workflow.test.ts and
// open-chat-workflow.test.ts: pin deterministic message-id format
// + hook-token format + the lifted vote-tally helper. These are
// the contracts 2.14-2.16 phase steps depend on; pinning them in a
// unit test means a format drift trips a clear failure here rather
// than a silent idempotency break in production.
//
// applyFallback's contract (registry lookup) is also pinned --
// 2.14-2.16 phase fallback adapters call it to get a FallbackAction
// for the current phase; if the registry ever loses an entry, those
// adapters silently throw at runtime.

import { describe, it, expect } from 'vitest'
import {
  deriveWerewolfMessageId,
  werewolfDayVoteToken,
  tallyVotes,
  applyFallback,
  aliveIds,
  aliveIdsByRole,
  nameToIdMap,
  allAliveNames,
  aliveNonWolfNames,
  aliveNamesExcluding,
  cycleId,
  type WerewolfPersistedState,
} from '../../app/workflows/werewolf-workflow.js'

// ── Test fixture ───────────────────────────────────────────
//
// 6-player baseline: 2 wolves, 1 seer, 1 witch, 2 villagers. agentNames
// are stable across tests so assertions can name them directly. The
// minimum size matches the workflow's 6..12 validation floor.

const MOCK_STATE: WerewolfPersistedState = {
  currentPhase: 'wolfDiscuss',
  roleMap: {
    'a-1': 'werewolf',
    'a-2': 'werewolf',
    'a-3': 'seer',
    'a-4': 'witch',
    'a-5': 'villager',
    'a-6': 'villager',
  },
  agentNames: {
    'a-1': 'Wolf1',
    'a-2': 'Wolf2',
    'a-3': 'Seer',
    'a-4': 'Witch',
    'a-5': 'Villager1',
    'a-6': 'Villager2',
  },
  activeAgentIds: ['a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6'],
  eliminatedIds: [],
  lastNightKill: null,
  witchSaveUsed: false,
  witchPoisonUsed: false,
  witchPoisonTarget: null,
  witchUsedPotionTonight: false,
  seerResult: null,
  nightNumber: 1,
  hunterCanShoot: false,
  hunterPendingId: null,
  hunterShotTarget: null,
  guardProtectedId: null,
  guardLastProtectedId: null,
  idiotRevealedIds: [],
  sheriffId: null,
  sheriffElected: false,
  pendingLastWordsIds: [],
  winResult: null,
  advancedRules: {},
}

// ── deriveWerewolfMessageId ────────────────────────────────

describe('deriveWerewolfMessageId', () => {
  it('produces the same id for the same (phaseTag, roomId, cycleId, agentId)', () => {
    const a = deriveWerewolfMessageId('wd', 'room-uuid-1', 'd1', 'agent-uuid-A')
    const b = deriveWerewolfMessageId('wd', 'room-uuid-1', 'd1', 'agent-uuid-A')
    expect(a).toBe(b)
  })

  it('matches the ww-${phaseTag}-${roomId}-${cycleId}-${agentId} format', () => {
    // Pinning the literal format. The events_message_id_uq partial
    // UNIQUE index keys on payload->'message'->>'id' as text. A
    // format change without a coordinated index migration would
    // silently break idempotency for in-flight rooms (legacy events
    // have the old format, new events have the new format, the
    // index keys both as text -> no collision -> no dedupe).
    expect(
      deriveWerewolfMessageId('wd', 'room-uuid-1', 'd1', 'agent-uuid-A'),
    ).toBe('ww-wd-room-uuid-1-d1-agent-uuid-A')
  })

  it('namespaces away from rt- and oc-', () => {
    // Belt-and-suspenders against an accidental refactor that drops
    // the ww- prefix. The whole point of the prefix is to prevent
    // werewolf events from ever colliding with roundtable's rt-foo
    // or open-chat's oc-foo on events_message_id_uq.
    const id = deriveWerewolfMessageId('wd', 'r', 'c', 'a')
    expect(id.startsWith('ww-')).toBe(true)
    expect(id.startsWith('rt-')).toBe(false)
    expect(id.startsWith('oc-')).toBe(false)
  })

  it('produces different ids when any of the four inputs differ', () => {
    const baseline = deriveWerewolfMessageId('wd', 'room-1', 'd1', 'agent-A')
    const otherPhase = deriveWerewolfMessageId('wv', 'room-1', 'd1', 'agent-A')
    const otherRoom = deriveWerewolfMessageId('wd', 'room-2', 'd1', 'agent-A')
    const otherCycle = deriveWerewolfMessageId('wd', 'room-1', 'd2', 'agent-A')
    const otherAgent = deriveWerewolfMessageId('wd', 'room-1', 'd1', 'agent-B')
    expect(baseline).not.toBe(otherPhase)
    expect(baseline).not.toBe(otherRoom)
    expect(baseline).not.toBe(otherCycle)
    expect(baseline).not.toBe(otherAgent)
  })
})

// ── werewolfDayVoteToken ───────────────────────────────────

describe('werewolfDayVoteToken', () => {
  it('matches the documented hook-token format', () => {
    // LOAD-BEARING: the human-input endpoint reconstructs this exact
    // string from URL params and calls resumeHook. A format change
    // without coordinated callers silently drops human votes on the
    // floor (resumeHook returns HookNotFoundError but the workflow
    // body's `await hook` keeps blocking until the sleep grace window
    // fires fallback -- so the human's vote vanishes, and they think
    // they voted but the game registers them as abstaining).
    expect(werewolfDayVoteToken('room-uuid', 1, 'seat-uuid')).toBe(
      'agora/room/room-uuid/mode/werewolf-day-vote/night/1/seat/seat-uuid',
    )
  })

  it('namespaces under mode/ so other werewolf phases can drop in', () => {
    // The `mode/werewolf-day-vote/` segment is hand-picked so a
    // future `mode/werewolf-witch-action/` token can coexist without
    // collision. Pinning the prefix guards against an accidental
    // rename that would un-namespace the current token.
    const t = werewolfDayVoteToken('r', 1, 's')
    expect(t).toContain('/mode/werewolf-day-vote/')
  })

  it('differs across (roomId, nightNumber, seatId)', () => {
    const baseline = werewolfDayVoteToken('r1', 1, 's1')
    const otherRoom = werewolfDayVoteToken('r2', 1, 's1')
    const otherNight = werewolfDayVoteToken('r1', 2, 's1')
    const otherSeat = werewolfDayVoteToken('r1', 1, 's2')
    expect(baseline).not.toBe(otherRoom)
    expect(baseline).not.toBe(otherNight)
    expect(baseline).not.toBe(otherSeat)
  })
})

// ── tallyVotes (lifted helper) ─────────────────────────────

describe('tallyVotes', () => {
  // Helper to build the (name -> id) lookup the way the workflow
  // body constructs it from gameState.agentNames.
  function buildNameToId(...pairs: Array<[string, string]>): Map<string, string> {
    return new Map(pairs)
  }

  it('returns the unique majority winner', () => {
    const decisions = new Map<string, unknown>([
      ['voter-1', { target: 'Alice' }],
      ['voter-2', { target: 'Alice' }],
      ['voter-3', { target: 'Bob' }],
    ])
    const nameToId = buildNameToId(['Alice', 'alice-id'], ['Bob', 'bob-id'])
    const result = tallyVotes(decisions, nameToId)
    expect(result.winnerId).toBe('alice-id')
    expect(result.tally.get('alice-id')).toBe(2)
    expect(result.tally.get('bob-id')).toBe(1)
    expect(result.skipCount).toBe(0)
  })

  it('returns null winner on a tie', () => {
    const decisions = new Map<string, unknown>([
      ['voter-1', { target: 'Alice' }],
      ['voter-2', { target: 'Bob' }],
    ])
    const nameToId = buildNameToId(['Alice', 'alice-id'], ['Bob', 'bob-id'])
    const result = tallyVotes(decisions, nameToId)
    expect(result.winnerId).toBeNull()
  })

  it('returns null winner when skip-plurality matches max votes', () => {
    // Werewolf rule: if the abstain count >= max winning vote count,
    // no one is eliminated. Lifted from
    // packages/modes/src/werewolf/phases.ts:tallyVotes -- preserved
    // identical so day-vote semantics don't shift when 2.18 deletes
    // the legacy path.
    const decisions = new Map<string, unknown>([
      ['voter-1', { target: 'Alice' }],
      ['voter-2', { target: 'skip' }],
      ['voter-3', { target: 'skip' }],
    ])
    const nameToId = buildNameToId(['Alice', 'alice-id'])
    const result = tallyVotes(decisions, nameToId)
    expect(result.winnerId).toBeNull()
    expect(result.skipCount).toBe(2)
    expect(result.tally.get('alice-id')).toBe(1)
  })

  it("treats 'none' the same as 'skip' (both increment skipCount)", () => {
    // Witch / guard / hunter use 'none' to indicate no-target;
    // day/sheriff vote uses 'skip'. tally normalizes both into
    // skipCount so the same helper works across phases.
    const decisions = new Map<string, unknown>([
      ['v1', { target: 'none' }],
      ['v2', { target: 'skip' }],
    ])
    const nameToId = buildNameToId()
    const result = tallyVotes(decisions, nameToId)
    expect(result.skipCount).toBe(2)
  })

  it('respects per-voter weights (sheriff 1.5x)', () => {
    // Sheriff vote weight is 1.5x; baked in by the day-vote phase
    // step in 2.15 by passing a weights map. Lift integrity check
    // here so the contract is pinned independently of the consumer.
    const decisions = new Map<string, unknown>([
      ['sheriff', { target: 'Alice' }],
      ['villager', { target: 'Bob' }],
    ])
    const nameToId = buildNameToId(['Alice', 'alice-id'], ['Bob', 'bob-id'])
    const weights = new Map<string, number>([['sheriff', 1.5]])
    const result = tallyVotes(decisions, nameToId, { weights })
    // Sheriff's 1.5 vote for Alice beats villager's 1 vote for Bob.
    expect(result.winnerId).toBe('alice-id')
    expect(result.tally.get('alice-id')).toBe(1.5)
    expect(result.tally.get('bob-id')).toBe(1)
  })

  it('honors a custom field name', () => {
    // Hunter shoot uses `target` field but witch action uses
    // `poisonTarget`; the field parameter lets the same helper
    // tally either shape.
    const decisions = new Map<string, unknown>([
      ['v1', { poisonTarget: 'Alice' }],
      ['v2', { poisonTarget: 'Alice' }],
    ])
    const nameToId = buildNameToId(['Alice', 'alice-id'])
    const result = tallyVotes(decisions, nameToId, { field: 'poisonTarget' })
    expect(result.winnerId).toBe('alice-id')
    expect(result.tally.get('alice-id')).toBe(2)
  })

  it('silently skips malformed decisions (target name not in nameToId)', () => {
    // LLM hallucinated an unknown name. Don't crash -- treat as
    // skip-equivalent (the vote doesn't count for anyone). Matches
    // the legacy phases.ts behavior; if we ever want louder
    // diagnostics, do it via instrumentation, not by throwing here.
    const decisions = new Map<string, unknown>([
      ['v1', { target: 'NotAPlayer' }],
      ['v2', { target: 'Alice' }],
    ])
    const nameToId = buildNameToId(['Alice', 'alice-id'])
    const result = tallyVotes(decisions, nameToId)
    expect(result.winnerId).toBe('alice-id')
    expect(result.tally.get('alice-id')).toBe(1)
    // The malformed vote is NOT counted as a skip either -- skipCount
    // tracks explicit abstentions, not parse failures. This matches
    // the legacy helper exactly.
    expect(result.skipCount).toBe(0)
  })
})

// ── applyFallback ──────────────────────────────────────────

describe('applyFallback', () => {
  it("returns the registered FallbackAction for 'day-vote'", () => {
    // Registry contract: day-vote falls back to 'abstain'. Pinning
    // here prevents an accidental edit to fallback-policies.ts from
    // silently shifting day-vote semantics (e.g. switching to 'skip'
    // would change the tally arithmetic since 'skip' increments
    // skipCount but 'abstain' just doesn't count toward majority).
    expect(applyFallback('day-vote')).toEqual({ kind: 'abstain' })
  })

  it("returns the registered FallbackAction for 'wolf-vote'", () => {
    expect(applyFallback('wolf-vote')).toEqual({ kind: 'abstain' })
  })

  it("returns the registered FallbackAction for 'witch-action'", () => {
    expect(applyFallback('witch-action')).toEqual({ kind: 'skip' })
  })

  it("returns the registered FallbackAction for 'sheriff-election'", () => {
    expect(applyFallback('sheriff-election')).toEqual({ kind: 'withdraw' })
  })

  it("returns the registered FallbackAction for 'sheriff-transfer'", () => {
    expect(applyFallback('sheriff-transfer')).toEqual({ kind: 'drop-badge' })
  })
})

// ============================================================
// Phase 4.5d-2.14a -- state-lookup helpers
// ============================================================
//
// Phase steps in werewolf-night-phases.ts (and 2.14b/2.15/2.16) call
// these inline after reading WerewolfPersistedState once at step
// entry. Unit-pinned here so a regression in one of these helpers
// shows up here rather than as silently incorrect alive-list /
// vote-target-list construction inside a phase step.

describe('aliveIds', () => {
  it('returns all activeAgentIds when none are eliminated', () => {
    expect(aliveIds(MOCK_STATE)).toEqual([
      'a-1',
      'a-2',
      'a-3',
      'a-4',
      'a-5',
      'a-6',
    ])
  })

  it('filters out eliminated agents', () => {
    const state = { ...MOCK_STATE, eliminatedIds: ['a-1', 'a-3'] }
    expect(aliveIds(state)).toEqual(['a-2', 'a-4', 'a-5', 'a-6'])
  })

  it('preserves activeAgentIds order (iteration-stable for round-robin)', () => {
    // Round-robin chat phases (wolfDiscuss, dayDiscuss) depend on
    // stable speaker order. If aliveIds reorders silently, the
    // discussion order shifts between phase iterations and replay
    // can drift. Pinning order = preserving determinism.
    const state = {
      ...MOCK_STATE,
      activeAgentIds: ['a-3', 'a-1', 'a-5', 'a-2', 'a-4', 'a-6'],
    }
    expect(aliveIds(state)).toEqual(['a-3', 'a-1', 'a-5', 'a-2', 'a-4', 'a-6'])
  })
})

describe('aliveIdsByRole', () => {
  it("returns wolves only when role='werewolf'", () => {
    expect(aliveIdsByRole(MOCK_STATE, 'werewolf')).toEqual(['a-1', 'a-2'])
  })

  it('returns empty when no agents of that role are alive', () => {
    const state = { ...MOCK_STATE, eliminatedIds: ['a-3'] }
    expect(aliveIdsByRole(state, 'seer')).toEqual([])
  })

  it('respects elimination', () => {
    const state = { ...MOCK_STATE, eliminatedIds: ['a-1'] }
    expect(aliveIdsByRole(state, 'werewolf')).toEqual(['a-2'])
  })
})

describe('nameToIdMap', () => {
  it('builds the name->id reverse lookup', () => {
    const m = nameToIdMap(MOCK_STATE)
    expect(m.get('Wolf1')).toBe('a-1')
    expect(m.get('Witch')).toBe('a-4')
    expect(m.get('Villager2')).toBe('a-6')
  })

  it('includes eliminated agents (used to interpret post-mortem references)', () => {
    // tallyVotes consults this map to translate a vote target name
    // (string from LLM output) back to an agent id. Eliminated
    // agents may still be referenced (e.g. last-words mentioning
    // a dead player), so the lookup MUST include them. If we ever
    // restrict to alive only, day-vote tallies that name a
    // just-eliminated player would silently drop.
    const state = { ...MOCK_STATE, eliminatedIds: ['a-1'] }
    const m = nameToIdMap(state)
    expect(m.get('Wolf1')).toBe('a-1')
  })
})

describe('allAliveNames / aliveNonWolfNames / aliveNamesExcluding', () => {
  it('allAliveNames returns all alive agents in iteration order', () => {
    expect(allAliveNames(MOCK_STATE)).toEqual([
      'Wolf1',
      'Wolf2',
      'Seer',
      'Witch',
      'Villager1',
      'Villager2',
    ])
  })

  it('aliveNonWolfNames excludes wolves (used for wolf-vote target list)', () => {
    expect(aliveNonWolfNames(MOCK_STATE)).toEqual([
      'Seer',
      'Witch',
      'Villager1',
      'Villager2',
    ])
  })

  it('aliveNamesExcluding excludes the named id (e.g. seer cannot check self)', () => {
    expect(aliveNamesExcluding(MOCK_STATE, 'a-3')).toEqual([
      'Wolf1',
      'Wolf2',
      'Witch',
      'Villager1',
      'Villager2',
    ])
  })

  it('combined elimination + exclusion drops both', () => {
    const state = { ...MOCK_STATE, eliminatedIds: ['a-1'] }
    expect(aliveNamesExcluding(state, 'a-3')).toEqual([
      'Wolf2',
      'Witch',
      'Villager1',
      'Villager2',
    ])
  })
})

describe('cycleId', () => {
  it('formats night cycles as n${N}', () => {
    expect(cycleId(1, false)).toBe('n1')
    expect(cycleId(7, false)).toBe('n7')
  })

  it('formats day cycles as d${N}', () => {
    expect(cycleId(1, true)).toBe('d1')
    expect(cycleId(7, true)).toBe('d7')
  })

  it("uses the same number for the night/day pair (n1+d1 are the 'first cycle')", () => {
    // Pinning the convention: day N follows night N. If we ever
    // shift to "day after night N has number N+1" or similar, this
    // test surfaces the change loudly.
    expect(cycleId(1, false)).toBe('n1')
    expect(cycleId(1, true)).toBe('d1')
  })
})
