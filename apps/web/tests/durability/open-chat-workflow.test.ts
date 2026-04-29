// ============================================================
// Phase 4.5d-2.9 -- open-chat workflow internal helpers
// ============================================================
//
// Pins (1) the deterministic messageId format that retry idempotency
// depends on, AND (2) the humanTurnToken format that external
// resumers (the /api/rooms/.../human-input endpoint) reconstruct
// from URL params before calling resumeHook.
//
// Both formats are load-bearing across module boundaries:
//   * deriveOpenChatMessageId -> events_message_id_uq partial UNIQUE
//     index (migration 0010). A format change without coordinated
//     data reconciliation silently breaks idempotency for in-flight
//     rooms.
//   * humanTurnToken -> the resumeHook caller. A format change
//     without coordinated callers silently drops human turns on
//     the floor.
//
// Real determinism + idempotency tests need DB infrastructure (the
// integration test pattern from cross-runtime-equivalence.integration
// .test.ts). This file pins the unit-level guarantees that the
// schema migration AND the resumeHook contract depend on.

import { describe, it, expect } from 'vitest'
import {
  deriveOpenChatMessageId,
  humanTurnToken,
} from '../../app/workflows/open-chat-workflow.js'

describe('deriveOpenChatMessageId', () => {
  it('produces the same id for the same (roomId, turnIdx, agentId)', () => {
    const a = deriveOpenChatMessageId('room-uuid-1', 0, 'agent-uuid-A')
    const b = deriveOpenChatMessageId('room-uuid-1', 0, 'agent-uuid-A')
    expect(a).toBe(b)
  })

  it('matches the oc-${roomId}-t${turnIdx}-${agentId} format', () => {
    // Pinning the literal format. The events_message_id_uq partial
    // UNIQUE index extracts payload->'message'->>'id' regardless of
    // the actual format string -- but a change here without a coord
    // index migration would silently break idempotency for in-flight
    // rooms (legacy events have the old format, new events have the
    // new format, the index keys both as text -> no collision -> no
    // dedupe).
    expect(deriveOpenChatMessageId('room-uuid-1', 5, 'agent-uuid-A')).toBe(
      'oc-room-uuid-1-t5-agent-uuid-A',
    )
  })

  it('uses the oc- prefix to namespace away from roundtable', () => {
    // Cross-mode safety: the events_message_id_uq partial UNIQUE on
    // (roomId, payload->'message'->>'id') WHERE type='message:created'
    // is keyed on the FULL id text. Two rooms running different modes
    // can never share the same (roomId, id) tuple because each mode's
    // prefix is distinct.
    //   - roundtable: rt-...
    //   - open-chat:  oc-...
    //   - werewolf:   to be assigned in 4.5d-2.10+
    // Pinning the prefix here prevents an accidental rename that
    // would let modes silently overlap.
    const id = deriveOpenChatMessageId('r', 0, 'a')
    expect(id.startsWith('oc-')).toBe(true)
  })

  it('produces different ids when any of the three inputs differ', () => {
    const baseline = deriveOpenChatMessageId('room-1', 0, 'agent-A')
    const otherRoom = deriveOpenChatMessageId('room-2', 0, 'agent-A')
    const otherTurn = deriveOpenChatMessageId('room-1', 1, 'agent-A')
    const otherAgent = deriveOpenChatMessageId('room-1', 0, 'agent-B')
    expect(baseline).not.toBe(otherRoom)
    expect(baseline).not.toBe(otherTurn)
    expect(baseline).not.toBe(otherAgent)
  })

  it('handles very large turnIdx values without losing precision', () => {
    // Open-chat max is 120 turns (12 agents * 10 rounds). Pin the
    // string-interpolation behavior anyway so a refactor to bigint-
    // formatting is forced to explicitly handle this case.
    expect(deriveOpenChatMessageId('r', 999, 'a')).toBe('oc-r-t999-a')
  })

  it('does not collide when the agentId visually overlaps a turn delimiter', () => {
    // Adversarial case mirroring roundtable's regression marker:
    // agentId of '5' and turnIdx of 5 both render as 't5'. Format
    // includes the literal 't' before turnIdx and '-' separators
    // around all three fields, so collision requires an actual
    // matching tuple. Pin the boundary case so a refactor that
    // drops the literal 't' marker (or the prefix) surfaces here.
    const collision1 = deriveOpenChatMessageId('r', 5, '5')
    const collision2 = deriveOpenChatMessageId('r', 55, '')
    expect(collision1).not.toBe(collision2)
  })
})

describe('humanTurnToken', () => {
  it('matches the agora/room/${roomId}/mode/open-chat/turn/${turnIdx} format', () => {
    // Pinning the literal format. External resumers (the human-input
    // API endpoint) reconstruct this string from URL path params and
    // call resumeHook; a divergence between this format and the
    // caller's reconstruction silently drops human turns.
    //
    // The `mode/open-chat/` segment is the namespace boundary --
    // werewolf's day-vote will use `mode/werewolf-day-vote/`,
    // night-action will use `mode/werewolf-night-action/`, etc.
    // Don't add another `mode/` to the prefix without a coordinated
    // caller migration.
    expect(humanTurnToken('11111111-1111-1111-1111-111111111111', 0)).toBe(
      'agora/room/11111111-1111-1111-1111-111111111111/mode/open-chat/turn/0',
    )
  })

  it('produces the same token for the same (roomId, turnIdx)', () => {
    // External resumers compute this string twice (once at hook-
    // creation by the workflow; once at resume-time by the API
    // caller). Determinism is the binding contract.
    const a = humanTurnToken('room-1', 5)
    const b = humanTurnToken('room-1', 5)
    expect(a).toBe(b)
  })

  it('produces different tokens when either input differs', () => {
    const baseline = humanTurnToken('room-1', 0)
    const otherRoom = humanTurnToken('room-2', 0)
    const otherTurn = humanTurnToken('room-1', 1)
    expect(baseline).not.toBe(otherRoom)
    expect(baseline).not.toBe(otherTurn)
  })

  it('handles very large turnIdx values without losing precision', () => {
    // Same rationale as the deriveOpenChatMessageId test: pin the
    // string-interpolation behavior so a refactor away from raw
    // template literals is forced to handle large integers.
    expect(humanTurnToken('r', 999)).toBe('agora/room/r/mode/open-chat/turn/999')
  })
})
