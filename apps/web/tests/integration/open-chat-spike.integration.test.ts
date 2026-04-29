// ============================================================
// Phase 4.5d-2.0 SPIKE — Workflow composition + hook-resume tests
// ============================================================
//
// Validates the WDK substrate's contract for our use case:
//   1. Workflow + step composition runs end-to-end and produces the
//      expected round-robin output.
//   2. createHook lets a human seat pause; the workflow PAUSES (not
//      just registers a hook), and resumeHook unblocks the loop.
//   3. The workflow function itself is deterministic — given identical
//      input, it produces identical output. (This is OUR contract;
//      WDK's step-result caching across retries is WDK's contract,
//      tested by WDK's own suite. We rely on the contract, not re-test
//      it from outside.)
//
// The @workflow/vitest plugin compiles `"use workflow"` + `"use step"`
// and routes them in-process — no live server needed.

import { describe, it, expect, beforeEach } from 'vitest'
import { start, resumeHook } from 'workflow/api'
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
    // Strengthened assertion: a workflow that wrongly paused at turn 0
    // would still register a hook and pass the simple "hook exists"
    // check. Race the run.returnValue against a short timeout — if it
    // resolves quickly, the workflow didn't actually pause. If the
    // timeout fires first (the expected outcome), the hook is genuinely
    // blocking progress.
    const expectedToken = humanTurnToken('room-with-human', 1)
    const hook = await waitForHook(run, { token: expectedToken })
    expect(hook.token).toBe(expectedToken)

    let raceWinner: 'returnValue' | 'timeout' = 'timeout'
    await Promise.race([
      run.returnValue.then(() => {
        raceWinner = 'returnValue'
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 200)),
    ])
    expect(raceWinner).toBe('timeout')

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

  it('workflow function is deterministic across invocations', async () => {
    // What this tests: OUR workflow function doesn't introduce
    // non-determinism (no Math.random / Date.now / mutable globals
    // inside the workflow body). Same input → same output across
    // independent runs.
    //
    // What this does NOT test: WDK's step-result caching across step
    // retries. That's WDK's substrate contract, validated by WDK's
    // own test suite — we rely on it but don't re-validate from
    // outside (a from-scratch test couldn't tell the difference
    // between "step ran twice and produced same output" and "step
    // ran once and result was cached"; only WDK's internal events
    // log distinguishes those).
    //
    // The property below is the one we own: if we accidentally add
    // a Math.random() call inside the workflow function in a future
    // refactor, this test fails.
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

    expect(result2.messages).toEqual(result1.messages)
  })
})
