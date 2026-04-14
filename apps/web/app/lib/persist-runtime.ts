// ============================================================
// Wires an EventBus → Postgres so every emit persists durably
// ============================================================
//
// Called once at room creation, after the accountant is constructed.
// Uses the runtime registry's `seq` + `pending` chain to guarantee
// events land in monotonic order even under concurrent emits from
// multiple event types.

import type { EventBus } from '@agora/core'
import {
  appendEvent,
  incrementMessageCount,
  recordTokenUsage,
  setCurrentPhase,
  setCurrentRound,
  setGameState,
  setThinkingAgent,
  updateRoomStatus,
} from './room-store.js'
import type { RuntimeEntry } from './runtime-registry.js'

/**
 * Every listener below captures and persists the event by chaining
 * onto `runtime.pending`. This linearizes DB writes so seq is
 * strictly monotonic. The listeners never await in the EventBus
 * hot path — they enqueue work on `runtime.pending`.
 */
export function wireEventPersistence(
  roomId: string,
  eventBus: EventBus,
  runtime: RuntimeEntry,
): void {
  const enqueue = (task: () => Promise<unknown>) => {
    runtime.pending = runtime.pending
      .then(task)
      .catch((err) => {
        // Don't let a persistence error kill the live runtime — log + drop
        console.error(`[persist] room=${roomId}`, err)
      })
  }

  const persist = (event: Parameters<EventBus['emit']>[0]) => {
    const seq = runtime.seq++
    enqueue(() => appendEvent(roomId, seq, event))
  }

  // ── Event-type specific hooks ────────────────────────────

  eventBus.on('message:created', (event) => {
    persist(event)
    enqueue(() => incrementMessageCount(roomId))
  })

  eventBus.on('agent:thinking', (event) => {
    persist(event)
    enqueue(() => setThinkingAgent(roomId, event.agentId))
  })

  eventBus.on('agent:done', (event) => {
    persist(event)
    enqueue(() => setThinkingAgent(roomId, null))
  })

  eventBus.on('round:changed', (event) => {
    persist(event)
    enqueue(() => setCurrentRound(roomId, event.round))
  })

  eventBus.on('phase:changed', (event) => {
    persist(event)
    enqueue(() => setCurrentPhase(roomId, event.phase))
  })

  eventBus.on('token:recorded', (event) => {
    persist(event)
    enqueue(() => recordTokenUsage(roomId, event.usage, event.cost))
  })

  eventBus.on('room:started', (event) => {
    persist(event)
  })

  eventBus.on('room:ended', (event) => {
    persist(event)
    // Note: updateRoomStatus('completed') is called by the caller
    // after room.start() resolves, to preserve error propagation.
  })

  eventBus.on('agent:joined', (event) => persist(event))
  eventBus.on('agent:left', (event) => persist(event))
  eventBus.on('room:created', (event) => persist(event))
}

/**
 * Helper: wait for all pending writes to drain. Call at the end of
 * runRoom() in the lambda to ensure state is durable before returning.
 */
export async function flushRuntimePending(runtime: RuntimeEntry): Promise<void> {
  await runtime.pending.catch(() => undefined)
}

/**
 * Snapshot the custom game state (werewolf gameState) on phase boundaries.
 * Called from the game-creation path; listens separately so modes with no
 * custom state don't have to wire this.
 */
export function wireGameStateSnapshots(
  roomId: string,
  eventBus: EventBus,
  runtime: RuntimeEntry,
  getCustomState: () => Record<string, unknown>,
): void {
  const enqueue = (task: () => Promise<unknown>) => {
    runtime.pending = runtime.pending.then(task).catch((err) => {
      console.error(`[persist gameState] room=${roomId}`, err)
    })
  }

  eventBus.on('phase:changed', () => {
    const snapshot = getCustomState()
    enqueue(() => setGameState(roomId, snapshot))
  })

  eventBus.on('room:ended', () => {
    const snapshot = getCustomState()
    enqueue(() => setGameState(roomId, snapshot))
  })
}
