// ============================================================
// Phase 4.5d-2.6 -- roundtable workflow internal helpers
// ============================================================
//
// Pins the deterministic messageId format that retry idempotency
// depends on. The events_message_id_uq partial UNIQUE index in
// packages/db/drizzle/0010_event_content_key_idempotency.sql is
// keyed on payload->'message'->>'id' = this format. A format
// change without a coordinated index migration would silently break
// idempotency: the index would no longer dedupe new-format ids
// against old-format rows, OR vice versa.
//
// Real determinism + idempotency tests need DB infrastructure
// (the .todo at the bottom of cross-runtime-equivalence.integration
// .test.ts is the natural home). This file pins the unit-level
// guarantees that the schema migration depends on.

import { describe, it, expect } from 'vitest'
import { deriveTurnMessageId } from '../../app/workflows/roundtable-workflow.js'

describe('deriveTurnMessageId', () => {
  it('produces the same id for the same (roomId, turnIdx, agentId)', () => {
    const a = deriveTurnMessageId('room-uuid-1', 0, 'agent-uuid-A')
    const b = deriveTurnMessageId('room-uuid-1', 0, 'agent-uuid-A')
    expect(a).toBe(b)
  })

  it('matches the rt-${roomId}-t${turnIdx}-${agentId} format', () => {
    // Pinning the literal format. The events_message_id_uq partial
    // UNIQUE index extracts payload->'message'->>'id' regardless of
    // the actual format string -- but a change here without a coord
    // index migration would silently break idempotency for in-flight
    // rooms (legacy events have the old format, new events have the
    // new format, the index keys both as text -> no collision -> no
    // dedupe).
    expect(deriveTurnMessageId('room-uuid-1', 5, 'agent-uuid-A')).toBe(
      'rt-room-uuid-1-t5-agent-uuid-A',
    )
  })

  it('produces different ids when any of the three inputs differ', () => {
    const baseline = deriveTurnMessageId('room-1', 0, 'agent-A')
    const otherRoom = deriveTurnMessageId('room-2', 0, 'agent-A')
    const otherTurn = deriveTurnMessageId('room-1', 1, 'agent-A')
    const otherAgent = deriveTurnMessageId('room-1', 0, 'agent-B')
    expect(baseline).not.toBe(otherRoom)
    expect(baseline).not.toBe(otherTurn)
    expect(baseline).not.toBe(otherAgent)
  })

  it('handles very large turnIdx values without losing precision', () => {
    // Roundtable max is 80 turns (8 agents * 10 rounds). Werewolf
    // could be larger. The format uses string interpolation, so
    // there's no integer-overflow concern -- but pin the behavior
    // anyway so a refactor to bigint-formatting is forced to
    // explicitly handle this case.
    expect(deriveTurnMessageId('r', 999, 'a')).toBe('rt-r-t999-a')
  })

  it('does not collide when the agentId visually overlaps a turn delimiter', () => {
    // Adversarial case: agentId of '5' and turnIdx of 5 both render
    // as 't5'. Format includes the literal 't' before turnIdx and
    // '-' separators around all three fields, so collision requires
    // an actual matching tuple. Pin the boundary case.
    const collision1 = deriveTurnMessageId('r', 5, '5')
    const collision2 = deriveTurnMessageId('r', 55, '')
    expect(collision1).not.toBe(collision2)
  })
})
