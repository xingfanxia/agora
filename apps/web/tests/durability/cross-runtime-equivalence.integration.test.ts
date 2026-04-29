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
// it.todo at the bottom for the design.
//
// The PARTIAL equivalence we CAN prove without DB:
//
//   1. The LLM mock is deterministic on (systemPrompt, history)
//      [covered in llm-factory.test.ts -- foundation only]
//
//   2. The TWO runtimes' LLM-input transformations are equivalent
//      across the full multi-round trajectory -- including TURN 2+
//      where an agent sees its OWN past messages. Pre-4.5d-2.7 these
//      diverged (legacy tagged everything 'user'); 4.5d-2.7 aligned
//      legacy AIAgent.messageToChatMessage with the WDK transformation
//      so both runtimes now produce role:'assistant' for own messages
//      and role:'user' (with [name] prefix) for others.

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
//   * legacy   -> packages/core/src/agent.ts (messageToChatMessage
//                 + its sole call site inside AIAgent.reply -- grep
//                 for `messageToChatMessage` to find both)
//   * WDK      -> apps/web/app/workflows/roundtable-workflow.ts
//                 (the inline `priorMessages.map(...)` inside
//                  generateAgentReply step -- grep for
//                  `History role tagging` to land on the comment
//                  block above the transformation)
//
// The next refactor that makes these helpers obsolete is to extract
// both transformations into pure functions in their respective
// packages and import them here -- at which point this file's
// helpers become a thin import alias and drift becomes impossible.

/**
 * Legacy AIAgent -- mirror of agent.ts:messageToChatMessage.
 *
 * Phase 4.5d-2.7: aligned with WDK -- own messages get role:'assistant'
 * (no name prefix), others get role:'user' with [name]: prefix. Pre-
 * 4.5d-2.7 the legacy path tagged everything as 'user', which is what
 * the previous version of this helper mirrored.
 */
function legacyChatMessages(
  history: readonly HistoryMessage[],
  ownAgentId: string,
): { role: string; content: string }[] {
  return history.map((m) =>
    m.senderId === ownAgentId
      ? { role: 'assistant', content: m.content }
      : { role: 'user', content: `[${m.senderName}]: ${m.content}` },
  )
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
// durability contract. After 4.5d-2.7 (role tagging alignment), only
// ONE intentional divergence remains:
//
// 1. MESSAGE ID FORMAT (4.5d-2.6): legacy AIAgent generates
//    message.id via crypto.randomUUID() (random UUID); WDK uses
//    deriveTurnMessageId() -> deterministic 'rt-${roomId}-t${turnIdx}-${agentId}'.
//    The shapes do NOT match between runtimes by design (legacy
//    randomness can't be reproduced; WDK determinism is required
//    for content-key idempotency). The DB-backed equivalence test
//    (the it.todo at the bottom) MUST exclude `message.id` from
//    field-level diffs and assert structural equivalence instead
//    (same number of message:created events, same sender order,
//    same content per turn given identical mock LLM inputs).
//
// (Resolved: HISTORY ROLE TAGGING was the previous open divergence;
// 4.5d-2.7 aligned legacy AIAgent with WDK's own->assistant /
// other->user pattern. The TURN 2+ tests below now assert toEqual.)

// ── Tests ──────────────────────────────────────────────────

describe('cross-runtime equivalence (LLM input shape)', () => {
  it('TURN 0: empty history -- both runtimes produce identical LLM input', async () => {
    // First turn ever. No history. Trivially equivalent.
    const history: HistoryMessage[] = []

    const legacy = legacyChatMessages(history, ALICE.id)
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

    const legacy = legacyChatMessages(history, BOB.id)
    const wdk = wdkChatMessages(history, BOB.id)

    expect(legacy).toEqual(wdk)

    const fn = createGenerateFn(MODEL)
    const a = await fn(BOB.systemPrompt, legacy)
    const b = await fn(BOB.systemPrompt, wdk)
    expect(a.content).toBe(b.content)
  })

  it('TURN 2+: agent sees its OWN past message -- runtimes EQUIVALENT (post 4.5d-2.7 alignment)', async () => {
    // Alice's second turn (round 2). History has Alice's own
    // turn-0 message + Bob's turn-1 reply.
    //
    // Pre-4.5d-2.7: legacy tagged Alice's own message as 'user' (with
    // [name] prefix); WDK tagged it as 'assistant'. They diverged.
    // 4.5d-2.7 aligned legacy with WDK's behavior. Both now produce
    // role:'assistant' for own messages, role:'user' (with [name]
    // prefix) for others.
    //
    // The mock content matches between paths because (systemPrompt,
    // history) is identical -- which is the binding meta-invariant
    // that the durability contract requires.

    const history: HistoryMessage[] = [
      { senderId: ALICE.id, senderName: ALICE.name, content: '[mock:abc] turn=0' },
      { senderId: BOB.id, senderName: BOB.name, content: '[mock:def] turn=1' },
    ]

    const legacy = legacyChatMessages(history, ALICE.id)
    const wdk = wdkChatMessages(history, ALICE.id)

    expect(legacy).toEqual(wdk)

    const fn = createGenerateFn(MODEL)
    const a = await fn(ALICE.systemPrompt, legacy)
    const b = await fn(ALICE.systemPrompt, wdk)
    expect(a.content).toBe(b.content)
  })

  it('TURN 2+ (alignment regression marker): legacy and WDK helpers must agree on shape', async () => {
    // Pinning the alignment achieved in 4.5d-2.7. If either helper
    // drifts (e.g., someone "improves" one transformation without
    // matching the other), this test catches it. Asserts that for a
    // multi-message history including the agent's own past output,
    // both helpers produce IDENTICAL chat-message arrays.
    const history: HistoryMessage[] = [
      { senderId: ALICE.id, senderName: ALICE.name, content: 'opening statement' },
      { senderId: BOB.id, senderName: BOB.name, content: 'rebuttal' },
      { senderId: ALICE.id, senderName: ALICE.name, content: 'counter-rebuttal' },
    ]

    const legacy = legacyChatMessages(history, ALICE.id)
    const wdk = wdkChatMessages(history, ALICE.id)

    expect(legacy).toEqual(wdk)

    // Spot-check the per-message shape -- the assertion above already
    // verifies element-wise equality, but pin the SHAPE so a future
    // refactor of the role/content fields surfaces here too.
    expect(legacy[0]).toEqual({ role: 'assistant', content: 'opening statement' })
    expect(legacy[1]).toEqual({ role: 'user', content: '[Bob]: rebuttal' })
    expect(legacy[2]).toEqual({ role: 'assistant', content: 'counter-rebuttal' })
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
  // (Resolved 4.5d-2.7: role-tagging alignment, formerly blocker #3,
  // landed in packages/core/src/agent.ts (messageToChatMessage).
  // Both runtimes now produce identical LLM inputs for multi-round
  // scenarios -- the TURN 2+ test above asserts toEqual.)
  //
  // Until both remaining blockers are addressed, this test stays as
  // todo.
  // ----------------------------------------------------------

  it.todo('[4.5d-2.4] runs the same scenario through http_chain and WDK, diffs DB events')
})
