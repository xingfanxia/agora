// ============================================================
// Agora Platform — FlowController interface + RoundRobinFlow
// ============================================================

// ── Interfaces ──────────────────────────────────────────────

/** Result of each flow tick — who speaks next and metadata */
export interface FlowTick {
  readonly nextSpeakers: readonly string[]
  readonly instruction?: string
  readonly phase: string
  readonly round: number
  readonly isComplete: boolean
}

/** Controls turn order and round progression */
export interface FlowController {
  initialize(agentIds: string[]): void
  tick(): FlowTick
  isComplete(): boolean
}

// ── Configuration ───────────────────────────────────────────

export interface RoundRobinConfig {
  readonly rounds: number
}

// ── Implementation ──────────────────────────────────────────

/**
 * Simple round-robin flow: each agent speaks once per round,
 * cycling through N rounds total.
 */
export class RoundRobinFlow implements FlowController {
  private readonly totalRounds: number
  private agentIds: string[] = []
  private currentIndex = 0
  private currentRound = 1
  private complete = false
  private initialized = false

  constructor(config: RoundRobinConfig) {
    this.totalRounds = config.rounds
  }

  initialize(agentIds: string[]): void {
    if (agentIds.length === 0) {
      throw new Error('RoundRobinFlow requires at least one agent')
    }
    this.agentIds = [...agentIds]
    this.currentIndex = 0
    this.currentRound = 1
    this.complete = false
    this.initialized = true
  }

  tick(): FlowTick {
    if (!this.initialized) {
      throw new Error('FlowController not initialized — call initialize() first')
    }

    if (this.complete) {
      return {
        nextSpeakers: [],
        phase: 'ended',
        round: this.currentRound,
        isComplete: true,
      }
    }

    const speakerId = this.agentIds[this.currentIndex]!
    const tick: FlowTick = {
      nextSpeakers: [speakerId],
      phase: 'discussion',
      round: this.currentRound,
      isComplete: false,
    }

    // Advance pointer
    this.currentIndex++

    // Wrapped around — new round
    if (this.currentIndex >= this.agentIds.length) {
      this.currentIndex = 0
      this.currentRound++

      if (this.currentRound > this.totalRounds) {
        this.complete = true
      }
    }

    return tick
  }

  isComplete(): boolean {
    return this.complete
  }
}
