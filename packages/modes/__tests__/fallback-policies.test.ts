import { describe, expect, it } from 'vitest'
import { getFallback, listFallbacks, type FallbackAction } from '../src/fallback-policies.js'

describe('mode fallback policies', () => {
  describe('werewolf', () => {
    it('day-vote falls back to abstain', () => {
      expect(getFallback('werewolf', 'day-vote')).toEqual({ kind: 'abstain' } satisfies FallbackAction)
    })

    it('wolf-vote falls back to abstain', () => {
      expect(getFallback('werewolf', 'wolf-vote')).toEqual({ kind: 'abstain' })
    })

    it.each(['speak', 'wolf-speak', 'witch-action', 'seer-check', 'guard-protect', 'hunter-shoot', 'last-words'])(
      'turn %s falls back to skip',
      (turnId) => {
        expect(getFallback('werewolf', turnId)).toEqual({ kind: 'skip' })
      },
    )

    it('sheriff-election falls back to withdraw', () => {
      expect(getFallback('werewolf', 'sheriff-election')).toEqual({ kind: 'withdraw' })
    })

    it('sheriff-transfer falls back to drop-badge', () => {
      expect(getFallback('werewolf', 'sheriff-transfer')).toEqual({ kind: 'drop-badge' })
    })
  })

  describe('open-chat', () => {
    it('speak falls back to pass-turn', () => {
      expect(getFallback('open-chat', 'speak')).toEqual({ kind: 'pass-turn' })
    })
  })

  describe('roundtable', () => {
    it('speak falls back to pass-turn', () => {
      expect(getFallback('roundtable', 'speak')).toEqual({ kind: 'pass-turn' })
    })
  })

  describe('unknown lookups', () => {
    it('returns null for unregistered mode', () => {
      expect(getFallback('script-kill', 'speak')).toBeNull()
    })

    it('returns null for unregistered turn within registered mode', () => {
      expect(getFallback('werewolf', 'invalid-turn')).toBeNull()
    })
  })

  describe('listFallbacks', () => {
    it('enumerates every werewolf turn from the spec', () => {
      const werewolfTurns = listFallbacks()
        .filter((entry) => entry.modeId === 'werewolf')
        .map((entry) => entry.turnId)
        .sort()

      // Mirrors the canonical turn-id list from
      // apps/web/app/api/rooms/[id]/human-input/route.ts (resolveHumanMessage)
      // and the V2 plan §4.5d-1 fallback table.
      const expected = [
        'day-vote',
        'guard-protect',
        'hunter-shoot',
        'last-words',
        'seer-check',
        'sheriff-election',
        'sheriff-transfer',
        'speak',
        'witch-action',
        'wolf-speak',
        'wolf-vote',
      ].sort()

      expect(werewolfTurns).toEqual(expected)
    })

    it('returns at least one entry per registered mode', () => {
      const modesSeen = new Set(listFallbacks().map((entry) => entry.modeId))
      expect(modesSeen).toContain('werewolf')
      expect(modesSeen).toContain('open-chat')
      expect(modesSeen).toContain('roundtable')
    })
  })
})
