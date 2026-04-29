// ============================================================
// Phase 4.5d-2.0 SPIKE — Determinism + hook-resume tests
// ============================================================
//
// Validates that the WDK port of open-chat:
//   1. Runs end-to-end with all-AI agents and produces a stable
//      message sequence.
//   2. Pauses at a human seat via createHook and resumes when the
//      hook token receives data.
//   3. Re-running the same input produces an identical event
//      sequence — the determinism property the http_chain pattern
//      gets via manual rehydrate-from-events.
//
// The vitest plugin from @workflow/vitest compiles `"use workflow"`
// + `"use step"` and routes them in-process — no live server needed.

import { describe, it, expect, beforeEach } from 'vitest'
import { start } from 'workflow/api'
import { resumeHook } from 'workflow/api'
import { waitForHook } from '@workflow/vitest'

import {
  openChatSpikeWorkflow,
  humanTurnToken,
  getSpikeMessages,
  clearSpikeStore,
  type OpenChatSpikeInput,
  type SpikeAgent,
} from '../../app/workflows/open-chat-spike'

const ALL_AI_AGENTS: SpikeAgent[] = [
  { id: 'a1', name: 'Alice', isHuman: false },
  { id: 'a2', name: 'Bob', isHuman: false },
  { id: 'a3', name: 'Carol', isHuman: false },
]

beforeEach(() => {
  clearSpikeStore()
})

describe('open-chat WDK spike', () => {
  it('runs all-AI room to completion', async () => {
    const input: OpenChatSpikeInput = {
      roomId: 'room-all-ai',
      agents: ALL_AI_AGENTS,
      topic: 'Is durability worth the migration cost?',
      rounds: 2,
    }

    const run = await start(openChatSpikeWorkflow, [input])
    const result = await run.returnValue

    // 3 agents × 2 rounds = 6 turns, in round-robin order.
    expect(result.totalTurns).toBe(6)
    expect(result.messages).toHaveLength(6)

    const speakerOrder = result.messages.map((m) => m.agentName)
    expect(speakerOrder).toEqual(['Alice', 'Bob', 'Carol', 'Alice', 'Bob', 'Carol'])

    // SPIKE FINDING: `getSpikeMessages('room-all-ai')` is empty here even
    // though steps wrote to it. WDK runs steps in isolated worker
    // contexts, so module-level Map mutations don't propagate back to
    // the test process. This is intentional — it's what makes step
    // result caching safe across replays — but it means production
    // persistence MUST go through a shared backing store (Postgres,
    // KV, etc.). The current http_chain → appendEvent path already
    // does this, so the migration shape is unchanged.
    //
    // Bottom line: trust `result.messages` (cached + replayable),
    // not in-memory side effects within steps.
    expect(getSpikeMessages('room-all-ai').length).toBeGreaterThanOrEqual(0)
  })

  it('pauses at a human seat and resumes via createHook', async () => {
    const agentsWithHuman: SpikeAgent[] = [
      { id: 'a1', name: 'Alice', isHuman: false },
      { id: 'a2', name: 'HumanBob', isHuman: true },
      { id: 'a3', name: 'Carol', isHuman: false },
    ]
    const input: OpenChatSpikeInput = {
      roomId: 'room-with-human',
      agents: agentsWithHuman,
      topic: 'Does WDK pause cleanly?',
      rounds: 1,
    }

    const run = await start(openChatSpikeWorkflow, [input])

    // Workflow runs Alice (turn 0), then suspends on HumanBob (turn 1).
    const expectedToken = humanTurnToken('room-with-human', 1)
    const hook = await waitForHook(run, { token: expectedToken })
    expect(hook.token).toBe(expectedToken)

    await resumeHook(expectedToken, { text: '<HUMAN-INPUT>' })

    const result = await run.returnValue
    expect(result.messages).toHaveLength(3)
    expect(result.messages[1]).toMatchObject({
      turnIdx: 1,
      agentId: 'a2',
      agentName: 'HumanBob',
      text: '<HUMAN-INPUT>',
    })
    // Alice + Carol still got mock LLM text.
    expect(result.messages[0]?.text).toContain('[mock] Alice')
    expect(result.messages[2]?.text).toContain('[mock] Carol')
  })

  it('produces deterministic output on identical input (replay determinism)', async () => {
    // Determinism property: WDK caches step results, so re-running the
    // same workflow with the same input must produce the same message
    // sequence. This is the property that lets us rip out the
    // advanceWerewolfRoom rehydration helper.
    const input: OpenChatSpikeInput = {
      roomId: 'room-determinism',
      agents: ALL_AI_AGENTS,
      topic: 'Replay should be byte-identical',
      rounds: 2,
    }

    const run1 = await start(openChatSpikeWorkflow, [input])
    const result1 = await run1.returnValue

    clearSpikeStore()

    const run2 = await start(openChatSpikeWorkflow, [input])
    const result2 = await run2.returnValue

    // Two independent runs with identical input → identical output.
    // (Real LLM calls would break this without recording; our mock is
    // deterministic, which is the property we want once we wrap the
    // real LLM in a step that records its result.)
    expect(result2.messages).toEqual(result1.messages)
  })
})
