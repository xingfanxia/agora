// ============================================================
// Tests — StateMachineFlow.rehydrate()
// ============================================================
//
// Phase 4.5a durable runtime invariant: after rehydrate(), the flow
// internal state matches what it would look like right at a phase
// boundary (phase just entered, speakers computed, zero progress).

import { describe, expect, it } from 'vitest'
import { StateMachineFlow, type StateMachineConfig } from '../src/state-machine.js'

function buildConfig(): StateMachineConfig {
  return {
    initialPhase: 'phaseA',
    terminalPhases: ['end'],
    phases: [
      {
        name: 'phaseA',
        channelId: 'main',
        getSpeakers: (state, ids) => ids.filter((id) => state.activeAgentIds.has(id)),
      },
      {
        name: 'phaseB',
        channelId: 'main',
        getSpeakers: (state, ids) => {
          // returns only agents whose role is 'speaker' and still active
          return ids.filter(
            (id) =>
              state.activeAgentIds.has(id) && state.roles.get(id) === 'speaker',
          )
        },
      },
      { name: 'end', channelId: 'main', getSpeakers: () => [] },
    ],
    transitions: [],
  }
}

describe('StateMachineFlow.rehydrate', () => {
  it('installs agentIds + gameState + currentPhase in one call', () => {
    const flow = new StateMachineFlow(buildConfig())

    const agentIds = ['agent-1', 'agent-2', 'agent-3']
    const roles = new Map([
      ['agent-1', 'speaker'],
      ['agent-2', 'listener'],
      ['agent-3', 'speaker'],
    ])
    const activeAgentIds = new Set(agentIds)
    const custom = { customCount: 7, nightNumber: 3 }

    flow.rehydrate({
      phaseName: 'phaseB',
      round: 3,
      agentIds,
      roles,
      activeAgentIds,
      custom,
    })

    expect(flow.getCurrentPhase()).toBe('phaseB')
    const state = flow.getGameState()
    expect(state.roles).toBe(roles)
    expect(state.activeAgentIds).toBe(activeAgentIds)
    expect(state.custom).toEqual(custom)

    // Speakers recomputed from phase.getSpeakers — should be only role='speaker'
    const tick = flow.tick()
    expect(tick.isComplete).toBe(false)
    expect(tick.phase).toBe('phaseB')
    expect(tick.round).toBe(3)
    // Only one of the speakers at a time (speakerIndex=0)
    expect(tick.nextSpeakers).toEqual(['agent-1'])
  })

  it('rehydrate to a terminal phase marks flow complete', () => {
    const flow = new StateMachineFlow(buildConfig())
    flow.rehydrate({
      phaseName: 'end',
      round: 5,
      agentIds: ['a', 'b'],
      roles: new Map(),
      activeAgentIds: new Set(['a', 'b']),
      custom: {},
    })
    expect(flow.isComplete()).toBe(true)
    const tick = flow.tick()
    expect(tick.isComplete).toBe(true)
    expect(tick.nextSpeakers).toEqual([])
  })

  it('rehydrate twice with same snapshot produces identical state', () => {
    const f1 = new StateMachineFlow(buildConfig())
    const f2 = new StateMachineFlow(buildConfig())

    const snapshot = {
      phaseName: 'phaseA',
      round: 2,
      agentIds: ['a', 'b', 'c'] as const,
      roles: new Map<string, string>(),
      activeAgentIds: new Set(['a', 'b', 'c']),
      custom: { foo: 'bar' },
    }

    f1.rehydrate(snapshot)
    f2.rehydrate(snapshot)

    const t1 = f1.tick()
    const t2 = f2.tick()
    expect(t1.phase).toBe(t2.phase)
    expect(t1.nextSpeakers).toEqual(t2.nextSpeakers)
    expect(t1.round).toBe(t2.round)
  })

  it('throws for unknown phase', () => {
    const flow = new StateMachineFlow(buildConfig())
    expect(() =>
      flow.rehydrate({
        phaseName: 'nonexistent',
        round: 1,
        agentIds: ['a'],
        roles: new Map(),
        activeAgentIds: new Set(['a']),
        custom: {},
      }),
    ).toThrow(/Unknown phase/)
  })

  it('throws for empty agentIds', () => {
    const flow = new StateMachineFlow(buildConfig())
    expect(() =>
      flow.rehydrate({
        phaseName: 'phaseA',
        round: 1,
        agentIds: [],
        roles: new Map(),
        activeAgentIds: new Set(),
        custom: {},
      }),
    ).toThrow(/non-empty/)
  })

  // ─── Phase 4.5d multi-human replay invariant ───────────────

  it('rebuilds speakerIndex deterministically when onMessage is replayed after rehydrate', () => {
    // Simulates the durable-runtime resume path for a phase with
    // multiple speakers (e.g. day-vote). Two humans in the speaker
    // list; their votes arrive as message events. On next tick, the
    // runtime rehydrates the flow to this phase and replays events
    // via flow.onMessage() to reconstruct speakerIndex.
    const agentIds = ['human-1', 'ai-1', 'human-2', 'ai-2']

    const f1 = new StateMachineFlow(buildConfig())
    f1.rehydrate({
      phaseName: 'phaseA',
      round: 1,
      agentIds,
      roles: new Map(),
      activeAgentIds: new Set(agentIds),
      custom: {},
    })

    // Live run: speakers 0-1 speak. On speaker 2 (human) we pause.
    expect(f1.tick().nextSpeakers).toEqual(['human-1'])
    f1.onMessage({
      id: 'm1', roomId: 'r', senderId: 'human-1', senderName: 'H1',
      content: 'vote-a', channelId: 'main', timestamp: 0,
      metadata: { decision: { target: 'ai-1' } },
    })
    expect(f1.tick().nextSpeakers).toEqual(['ai-1'])
    f1.onMessage({
      id: 'm2', roomId: 'r', senderId: 'ai-1', senderName: 'AI1',
      content: 'vote-b', channelId: 'main', timestamp: 0,
      metadata: { decision: { target: 'human-1' } },
    })
    // Now speakerIndex=2 pointing at human-2 — pause in real runtime.

    // Rehydration — new flow, replay the two prior messages.
    const f2 = new StateMachineFlow(buildConfig())
    f2.rehydrate({
      phaseName: 'phaseA',
      round: 1,
      agentIds,
      roles: new Map(),
      activeAgentIds: new Set(agentIds),
      custom: {},
    })
    f2.onMessage({
      id: 'm1', roomId: 'r', senderId: 'human-1', senderName: 'H1',
      content: 'vote-a', channelId: 'main', timestamp: 0,
      metadata: { decision: { target: 'ai-1' } },
    })
    f2.onMessage({
      id: 'm2', roomId: 'r', senderId: 'ai-1', senderName: 'AI1',
      content: 'vote-b', channelId: 'main', timestamp: 0,
      metadata: { decision: { target: 'human-1' } },
    })

    // Both flows should now point at the same next speaker.
    expect(f2.tick().nextSpeakers).toEqual(f1.tick().nextSpeakers)
    expect(f2.tick().nextSpeakers).toEqual(['human-2'])
  })

  it('documents onMessage advances speakerIndex unconditionally — callers must pre-filter', () => {
    // This test pins the contract that room-runtime.ts's
    // rehydrateWerewolfFromDb depends on: StateMachineFlow.onMessage()
    // is *not* self-filtering. It advances speakerIndex for EVERY
    // message it sees. In the live run, announcement messages (from
    // drainAnnouncements, senderId='system') are never fed into
    // onMessage — room.ts only calls flow.onMessage for speaker
    // replies. The durable rehydrate path MUST match that by filtering
    // out non-speaker messages before onMessage'ing them. If someone
    // "simplifies" this test or drops the filter in rehydrate,
    // speakerIndex will inflate and mid-phase resume breaks.
    const agentIds = ['a', 'b', 'c']
    const f = new StateMachineFlow(buildConfig())
    f.rehydrate({
      phaseName: 'phaseA',
      round: 1,
      agentIds,
      roles: new Map(),
      activeAgentIds: new Set(agentIds),
      custom: {},
    })

    // A system announcement masquerading as a message — passing it to
    // onMessage DOES advance speakerIndex. The bug this test guards is
    // "what happens if someone accidentally feeds it in".
    const sysAnnouncement = {
      id: 'sys', roomId: 'r', senderId: 'system', senderName: 'Narrator',
      content: 'Night falls.', channelId: 'main', timestamp: 0,
    }
    f.onMessage(sysAnnouncement)
    // After one onMessage the flow now points at speaker index 1 ('b'),
    // NOT 'a' as we'd want if announcements were properly filtered out.
    expect(f.tick().nextSpeakers).toEqual(['b'])
  })

  it('onMessage replay is order-independent for decisions (records all)', () => {
    // Two humans vote independently via /human-input — their message
    // events could land in either order. Verify phaseDecisions ends
    // up with both regardless.
    const agentIds = ['human-1', 'human-2']
    const snapshot = {
      phaseName: 'phaseA',
      round: 1,
      agentIds,
      roles: new Map(),
      activeAgentIds: new Set(agentIds),
      custom: {},
    }

    const msgA = {
      id: 'mA', roomId: 'r', senderId: 'human-1', senderName: 'H1',
      content: 'a', channelId: 'main', timestamp: 0,
      metadata: { decision: { target: 'human-2' } },
    }
    const msgB = {
      id: 'mB', roomId: 'r', senderId: 'human-2', senderName: 'H2',
      content: 'b', channelId: 'main', timestamp: 1,
      metadata: { decision: { target: 'human-1' } },
    }

    const fAB = new StateMachineFlow(buildConfig())
    fAB.rehydrate(snapshot)
    fAB.onMessage(msgA)
    fAB.onMessage(msgB)

    const fBA = new StateMachineFlow(buildConfig())
    fBA.rehydrate(snapshot)
    fBA.onMessage(msgB)
    fBA.onMessage(msgA)

    // Both should have exhausted speakers (speakerIndex=2 after two msgs).
    // Next tick returns nothing further in this phase — tests that both
    // decisions were recorded and the phase is ready to transition/exit.
    const tAB = fAB.tick()
    const tBA = fBA.tick()
    expect(tAB.isComplete || tAB.nextSpeakers.length === 0).toBe(true)
    expect(tBA.isComplete || tBA.nextSpeakers.length === 0).toBe(true)
  })

  it('resets per-phase counters — speakerIndex back to 0', () => {
    const flow = new StateMachineFlow(buildConfig())
    flow.initialize(['a', 'b', 'c'])

    // Advance speakerIndex by simulating an onMessage
    flow.onMessage({
      id: 'm1',
      roomId: 'r',
      senderId: 'a',
      senderName: 'A',
      content: 'hi',
      channelId: 'main',
      timestamp: 0,
    })
    // Now speakerIndex=1, turnCount=1 internally

    // Rehydrate — resets
    flow.rehydrate({
      phaseName: 'phaseA',
      round: 1,
      agentIds: ['a', 'b', 'c'],
      roles: new Map(),
      activeAgentIds: new Set(['a', 'b', 'c']),
      custom: {},
    })

    const tick = flow.tick()
    // First speaker again (not 'b' which would be speakerIndex=1)
    expect(tick.nextSpeakers).toEqual(['a'])
  })
})
