// ============================================================
// Agora Platform — Typed EventBus
// ============================================================

import type { PlatformEvent } from '@agora/shared'

/** Extract the event object for a specific event type */
type EventOfType<T extends PlatformEvent['type']> = Extract<PlatformEvent, { type: T }>

/** Event handler function */
type EventHandler<T extends PlatformEvent['type']> = (event: EventOfType<T>) => void

// Internal untyped handler for storage — type safety enforced at on/off/emit boundaries
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (event: any) => void

/**
 * Typed event emitter for PlatformEvent union.
 * Listeners subscribe to specific event types and receive
 * only matching events with full type narrowing.
 */
export class EventBus {
  private readonly listeners = new Map<string, Set<AnyHandler>>()

  /** Subscribe to a specific event type */
  on<T extends PlatformEvent['type']>(type: T, handler: EventHandler<T>): void {
    const existing = this.listeners.get(type)
    if (existing) {
      existing.add(handler as AnyHandler)
    } else {
      this.listeners.set(type, new Set([handler as AnyHandler]))
    }
  }

  /** Unsubscribe a handler from an event type */
  off<T extends PlatformEvent['type']>(type: T, handler: EventHandler<T>): void {
    const existing = this.listeners.get(type)
    if (existing) {
      existing.delete(handler as AnyHandler)
      if (existing.size === 0) {
        this.listeners.delete(type)
      }
    }
  }

  /** Emit an event to all registered listeners of its type */
  emit(event: PlatformEvent): void {
    const handlers = this.listeners.get(event.type)
    if (handlers) {
      for (const handler of handlers) {
        handler(event)
      }
    }
  }

  /** Remove all listeners (useful for cleanup / testing) */
  clear(): void {
    this.listeners.clear()
  }
}
