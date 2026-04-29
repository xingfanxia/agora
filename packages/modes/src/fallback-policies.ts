// ============================================================
// Mode fallback policies (Phase 4.5d-1)
// ============================================================
//
// When a human seat misses its turn (disconnected past the grace
// window, or simply doesn't respond before the timer fires), the
// runtime needs a deterministic default action so the game keeps
// advancing. This file is the registry.
//
// Consumed by:
//   - 4.5d-2 WDK steps — read getFallback(modeId, turnId) when
//     a parallel-vote hook times out, apply the returned action
//     in place of the missing input
//   - Legacy (http_chain) advanceRoom — same shape, applied when
//     room.waitingUntil deadline expires
//
// Design intent — keep this file PURE (no DB, no I/O). Fallbacks
// are contractual constants that game-balance reasoning depends
// on; no need to consult game state here. If a future fallback
// genuinely needs context, evolve `FallbackAction` to be a
// function `(ctx) => Action` then. YAGNI for now.
//
// Source of truth for the policy table:
//   docs/design/phase-4.5d-plan.md §4.5d-1 ("Mode fallback policies")

/**
 * Discriminated union of every fallback action the runtime knows
 * how to apply. Adding a new kind requires updating both the WDK
 * fan-in step and the legacy fallback-policy expiry path.
 */
export type FallbackAction =
  /** Vote not counted; majority computed among non-abstainers. */
  | { kind: 'abstain' }
  /** Action skipped entirely — no save/poison/check/protect/shoot. */
  | { kind: 'skip' }
  /** Sheriff election: candidate withdraws automatically. */
  | { kind: 'withdraw' }
  /** Sheriff transfer: badge dropped with no successor. */
  | { kind: 'drop-badge' }
  /** Speaking turn (free-form): silently advance to next seat. */
  | { kind: 'pass-turn' }

type ModeRegistry = Record<string, FallbackAction>

const werewolfFallbacks: ModeRegistry = {
  // Day phase
  'speak': { kind: 'skip' },
  'day-vote': { kind: 'abstain' },
  'last-words': { kind: 'skip' },
  'sheriff-election': { kind: 'withdraw' },
  'sheriff-transfer': { kind: 'drop-badge' },
  // Night phase
  'wolf-speak': { kind: 'skip' },
  'wolf-vote': { kind: 'abstain' },
  'witch-action': { kind: 'skip' },
  'seer-check': { kind: 'skip' },
  'guard-protect': { kind: 'skip' },
  // Triggered phases
  'hunter-shoot': { kind: 'skip' },
}

const openChatFallbacks: ModeRegistry = {
  'speak': { kind: 'pass-turn' },
}

const roundtableFallbacks: ModeRegistry = {
  'speak': { kind: 'pass-turn' },
}

const REGISTRY: Record<string, ModeRegistry> = {
  werewolf: werewolfFallbacks,
  'open-chat': openChatFallbacks,
  roundtable: roundtableFallbacks,
}

/**
 * Look up the fallback action for a (mode, turn) pair. Returns
 * null when the mode or turn is unregistered — caller should treat
 * "no policy" as "block and surface error", NOT "default to skip".
 * Silent defaults would mask configuration drift.
 */
export function getFallback(modeId: string, turnId: string): FallbackAction | null {
  const modeRegistry = REGISTRY[modeId]
  if (!modeRegistry) return null
  return modeRegistry[turnId] ?? null
}

/**
 * Enumerate all (mode, turn) pairs with registered fallbacks.
 * Useful for runtime sanity checks and test coverage.
 */
export function listFallbacks(): Array<{ modeId: string; turnId: string; action: FallbackAction }> {
  const out: Array<{ modeId: string; turnId: string; action: FallbackAction }> = []
  for (const [modeId, registry] of Object.entries(REGISTRY)) {
    for (const [turnId, action] of Object.entries(registry)) {
      out.push({ modeId, turnId, action })
    }
  }
  return out
}

/**
 * Exhaustiveness assertion for `FallbackAction` consumers. Use in
 * the `default:` arm of a `switch (action.kind)` to get a compile-
 * time error when a new action kind is added without updating
 * the consumer:
 *
 *   switch (action.kind) {
 *     case 'abstain': ...
 *     case 'skip': ...
 *     case 'withdraw': ...
 *     case 'drop-badge': ...
 *     case 'pass-turn': ...
 *     default: assertNeverFallback(action)
 *   }
 *
 * Defends the comment-enforced "every consumer must handle every
 * kind" invariant with an actual type-level guarantee.
 */
export function assertNeverFallback(x: never): never {
  throw new Error(`Unhandled FallbackAction: ${JSON.stringify(x)}`)
}
