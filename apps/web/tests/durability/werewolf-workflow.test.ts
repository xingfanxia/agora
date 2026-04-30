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
} from '../../app/workflows/werewolf-workflow.js'

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
