// ============================================================
// Phase 4.5d-2.3 -- Cross-runtime equivalence test
// ============================================================
//
// Binding meta-invariant of the durability contract (4.5d-2.1):
// for the same scenario, http_chain and WDK runtimes must produce
// identical message:created events. Different infrastructure, same
// observable behavior. If this invariant breaks, the WDK migration
// is unsafe to flip on by default.
//
// This file deliberately covers what's testable WITHOUT a real
// database. Each runtime persists via apps/web/app/lib/room-store
// which is tightly coupled to Postgres. The full event-stream diff
// is gated on a DB seam (in-memory event log adapter) -- see the
// `.skip`'d test below for the design.
//
// The PARTIAL equivalence we CAN prove without DB:
//
//   1. The LLM mock is deterministic on (systemPrompt, history)
//      [covered in llm-factory.test.ts -- foundation only]
//
//   2. The TWO runtimes' LLM-input transformations are equivalent
//      where they should be (e.g. for an agent's FIRST turn, when
//      it has not yet observed its own messages)
//
//   3. The TWO runtimes' transformations DIVERGE where they should
//      not -- this is captured as the `.skip`'d divergence case +
//      memory entry (project_role_tagging_divergence) so the next
//      session can land the fix.

import { describe, it, expect } from 'vitest'
import { createGenerateFn } from '../../app/lib/llm-factory.js'
import type { ModelConfig } from '@agora/shared'

// ── Fixture ────────────────────────────────────────────────

const MODEL: ModelConfig = {
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-6',
  maxTokens: 1024,
}

interface AgentFixture {
  readonly id: string
  readonly name: string
  readonly systemPrompt: string
}

const ALICE: AgentFixture = {
  id: 'alice-id',
  name: 'Alice',
  systemPrompt: 'You are Alice. Argue for caution.',
}
const BOB: AgentFixture = {
  id: 'bob-id',
  name: 'Bob',
  systemPrompt: 'You are Bob. Argue for ambition.',
}

interface HistoryMessage {
  readonly senderId: string
  readonly senderName: string
  readonly content: string
}

// ── Runtime input shaping ──────────────────────────────────
//
// These helpers are HAND-ROLLED REPLICAS of each runtime's
// history-to-chat transformation. They are the most foot-gun
// surface in this file: drift between a helper and its prod
// counterpart silently breaks the regression marker below.
//
// PROD ANCHORS (keep these in sync if EITHER changes):
//   * legacy   -> packages/core/src/agent.ts:98-99 (messageToChatMessage)
//                 + the call site at packages/core/src/agent.ts:144
//   * WDK      -> apps/web/app/workflows/roundtable-workflow.ts:248-253
//                 (the inline `priorMessages.map(...)` inside
//                  generateAgentReply step)
//
// The next refactor that makes these helpers obsolete is to extract
// both transformations into pure functions in their respective
// packages and import them here -- at which point this file's
// helpers become a thin import alias and drift becomes impossible.

/** Legacy AIAgent -- mirror of agent.ts:98-99 (messageToChatMessage). */
function legacyChatMessages(
  history: readonly HistoryMessage[],
): { role: string; content: string }[] {
  // Every message becomes role:'user' with [name]: prefix.
  // Own-vs-other is NOT distinguished.
  return history.map((m) => ({
    role: 'user',
    content: `[${m.senderName}]: ${m.content}`,
  }))
}

/** WDK roundtable -- mirror of roundtable-workflow.ts:248-253. */
function wdkChatMessages(
  history: readonly HistoryMessage[],
  ownAgentId: string,
): { role: string; content: string }[] {
  return history.map((m) =>
    m.senderId === ownAgentId
      ? { role: 'assistant', content: m.content }
      : { role: 'user', content: `[${m.senderName}]: ${m.content}` },
  )
}

// ── KNOWN DIVERGENCES (allowlist) ──────────────────────────
//
// Cross-runtime equivalence is the binding meta-invariant of the
// durability contract, but two specific divergences are accepted
// today:
//
// 1. HISTORY ROLE TAGGING (see TURN 2+ test below): legacy AIAgent
//    tags every message as role:'user' with [name] prefix; WDK
//    distinguishes own (assistant) from other (user). Resolution
//    tracked alongside the .skip + regression marker.
//
// 2. MESSAGE ID FORMAT (4.5d-2.6): legacy AIAgent generates
//    message.id via crypto.randomUUID() (random UUID); WDK uses
//    deriveTurnMessageId() -> deterministic 'rt-${roomId}-t${turnIdx}-${agentId}'.
//    The shapes do NOT match between runtimes by design (legacy
//    randomness can't be reproduced; WDK determinism is required
//    for content-key idempotency). The DB-backed equivalence test
//    (the it.todo at the bottom) MUST exclude `message.id` from
//    field-level diffs and assert structural equivalence instead
//    (same number of message:created events, same sender order,
//    same content per turn given identical mock LLM inputs).

// ── Tests ──────────────────────────────────────────────────

describe('cross-runtime equivalence (LLM input shape)', () => {
  it('TURN 0: empty history -- both runtimes produce identical LLM input', async () => {
    // First turn ever. No history. Trivially equivalent.
    const history: HistoryMessage[] = []

    const legacy = legacyChatMessages(history)
    const wdk = wdkChatMessages(history, ALICE.id)

    expect(legacy).toEqual(wdk)

    // Mock content also identical because (systemPrompt, history) match.
    const fn = createGenerateFn(MODEL)
    const a = await fn(ALICE.systemPrompt, legacy)
    const b = await fn(ALICE.systemPrompt, wdk)
    expect(a.content).toBe(b.content)
  })

  it('TURN 1: history contains only OTHER agent -- both runtimes produce identical LLM input', async () => {
    // Bob's turn. History has one message from Alice (other).
    // Both runtimes mark Alice's message as 'user' with name prefix.
    // Equivalent.
    const history: HistoryMessage[] = [
      { senderId: ALICE.id, senderName: ALICE.name, content: '[mock:abc] turn=0' },
    ]

    const legacy = legacyChatMessages(history)
    const wdk = wdkChatMessages(history, BOB.id)

    expect(legacy).toEqual(wdk)

    const fn = createGenerateFn(MODEL)
    const a = await fn(BOB.systemPrompt, legacy)
    const b = await fn(BOB.systemPrompt, wdk)
    expect(a.content).toBe(b.content)
  })

  it.skip('TURN 2+: agent sees its OWN past message -- runtimes DIVERGE (blocked on role-tagging fix)', async () => {
    // Alice's second turn (round 2). History has Alice's own
    // turn-0 message + Bob's turn-1 reply.
    //
    // Legacy path: BOTH messages tagged role:'user' with [name]: prefix.
    // WDK path: Alice's message tagged role:'assistant' (no prefix);
    //           Bob's tagged role:'user' with [name]: prefix.
    //
    // Resolution lands in a follow-up phase (4.5d-2.4 candidate) that
    // aligns packages/core/src/agent.ts:98-99 (messageToChatMessage)
    // with the WDK transformation at apps/web/app/workflows/roundtable-workflow.ts:248-253.
    // Once that lands: un-skip this test, swap the regression-marker
    // test below to `.toEqual` / `.toBe`, and update the WDK comment
    // (currently at roundtable-workflow.ts:243-256) to drop the
    // "DIVERGES from legacy" caveat.

    const history: HistoryMessage[] = [
      { senderId: ALICE.id, senderName: ALICE.name, content: '[mock:abc] turn=0' },
      { senderId: BOB.id, senderName: BOB.name, content: '[mock:def] turn=1' },
    ]

    const legacy = legacyChatMessages(history)
    const wdk = wdkChatMessages(history, ALICE.id)

    expect(legacy).toEqual(wdk)

    const fn = createGenerateFn(MODEL)
    const a = await fn(ALICE.systemPrompt, legacy)
    const b = await fn(ALICE.systemPrompt, wdk)
    expect(a.content).toBe(b.content)
  })

  it('TURN 2+ (regression marker): the role-tagging divergence is real -- not a phantom', async () => {
    // Inverse of the .skip'd test above: prove the divergence
    // EXISTS and is DETECTABLE. If someone aligns the runtimes
    // and forgets to flip the .skip, this test will FAIL --
    // forcing the cleanup. Belt-and-suspenders against silent
    // pass once the divergence is fixed.
    const history: HistoryMessage[] = [
      { senderId: ALICE.id, senderName: ALICE.name, content: 'opening statement' },
      { senderId: BOB.id, senderName: BOB.name, content: 'rebuttal' },
    ]

    const legacy = legacyChatMessages(history)
    const wdk = wdkChatMessages(history, ALICE.id)

    expect(legacy).not.toEqual(wdk)

    const fn = createGenerateFn(MODEL)
    const a = await fn(ALICE.systemPrompt, legacy)
    const b = await fn(ALICE.systemPrompt, wdk)
    expect(a.content).not.toBe(b.content)
  })
})

describe('cross-runtime equivalence (full event stream)', () => {
  // ----------------------------------------------------------
  // PHASE TAG: 4.5d-2.4 (testing/cost-tracking pass) is the
  // natural slot to land this. Three blockers must be addressed
  // first (any order):
  //
  // 1. DB seam. apps/web/app/lib/room-store.ts is hard-bound to
  //    Drizzle + Postgres via getDb(). Both runtimes need to run
  //    in-process with predictable event state. The cleanest
  //    seam is an in-memory event-log adapter gated by
  //    WORKFLOW_TEST=1 (same flag as llm-factory.ts).
  //
  // 2. WDK runtime in tests. The WDK path imports `start` from
  //    'workflow/api' which requires the Next.js workflow runtime
  //    to be wired up. @workflow/vitest's in-process runner is
  //    the supported path -- add a vitest.integration.config.ts
  //    with the workflow() plugin (per node_modules/workflow/docs/).
  //
  // 3. Role-tagging alignment. See the .skip'd "TURN 2+" test
  //    above. Until the legacy AIAgent.messageToChatMessage at
  //    packages/core/src/agent.ts:98-99 is aligned with the WDK
  //    transformation at apps/web/app/workflows/roundtable-workflow.ts:248-253,
  //    content-level equivalence cannot hold for multi-round runs.
  //
  // Until all three are addressed, this test stays as todo.
  // ----------------------------------------------------------

  it.todo('[4.5d-2.4] runs the same scenario through http_chain and WDK, diffs DB events')
})
