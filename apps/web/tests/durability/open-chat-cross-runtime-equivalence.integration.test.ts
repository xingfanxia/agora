// ============================================================
// Phase 4.5d-2.10b -- Open-chat cross-runtime equivalence test
// ============================================================
//
// Mirrors the roundtable equivalence test (cross-runtime-equivalence
// .integration.test.ts) for the second production WDK port. Two
// surfaces:
//
//  (A) AI-ONLY EQUIVALENCE -- legacy http_chain (Room + AIAgent +
//      RoundRobinFlow) and WDK (openChatWorkflow) drive the same
//      fixture and produce equivalent message:created sequences.
//      Same allowlist as roundtable: id / timestamp / metadata /
//      extra event types (agent:thinking etc) excluded.
//
//  (B) HUMAN-SEAT WDK FLOW -- exercises the new (4.5d-2.10b) steps
//      `markWaitingForHuman` / `markRunningAgain` and the resumeHook
//      handoff. Asserts:
//        - workflow pauses with status='waiting' and gameState
//          contains waitingForHuman / waitingForTurnIdx
//        - resumeHook + correct payload unblocks the workflow
//        - persistHumanMessage step lands the message:created event
//        - markRunningAgain clears the breadcrumb at end-of-turn
//
// The (B) test does NOT diff against legacy because the legacy
// open-chat path uses a different human-seat mechanism (HumanAgent
// + tick pause) and the WDK path's contract is the only one that
// supports the resumeHook flow we're shipping. Equivalence at the
// observable-message-stream level is the binding meta-invariant
// for AI-only flows; human flows are verified via end-to-end shape.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resumeHook, start } from 'workflow/api'
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
  humanTurnToken,
  openChatWorkflow,
  type HumanTurnPayload,
  type OpenChatAgentSnapshot,
} from '../../app/workflows/open-chat-workflow.js'
import {
  createRoom,
  updateRoomStatus,
  type AgentInfo,
} from '../../app/lib/room-store.js'
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
  readonly personaDescription: string
}

const ALICE: AgentFixture = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Alice',
  systemPrompt: 'You are Alice. Open-chat speak.',
  personaDescription: 'Open-chat alice',
}
const BOB: AgentFixture = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Bob',
  systemPrompt: 'You are Bob. Open-chat speak.',
  personaDescription: 'Open-chat bob',
}

const TOPIC = 'What did you do this weekend?'
const ROUNDS = 2
const FIXTURES: readonly AgentFixture[] = [ALICE, BOB] as const

// ── System-prompt composition (shared with prod via buildSystemPrompt) ──

function effectiveSystemPrompt(fixture: AgentFixture): string {
  return buildSystemPrompt({
    id: fixture.id,
    name: fixture.name,
    persona: { name: fixture.name, description: fixture.personaDescription },
    model: MODEL,
    systemPrompt: fixture.systemPrompt,
  })
}

function fixtureToAgentInfo(fixture: AgentFixture, isHuman = false): AgentInfo {
  return {
    id: fixture.id,
    name: fixture.name,
    model: MODEL.modelId,
    provider: MODEL.provider,
    persona: fixture.personaDescription,
    systemPrompt: effectiveSystemPrompt(fixture),
    isHuman,
  }
}

// ── Runners ────────────────────────────────────────────────

/**
 * Drive an open-chat through the legacy http_chain runtime.
 *
 * Mirrors the legacy flow without going through the tick fetch chain
 * (we just call room.start(flow) in-process). modeId='open-chat' on
 * the room config so events carry the right tag. RoundRobinFlow with
 * `rounds: ROUNDS`. No leader, no humans (this scenario is AI-only).
 */
async function runLegacyScenario(roomId: string): Promise<void> {
  const eventBus = new EventBus()
  const roomConfig: RoomConfig = {
    id: roomId,
    name: TOPIC,
    modeId: 'open-chat',
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
    modeId: 'open-chat',
    topic: TOPIC,
    config: { topic: TOPIC, rounds: ROUNDS, agents: FIXTURES, language: 'en' },
    agents: FIXTURES.map((f) => fixtureToAgentInfo(f)),
    runtime: 'http_chain',
  })

  await room.start(flow)
  await flushRuntimePending(runtime)
  await updateRoomStatus(roomId, 'completed')
}

/** Drive an open-chat through the WDK runtime, AI-only. */
async function runWdkAIOnlyScenario(roomId: string): Promise<void> {
  await createRoom({
    id: roomId,
    modeId: 'open-chat',
    topic: TOPIC,
    config: { topic: TOPIC, rounds: ROUNDS, agents: FIXTURES, language: 'en' },
    agents: FIXTURES.map((f) => fixtureToAgentInfo(f)),
    runtime: 'wdk',
  })

  const snapshots: OpenChatAgentSnapshot[] = FIXTURES.map((fixture) => ({
    id: fixture.id,
    name: fixture.name,
    persona: fixture.personaDescription,
    systemPrompt: effectiveSystemPrompt(fixture),
    model: MODEL,
  }))

  const run = await start(openChatWorkflow, [
    {
      roomId,
      agents: snapshots,
      topic: TOPIC,
      rounds: ROUNDS,
    },
  ])
  await run.returnValue
}

// ── Comparison helpers ─────────────────────────────────────

interface ComparableMessage {
  readonly senderId: string
  readonly senderName: string
  readonly content: string
  readonly channelId: string
}

/**
 * Same projection as roundtable's equivalence test: drop id /
 * timestamp / metadata (known divergences per allowlist), filter to
 * `message:created` so legacy's extra realtime events
 * (agent:thinking, agent:done, round:changed) drop out.
 */
function comparableMessages(roomId: string): ComparableMessage[] {
  return getMemoryEvents(roomId)
    .filter((row) => row.type === 'message:created')
    .map((row) => {
      const evt = row.payload as Extract<PlatformEvent, { type: 'message:created' }>
      const msg = evt.message as Message | undefined
      if (!msg) {
        // Defense-in-depth: if a future store-bug stamps a
        // message:created event without a payload.message, fail with
        // a useful assertion error instead of TypeError. The current
        // codebase always sets it, so this branch is dead.
        throw new Error(
          `comparableMessages: message:created event missing payload.message in room ${roomId}`,
        )
      }
      return {
        senderId: msg.senderId,
        senderName: msg.senderName,
        content: msg.content,
        channelId: msg.channelId,
      }
    })
}

// ── (A) AI-only equivalence ────────────────────────────────

describe('open-chat cross-runtime equivalence (AI-only)', () => {
  beforeEach(() => {
    resetMemoryStore()
  })
  afterEach(() => {
    resetMemoryStore()
  })

  it('http_chain and WDK produce equivalent message:created sequences', async () => {
    // Run WDK first to take the workflow runtime cold-start hit
    // before the legacy path runs in-process. Order doesn't affect
    // equivalence -- the in-memory store is keyed on roomId.
    const wdkRoomId = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    await runWdkAIOnlyScenario(wdkRoomId)
    const wdkMessages = comparableMessages(wdkRoomId)

    const legacyRoomId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    await runLegacyScenario(legacyRoomId)
    const legacyMessages = comparableMessages(legacyRoomId)

    expect(legacyMessages).toHaveLength(FIXTURES.length * ROUNDS)
    expect(wdkMessages).toHaveLength(legacyMessages.length)

    // Element-wise structural equivalence -- senderId/senderName/
    // content/channelId match per turn. id and timestamp excluded
    // by `comparableMessages` per the divergence allowlist.
    expect(wdkMessages).toEqual(legacyMessages)
  })
})

// ── (B) Human-seat WDK flow ────────────────────────────────

/**
 * Poll the in-memory room store until status matches `target`, or
 * timeout. Used to await the workflow's pause-on-human-seat without
 * relying on internal WDK signals -- the room.status='waiting'
 * transition is the public contract from `markWaitingForHuman`.
 */
async function waitForRoomStatus(
  roomId: string,
  target: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const room = getMemoryRoom(roomId)
    if (room?.status === target) return
    await new Promise((r) => setTimeout(r, 25))
  }
  const actual = getMemoryRoom(roomId)?.status ?? '<no room>'
  throw new Error(
    `timeout (${timeoutMs}ms) waiting for room ${roomId} status='${target}'; actual='${actual}'`,
  )
}

describe('open-chat WDK human-seat flow (4.5d-2.10b)', () => {
  beforeEach(() => {
    resetMemoryStore()
  })
  afterEach(() => {
    resetMemoryStore()
  })

  it('pauses on human turn, resumes via resumeHook, completes', async () => {
    const roomId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
    // 1 AI (Alice, turn 0) + 1 human (Bob, turn 1). 1 round so the
    // workflow only pauses once -- simpler than testing multi-round
    // multi-pause sequences.
    const HUMAN_ROUNDS = 1

    await createRoom({
      id: roomId,
      modeId: 'open-chat',
      topic: TOPIC,
      config: { topic: TOPIC, rounds: HUMAN_ROUNDS, agents: FIXTURES, language: 'en' },
      agents: [fixtureToAgentInfo(ALICE), fixtureToAgentInfo(BOB, true)],
      runtime: 'wdk',
    })

    const snapshots: OpenChatAgentSnapshot[] = [
      {
        id: ALICE.id,
        name: ALICE.name,
        persona: ALICE.personaDescription,
        systemPrompt: effectiveSystemPrompt(ALICE),
        model: MODEL,
      },
      {
        id: BOB.id,
        name: BOB.name,
        persona: BOB.personaDescription,
        systemPrompt: effectiveSystemPrompt(BOB),
        model: MODEL,
        isHuman: true,
      },
    ]

    // Start without awaiting completion -- the workflow will pause
    // at Bob's turn and we need to inject the resumeHook before
    // letting it complete.
    const run = await start(openChatWorkflow, [
      {
        roomId,
        agents: snapshots,
        topic: TOPIC,
        rounds: HUMAN_ROUNDS,
      },
    ])

    // Workflow runs Alice's AI turn (turnIdx=0), then reaches Bob's
    // human turn (turnIdx=1) -- markWaitingForHuman fires, status
    // flips to 'waiting'. Poll until that lands.
    await waitForRoomStatus(roomId, 'waiting')

    const pausedRoom = getMemoryRoom(roomId)
    expect(pausedRoom?.status).toBe('waiting')

    // Verify the workflow → endpoint contract: gameState carries
    // BOTH waitingForHuman (legacy UI shape) AND waitingForTurnIdx
    // (new for WDK -- the human-input endpoint reads it to
    // reconstruct the hook token).
    const gs = pausedRoom?.gameState as Record<string, unknown> | null
    expect(gs?.['waitingForHuman']).toBe(BOB.id)
    expect(gs?.['waitingForTurnIdx']).toBe(1)
    // waitingSince is a Date.now() timestamp -- just type-check it.
    expect(typeof gs?.['waitingSince']).toBe('number')

    // Inject the human's reply via the same resumeHook contract the
    // production endpoint uses.
    const token = humanTurnToken(roomId, 1)
    const payload: HumanTurnPayload = { text: 'Bob says hi' }
    await resumeHook(token, payload)

    // Workflow resumes: persistHumanMessage step writes the message,
    // markRunningAgain clears waitingForHuman + flips status, loop
    // exits, markRoomComplete fires.
    await run.returnValue

    const finalRoom = getMemoryRoom(roomId)
    expect(finalRoom?.status).toBe('completed')

    // Breadcrumb cleared by markRunningAgain. The fact that
    // markRoomComplete was reached implies markRunningAgain ran.
    const finalGs = finalRoom?.gameState as Record<string, unknown> | null
    expect(finalGs?.['waitingForHuman']).toBeUndefined()
    expect(finalGs?.['waitingForTurnIdx']).toBeUndefined()
    expect(finalGs?.['waitingSince']).toBeUndefined()

    // Two messages: Alice's AI turn (mock content) + Bob's human reply.
    const messages = comparableMessages(roomId)
    expect(messages).toHaveLength(2)
    expect(messages[0]?.senderId).toBe(ALICE.id)
    expect(messages[1]).toEqual({
      senderId: BOB.id,
      senderName: BOB.name,
      content: 'Bob says hi',
      channelId: 'main',
    })
  })

  it('rejects empty-text resumeHook payload via FatalError', async () => {
    // Defense-in-depth: the workflow body's `event.text` non-empty
    // check (4.5d-2.9) catches resumes from tooling outside the
    // human-input endpoint. A FatalError should propagate to the
    // outer try/catch's markRoomError step -- room ends in 'error'
    // state, not 'completed' or 'waiting'.
    const roomId = 'fafafafa-fafa-fafa-fafa-fafafafafafa'

    await createRoom({
      id: roomId,
      modeId: 'open-chat',
      topic: TOPIC,
      config: { topic: TOPIC, rounds: 1, agents: FIXTURES, language: 'en' },
      agents: [fixtureToAgentInfo(ALICE), fixtureToAgentInfo(BOB, true)],
      runtime: 'wdk',
    })

    const snapshots: OpenChatAgentSnapshot[] = [
      {
        id: ALICE.id,
        name: ALICE.name,
        persona: ALICE.personaDescription,
        systemPrompt: effectiveSystemPrompt(ALICE),
        model: MODEL,
      },
      {
        id: BOB.id,
        name: BOB.name,
        persona: BOB.personaDescription,
        systemPrompt: effectiveSystemPrompt(BOB),
        model: MODEL,
        isHuman: true,
      },
    ]

    const run = await start(openChatWorkflow, [
      { roomId, agents: snapshots, topic: TOPIC, rounds: 1 },
    ])

    await waitForRoomStatus(roomId, 'waiting')

    // Empty text -- workflow body throws FatalError on receipt.
    const token = humanTurnToken(roomId, 1)
    await resumeHook(token, { text: '' } satisfies HumanTurnPayload)

    // The FatalError throw inside the workflow propagates to the
    // outer catch which calls markRoomError -- run.returnValue
    // rejects with the original FatalError message.
    await expect(run.returnValue).rejects.toThrow(/human payload missing text/)

    const finalRoom = getMemoryRoom(roomId)
    expect(finalRoom?.status).toBe('error')
  })

  it('multi-round multi-pause: clears breadcrumb between iterations', async () => {
    // Drives a 2-round (4 turns total) scenario where Bob is a human
    // seat. The workflow pauses at turn 1 and turn 3 -- two full
    // pause/resume cycles. Verifies that markRunningAgain fully
    // clears the breadcrumb between iterations (so iteration 2's
    // markWaitingForHuman doesn't merge stale state) and that each
    // iteration uses a distinct hook token (different turnIdx). This
    // closes the coverage gap noted in the 4.5d-2.10b code review:
    // single-pause tests don't exercise inter-cycle cleanup.
    const roomId = 'fbfbfbfb-fbfb-fbfb-fbfb-fbfbfbfbfbfb'
    const HUMAN_ROUNDS = 2

    await createRoom({
      id: roomId,
      modeId: 'open-chat',
      topic: TOPIC,
      config: {
        topic: TOPIC,
        rounds: HUMAN_ROUNDS,
        agents: FIXTURES,
        language: 'en',
      },
      agents: [fixtureToAgentInfo(ALICE), fixtureToAgentInfo(BOB, true)],
      runtime: 'wdk',
    })

    const snapshots: OpenChatAgentSnapshot[] = [
      {
        id: ALICE.id,
        name: ALICE.name,
        persona: ALICE.personaDescription,
        systemPrompt: effectiveSystemPrompt(ALICE),
        model: MODEL,
      },
      {
        id: BOB.id,
        name: BOB.name,
        persona: BOB.personaDescription,
        systemPrompt: effectiveSystemPrompt(BOB),
        model: MODEL,
        isHuman: true,
      },
    ]

    const run = await start(openChatWorkflow, [
      {
        roomId,
        agents: snapshots,
        topic: TOPIC,
        rounds: HUMAN_ROUNDS,
      },
    ])

    // ── First pause (turnIdx=1) ─────────────────────────────
    await waitForRoomStatus(roomId, 'waiting')
    const firstPauseGs = getMemoryRoom(roomId)?.gameState as
      | Record<string, unknown>
      | null
    expect(firstPauseGs?.['waitingForHuman']).toBe(BOB.id)
    expect(firstPauseGs?.['waitingForTurnIdx']).toBe(1)

    await resumeHook(humanTurnToken(roomId, 1), {
      text: 'Bob round 1',
    } satisfies HumanTurnPayload)

    // ── Second pause (turnIdx=3) ────────────────────────────
    // After resuming, the workflow runs Alice's round-2 turn (idx=2),
    // then pauses again at Bob's round-2 turn (idx=3). The status
    // briefly returns to 'running' and then back to 'waiting' --
    // poll for 'waiting' again, but use a transitional check so
    // we don't accidentally hit the still-paused-from-iter-1 state.
    //
    // Wait for status to leave 'waiting' first (proves iteration 1
    // actually completed via markRunningAgain).
    const transitDeadline = Date.now() + 10_000
    while (Date.now() < transitDeadline) {
      const cur = getMemoryRoom(roomId)?.status
      if (cur !== 'waiting') break
      await new Promise((r) => setTimeout(r, 25))
    }
    if (getMemoryRoom(roomId)?.status === 'waiting') {
      throw new Error('iteration 1 markRunningAgain never ran')
    }

    await waitForRoomStatus(roomId, 'waiting')

    const secondPauseGs = getMemoryRoom(roomId)?.gameState as
      | Record<string, unknown>
      | null
    // Same agentId, different turnIdx -- proves the iteration is
    // distinct and the breadcrumb refreshed correctly.
    expect(secondPauseGs?.['waitingForHuman']).toBe(BOB.id)
    expect(secondPauseGs?.['waitingForTurnIdx']).toBe(3)

    // Distinct hook token (different turnIdx).
    const t1 = humanTurnToken(roomId, 1)
    const t3 = humanTurnToken(roomId, 3)
    expect(t1).not.toBe(t3)

    await resumeHook(t3, {
      text: 'Bob round 2',
    } satisfies HumanTurnPayload)

    // ── Completion ──────────────────────────────────────────
    await run.returnValue

    const finalRoom = getMemoryRoom(roomId)
    expect(finalRoom?.status).toBe('completed')

    // Breadcrumb fully cleared at end (markRunningAgain ran for both
    // iterations).
    const finalGs = finalRoom?.gameState as Record<string, unknown> | null
    expect(finalGs?.['waitingForHuman']).toBeUndefined()
    expect(finalGs?.['waitingForTurnIdx']).toBeUndefined()
    expect(finalGs?.['waitingSince']).toBeUndefined()

    // 4 messages: alice-r1 (AI), bob-r1 (human), alice-r2 (AI), bob-r2 (human).
    const messages = comparableMessages(roomId)
    expect(messages).toHaveLength(4)
    expect(messages[1]?.content).toBe('Bob round 1')
    expect(messages[3]?.content).toBe('Bob round 2')
  })
})
