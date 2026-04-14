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
