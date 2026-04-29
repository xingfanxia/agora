// ============================================================
// Phase 4.5d-2.3 + 4.5d-2.8 -- Cross-runtime equivalence test
// ============================================================
//
// Binding meta-invariant of the durability contract (4.5d-2.1):
// for the same scenario, http_chain and WDK runtimes must produce
// identical message:created events. Different infrastructure, same
// observable behavior. If this invariant breaks, the WDK migration
// is unsafe to flip on by default.
//
// Two complementary surfaces in this file:
//
//  (A) LLM-INPUT EQUIVALENCE -- pure unit-style assertions on the
//      hand-rolled replicas of each runtime's history-to-chat
//      transformation. Foundation; doesn't need a DB or runtime.
//
//  (B) FULL EVENT-STREAM EQUIVALENCE (4.5d-2.8) -- drives the same
//      scenario through both runtimes via the in-memory room-store
//      seam (room-store-memory.ts) and diffs message:created events.
//      Requires @workflow/vitest's in-process runner (configured in
//      vitest.integration.config.ts at the apps/web root).
//
// The PARTIAL equivalence we'd CAN prove without DB:
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { start } from 'workflow/api'
import {
  AIAgent,
  buildSystemPrompt,
  EventBus,
  Room,
  RoundRobinFlow,
} from '@agora/core'
import type { TokenAccountant } from '@agora/core'
import type {
  Message,
  ModelConfig,
  PersonaConfig,
  PlatformEvent,
  RoomConfig,
} from '@agora/shared'
import { createGenerateFn } from '../../app/lib/llm-factory.js'
import {
  roundtableWorkflow,
  type RoundtableAgentSnapshot,
} from '../../app/workflows/roundtable-workflow.js'
import { createRoom, updateRoomStatus, type AgentInfo } from '../../app/lib/room-store.js'
import {
  flushRuntimePending,
  wireEventPersistence,
} from '../../app/lib/persist-runtime.js'
import type { RuntimeEntry } from '../../app/lib/runtime-registry.js'
import {
  getMemoryEvents,
  getMemoryRoom,
  resetMemoryStore,
} from '../../app/lib/room-store-memory.js'

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
  /** Description text the legacy AIAgent's buildSystemPrompt() appends. */
  readonly personaDescription: string
}

const ALICE: AgentFixture = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Alice',
  systemPrompt: 'You are Alice. Argue for caution.',
  personaDescription: 'Argues for caution',
}
const BOB: AgentFixture = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Bob',
  systemPrompt: 'You are Bob. Argue for ambition.',
  personaDescription: 'Argues for ambition',
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
// durability contract. The (B) integration test diffs only the
// dimensions that constitute equivalence; the items below are
// EXPECTED differences, intentionally excluded from the diff.
//
// 1. MESSAGE-LEVEL field divergences within `message:created` events:
//
//    a. `id`: legacy generates via crypto.randomUUID() (random);
//       WDK uses deriveTurnMessageId() -> deterministic
//       'rt-${roomId}-t${turnIdx}-${agentId}' (4.5d-2.6).
//       Random/deterministic by design; shapes never match.
//
//    b. `timestamp`: both runtimes set Date.now() at write time;
//       two back-to-back runs land at different millisecond values.
//
//    c. `metadata`: legacy AIAgent populates
//       `{ tokenUsage, provider, modelId }` (agent.ts ~204);
//       WDK populates `{ turnIdx }` (roundtable-workflow.ts ~401).
//       Legacy embeds token attribution in the message; WDK carries
//       it on a separate `token:recorded` event. Both readers go
//       through the events log so the live UI is consistent, but
//       the per-message metadata SHAPE differs.
//
//    `comparableMessages` projects only senderId/senderName/
//    content/channelId so all three are silently excluded.
//
// 2. EVENT-STREAM divergences (extra event types one runtime emits
//    that the other does not):
//
//    a. Legacy emits `agent:thinking` / `agent:done` / `round:changed`
//       / `room:created` / `agent:joined` (realtime UX events).
//       WDK does not -- only `room:started` / `message:created` /
//       `token:recorded` / `room:ended` are part of its durable
//       contract.
//
//    b. Legacy under the test's TokenAccountant STUB emits ZERO
//       `token:recorded` events; WDK emits one per turn. The
//       test stubs the accountant deliberately because the diff
//       targets `message:created` only -- if a future test asserts
//       on token events, swap in the real `TokenAccountant`.
//
//    `comparableMessages` filters to `message:created` so all of
//    these are silently excluded.
//
// (Resolved: HISTORY ROLE TAGGING was the previous open divergence;
// 4.5d-2.7 aligned legacy AIAgent with WDK's own->assistant /
// other->user pattern. The TURN 2+ tests below now assert toEqual.)
//
// (Resolved: SYSTEM PROMPT WRAPPING -- the legacy AIAgent's
// buildSystemPrompt() composes [systemPrompt, persona.systemPrompt,
// `You are ${persona.name}. ${persona.description}`] but WDK passes
// snapshot.systemPrompt verbatim. The (B) test now uses the
// EXPORTED `buildSystemPrompt` from @agora/core to pre-wrap the WDK
// snapshot, so a future change to that helper inherits automatically
// -- the previous hand-rolled replica was a silent-drift hazard.)

// ── (A) LLM-input shape tests ──────────────────────────────

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

// ── (B) Full event-stream equivalence (4.5d-2.8) ───────────

const TOPIC = 'Should we accelerate AI development?'
const ROUNDS = 2
const FIXTURES: readonly AgentFixture[] = [ALICE, BOB] as const

/**
 * Compose the LLM-facing system prompt the way legacy AIAgent.reply()
 * does, by routing the fixture through the SAME `buildSystemPrompt`
 * function the production AIAgent uses. The WDK roundtable workflow
 * passes `snapshot.systemPrompt` verbatim to generateFn, while legacy
 * wraps the agent's config via buildSystemPrompt before calling
 * generateFn -- so without this pre-wrap on the WDK snapshot the
 * mock LLM hashes would diverge between runtimes.
 *
 * Sharing the function (rather than a hand-rolled replica) was the
 * 4.5d-2.8 fix for the silent-drift hazard: any future change to
 * buildSystemPrompt is inherited automatically here.
 */
function effectiveSystemPrompt(fixture: AgentFixture): string {
  return buildSystemPrompt({
    id: fixture.id,
    name: fixture.name,
    persona: { name: fixture.name, description: fixture.personaDescription },
    model: MODEL,
    systemPrompt: fixture.systemPrompt,
  })
}

function fixtureToAgentInfo(fixture: AgentFixture): AgentInfo {
  return {
    id: fixture.id,
    name: fixture.name,
    model: MODEL.modelId,
    provider: MODEL.provider,
    persona: fixture.personaDescription,
    systemPrompt: effectiveSystemPrompt(fixture),
  }
}

/**
 * Drive a roundtable through the legacy http_chain runtime. Mirrors
 * the http_chain branch of POST /api/rooms (apps/web/app/api/rooms/
 * route.ts) minus auth, pricing wiring, and the waitUntil() async
 * dispatch. The TokenAccountant is intentionally stubbed -- this
 * test diffs message:created events only, and the accountant only
 * affects token:recorded.
 */
async function runLegacyScenario(roomId: string): Promise<void> {
  const eventBus = new EventBus()
  const roomConfig: RoomConfig = {
    id: roomId,
    name: TOPIC,
    modeId: 'roundtable',
    topic: TOPIC,
    maxAgents: FIXTURES.length,
  }
  const room = new Room(roomConfig, eventBus)

  for (const fixture of FIXTURES) {
    const persona: PersonaConfig = {
      name: fixture.name,
      description: fixture.personaDescription,
    }
    const agent = new AIAgent(
      {
        id: fixture.id,
        name: fixture.name,
        persona,
        model: MODEL,
        systemPrompt: fixture.systemPrompt,
      },
      createGenerateFn(MODEL),
    )
    room.addAgent(agent)
  }

  const flow = new RoundRobinFlow({ rounds: ROUNDS })
  const runtime: RuntimeEntry = {
    eventBus,
    room,
    flow,
    accountant: { dispose() {} } as unknown as TokenAccountant,
    seq: 0,
    pending: Promise.resolve(),
  }
  wireEventPersistence(roomId, eventBus, runtime)

  await createRoom({
    id: roomId,
    modeId: 'roundtable',
    topic: TOPIC,
    config: { topic: TOPIC, rounds: ROUNDS, agents: FIXTURES, language: 'en' },
    agents: FIXTURES.map(fixtureToAgentInfo),
    runtime: 'http_chain',
  })

  await room.start(flow)
  await flushRuntimePending(runtime)
  await updateRoomStatus(roomId, 'completed')
}

/**
 * Drive a roundtable through the WDK runtime. Mirrors the wdk
 * branch of POST /api/rooms minus the createRoom -> start() race
 * and the API response. `await run.returnValue` blocks until the
 * workflow completes (in-process via @workflow/vitest's local
 * world), so by the time it resolves all step events have landed
 * in the room-store seam.
 */
async function runWdkScenario(roomId: string): Promise<void> {
  await createRoom({
    id: roomId,
    modeId: 'roundtable',
    topic: TOPIC,
    config: { topic: TOPIC, rounds: ROUNDS, agents: FIXTURES, language: 'en' },
    agents: FIXTURES.map(fixtureToAgentInfo),
    runtime: 'wdk',
  })

  const snapshots: RoundtableAgentSnapshot[] = FIXTURES.map((fixture) => ({
    id: fixture.id,
    name: fixture.name,
    persona: fixture.personaDescription,
    systemPrompt: effectiveSystemPrompt(fixture),
    model: MODEL,
  }))

  const run = await start(roundtableWorkflow, [
    {
      roomId,
      agents: snapshots,
      topic: TOPIC,
      rounds: ROUNDS,
    },
  ])
  await run.returnValue
}

interface ComparableMessage {
  readonly senderId: string
  readonly senderName: string
  readonly content: string
  readonly channelId: string
}

/**
 * Project the in-memory event log to a comparable shape. Excludes
 * the two known divergences (message.id, timestamp) per the
 * allowlist comment above. Filters to message:created since legacy
 * emits agent:thinking / agent:done / round:changed events that
 * WDK does not (those are realtime UX events, not part of the
 * durable contract).
 */
function comparableMessages(roomId: string): ComparableMessage[] {
  return getMemoryEvents(roomId)
    .filter((row) => row.type === 'message:created')
    .map((row) => {
      const msg = (row.payload as Extract<PlatformEvent, { type: 'message:created' }>)
        .message as Message
      return {
        senderId: msg.senderId,
        senderName: msg.senderName,
        content: msg.content,
        channelId: msg.channelId,
      }
    })
}

describe('cross-runtime equivalence (full event stream)', () => {
  beforeEach(() => {
    resetMemoryStore()
  })
  afterEach(() => {
    resetMemoryStore()
  })

  it('http_chain and WDK produce equivalent message:created sequences', async () => {
    // Run WDK first to take the workflow runtime cold-start hit
    // before the legacy path runs in-process. Order doesn't affect
    // equivalence -- the in-memory store is keyed on roomId so the
    // two scenarios don't interfere.
    const wdkRoomId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    await runWdkScenario(wdkRoomId)
    const wdkMessages = comparableMessages(wdkRoomId)

    const legacyRoomId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    await runLegacyScenario(legacyRoomId)
    const legacyMessages = comparableMessages(legacyRoomId)

    // Each runtime produced agents.length * rounds messages.
    expect(legacyMessages).toHaveLength(FIXTURES.length * ROUNDS)
    expect(wdkMessages).toHaveLength(legacyMessages.length)

    // Element-wise structural equivalence -- senderId/senderName/
    // content/channelId match per turn. id and timestamp excluded
    // by `comparableMessages` per the divergence allowlist.
    expect(wdkMessages).toEqual(legacyMessages)
  })

  it('WDK marks the room completed after the workflow body returns', async () => {
    // Quick sanity check that the markRoomComplete step ran end-to-end
    // -- exercises the in-memory updateRoomStatus seam and proves the
    // workflow body's terminal-error guard didn't mistakenly catch a
    // success case as failure. Cheap to add since the runtime is
    // already cold-started by the previous test.
    const roomId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
    await runWdkScenario(roomId)
    expect(getMemoryRoom(roomId)?.status).toBe('completed')
  })
})
