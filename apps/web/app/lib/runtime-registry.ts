// ============================================================
// Runtime registry — live in-memory objects per active room
// ============================================================
//
// Only the lambda that runs a game holds these. Other lambdas
// serve reads directly from Postgres. When the game ends, the
// entry is disposed and DB is the only remaining source.
//
// Uses globalThis so `next dev` HMR doesn't wipe mid-game state.
// In production, each function instance has its own globalThis.

import type { FlowController, Room, TokenAccountant } from '@agora/core'
import type { EventBus } from '@agora/core'

export interface RuntimeEntry {
  eventBus: EventBus
  room: Room
  flow: FlowController
  accountant: TokenAccountant
  /** Monotonic event sequence, incremented synchronously in the persister. */
  seq: number
  /** Serializes DB writes so events land in seq order. */
  pending: Promise<unknown>
}

const GLOBAL_KEY = '__agora_runtime__' as const

function registry(): Map<string, RuntimeEntry> {
  const g = globalThis as Record<string, unknown>
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map<string, RuntimeEntry>()
  return g[GLOBAL_KEY] as Map<string, RuntimeEntry>
}

export function registerRuntime(
  roomId: string,
  entry: Omit<RuntimeEntry, 'seq' | 'pending'>,
): RuntimeEntry {
  const full: RuntimeEntry = { ...entry, seq: 0, pending: Promise.resolve() }
  registry().set(roomId, full)
  return full
}

export function getRuntime(roomId: string): RuntimeEntry | undefined {
  return registry().get(roomId)
}

export function disposeRuntime(roomId: string): void {
  const entry = registry().get(roomId)
  if (entry) {
    try {
      entry.accountant.dispose()
    } catch {
      // best-effort — already-disposed accountant shouldn't throw, but ignore
    }
    registry().delete(roomId)
  }
}
