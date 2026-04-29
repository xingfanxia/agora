// ============================================================
// Phase 4.5d-2.0 SPIKE — Open-chat ported to Workflow DevKit
// ============================================================
//
// Purpose: validate that WDK's `"use workflow"` + `"use step"`
// substrate can replace the http_chain advance loop, with built-in
// step caching providing the replay determinism we currently get
// from manual event-sourcing in advanceOpenChatRoom.
//
// SPIKE SHAPE — what's mocked vs production:
//   - AI generation is a deterministic stub (`[mock] {name}: turn N`)
//     so the determinism test runs offline. Production swaps in
//     generateText via @agora/llm inside `runAITurn`.
//   - Persistence is a process-local Map (`spikeStore`) so the
//     test isolates from Postgres. Production wires the existing
//     wireEventPersistence + appendEvent path.
//   - Pricing/observability are out of scope.
//
// What IS being validated:
//   1. Workflow + step composition compiles + runs under
//      @workflow/vitest's plugin.
//   2. createHook lets a human seat pause/resume by token.
//   3. Step results are cached + replayable on simulated restart
//      (waitForSleep / wakeUp / resumeHook drive deterministic
//      progress).
//   4. The orchestration loop is materially smaller than
//      advanceOpenChatRoom + its rehydration helper combined
//      (currently ~140 LOC of replay logic that WDK obviates).

import { createHook } from 'workflow'

// ── Spike-only types ───────────────────────────────────────

export interface SpikeAgent {
  /** Stable agent id — used as the seat identity in events + hook tokens. */
  readonly id: string
  readonly name: string
  /** If true, the workflow pauses on this seat's turn waiting for resumeHook. */
  readonly isHuman: boolean
}

export interface SpikeMessage {
  /** 0-based index across all turns in the run. */
  readonly turnIdx: number
  readonly agentId: string
  readonly agentName: string
  readonly text: string
}

export interface OpenChatSpikeInput {
  readonly roomId: string
  readonly agents: readonly SpikeAgent[]
  readonly topic: string
  /** Total laps through the roster. */
  readonly rounds: number
}

export interface OpenChatSpikeResult {
  readonly roomId: string
  readonly messages: readonly SpikeMessage[]
  readonly totalTurns: number
}

// ── Hook-token contract ────────────────────────────────────
//
// Deterministic per (roomId, turnIdx) so external resumers (the human
// input UI, or test harness) can compute the token without round-
// tripping to the workflow run id. Matches the pattern WDK docs
// recommend for createHook tokens.

export function humanTurnToken(roomId: string, turnIdx: number): string {
  return `agora:open-chat:${roomId}:turn-${turnIdx}`
}

// ── Workflow ───────────────────────────────────────────────

export async function openChatSpikeWorkflow(
  input: OpenChatSpikeInput,
): Promise<OpenChatSpikeResult> {
  'use workflow'

  const { roomId, agents, topic, rounds } = input
  const totalTurns = agents.length * rounds

  // Sanity. We throw FatalError-equivalent by letting it surface — the
  // workflow won't retry input-shape errors, only step-body errors.
  if (agents.length === 0) {
    throw new Error('open-chat workflow requires at least one agent')
  }
  if (rounds < 1 || rounds > 10) {
    throw new Error('rounds must be 1..10')
  }

  const messages: SpikeMessage[] = []

  for (let turnIdx = 0; turnIdx < totalTurns; turnIdx++) {
    const agentIdx = turnIdx % agents.length
    const agent = agents[agentIdx]
    if (!agent) throw new Error(`invariant: missing agent at idx ${agentIdx}`)

    if (agent.isHuman) {
      const hook = createHook<{ text: string }>({
        token: humanTurnToken(roomId, turnIdx),
      })
      const event = await hook
      const message: SpikeMessage = {
        turnIdx,
        agentId: agent.id,
        agentName: agent.name,
        text: event.text,
      }
      // Persisting human messages also flows through a step so the
      // workflow can replay deterministically — the step result is
      // cached per turnIdx, so resumed runs see the same data.
      await persistHumanMessage({ roomId, message })
      messages.push(message)
    } else {
      const message = await runAITurn({
        roomId,
        turnIdx,
        agentId: agent.id,
        agentName: agent.name,
        topic,
        priorCount: messages.length,
      })
      messages.push(message)
    }
  }

  return { roomId, messages, totalTurns }
}

// ── Steps ──────────────────────────────────────────────────
//
// Steps run with full Node.js access (no sandbox). In production,
// runAITurn calls generateText via @agora/llm; persist* writes to
// Postgres via appendEvent. The spike stays in-memory.

interface RunAITurnInput {
  readonly roomId: string
  readonly turnIdx: number
  readonly agentId: string
  readonly agentName: string
  readonly topic: string
  /** Prior message count — proxies the running history length without
   * passing the full array (would bloat the cached step input). */
  readonly priorCount: number
}

async function runAITurn(input: RunAITurnInput): Promise<SpikeMessage> {
  'use step'

  // Deterministic stub. Same input → same output, which is what makes
  // the determinism test work. Production replaces this body with a
  // real LLM call; step caching means the replay still sees the same
  // text without re-paying for the call.
  const text = mockLLMText(input)

  const message: SpikeMessage = {
    turnIdx: input.turnIdx,
    agentId: input.agentId,
    agentName: input.agentName,
    text,
  }

  await appendToSpikeStore(input.roomId, message)
  return message
}

interface PersistHumanInput {
  readonly roomId: string
  readonly message: SpikeMessage
}

async function persistHumanMessage(input: PersistHumanInput): Promise<void> {
  'use step'
  await appendToSpikeStore(input.roomId, input.message)
}

// ── Spike-only side-effect surface ─────────────────────────
//
// Process-local Map. NOT for production. Exposes get/clear so tests
// can introspect what was persisted without round-tripping through
// the workflow result.

const spikeStore = new Map<string, SpikeMessage[]>()

async function appendToSpikeStore(
  roomId: string,
  message: SpikeMessage,
): Promise<void> {
  'use step'
  const arr = spikeStore.get(roomId) ?? []
  arr.push(message)
  spikeStore.set(roomId, arr)
}

export function getSpikeMessages(roomId: string): readonly SpikeMessage[] {
  return spikeStore.get(roomId) ?? []
}

export function clearSpikeStore(): void {
  spikeStore.clear()
}

// ── Mock LLM ───────────────────────────────────────────────

function mockLLMText(input: RunAITurnInput): string {
  return `[mock] ${input.agentName} on "${input.topic}" — turn ${input.turnIdx} (after ${input.priorCount} prior)`
}
