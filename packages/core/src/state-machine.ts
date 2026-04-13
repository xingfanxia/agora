// ============================================================
// Agora Platform — StateMachineFlow (generic state machine)
// ============================================================

import type { Message } from '@agora/shared'
import type { FlowController, FlowTick } from './flow.js'

// ── Types ──────────────────────────────────────────────────

/** Mutable game state passed to phase hooks and speaker selectors */
export interface GameState {
  /** Agent ID → role mapping */
  readonly roles: ReadonlyMap<string, string>
  /** Set of agent IDs still active (alive) */
  readonly activeAgentIds: ReadonlySet<string>
  /** Mode-specific state (e.g., werewolf kill target, seer result) */
  readonly custom: Record<string, unknown>
}

/** Mutable version for internal use — hooks can modify this */
interface MutableGameState {
  roles: Map<string, string>
  activeAgentIds: Set<string>
  custom: Record<string, unknown>
}

/** Accumulated decisions in the current phase */
export interface PhaseDecisions {
  /** agentId → decision object */
  readonly decisions: ReadonlyMap<string, unknown>
  /** All messages in this phase */
  readonly messages: readonly Message[]
}

/** Configuration for a single phase */
export interface PhaseConfig {
  readonly name: string
  readonly channelId: string
  /**
   * Determine who speaks in this phase.
   * Can return multiple speakers — they'll speak in order.
   */
  readonly getSpeakers: (gameState: GameState, agentIds: readonly string[]) => string[]
  /** Instruction template for speakers. Can be a function for per-agent instructions. */
  readonly instruction?: string | ((agentId: string, gameState: GameState) => string)
  /** Static Zod schema for structured output */
  readonly schema?: unknown
  /** Dynamic schema generator — takes precedence over static `schema` */
  readonly getSchema?: (agentId: string, gameState: GameState) => unknown
  /** Maximum turns before auto-transitioning (optional safety valve) */
  readonly maxTurns?: number
  /** Called when phase starts — can modify game state */
  readonly onEnter?: (gameState: MutableGameState) => void
  /** Called when phase ends — can process decisions and modify game state */
  readonly onExit?: (gameState: MutableGameState, decisions: PhaseDecisions) => void
}

/**
 * Transition rule between phases.
 * `condition` is evaluated after each message.
 */
export interface TransitionRule {
  readonly from: string
  readonly to: string
  /** Return true when the transition should fire */
  readonly condition: (ctx: TransitionContext) => boolean
}

export interface TransitionContext {
  readonly turnCount: number
  readonly decisionCount: number
  readonly expectedSpeakers: number
  readonly gameState: GameState
  readonly decisions: PhaseDecisions
}

/** Full state machine configuration */
export interface StateMachineConfig {
  readonly phases: readonly PhaseConfig[]
  readonly transitions: readonly TransitionRule[]
  readonly initialPhase: string
  readonly terminalPhases: readonly string[]
}

// ── Announcement message factory ───────────────────────────

/** System announcement injected between phases */
export interface Announcement {
  readonly content: string
  readonly channelId: string
  readonly metadata?: Record<string, unknown>
}

// ── Implementation ─────────────────────────────────────────

export class StateMachineFlow implements FlowController {
  private readonly config: StateMachineConfig
  private readonly phaseMap: Map<string, PhaseConfig>
  private agentIds: string[] = []
  private currentPhaseName: string
  private currentSpeakers: string[] = []
  private speakerIndex = 0
  private turnCount = 0
  private complete = false
  private initialized = false
  private round = 1

  // Decision tracking per phase
  private phaseDecisions = new Map<string, unknown>()
  private phaseMessages: Message[] = []

  // Game state — mutable, modified by hooks
  private gameState: MutableGameState = {
    roles: new Map(),
    activeAgentIds: new Set(),
    custom: {},
  }

  // Announcements queued by phase transitions
  private pendingAnnouncements: Announcement[] = []

  constructor(config: StateMachineConfig) {
    this.config = config
    this.currentPhaseName = config.initialPhase

    this.phaseMap = new Map()
    for (const phase of config.phases) {
      this.phaseMap.set(phase.name, phase)
    }
  }

  /** Set initial game state (called by mode before room.start) */
  setGameState(state: { roles: Map<string, string>; activeAgentIds: Set<string>; custom?: Record<string, unknown> }): void {
    this.gameState = {
      roles: state.roles,
      activeAgentIds: state.activeAgentIds,
      custom: state.custom ?? {},
    }
  }

  /** Get current game state (for mode to inspect) */
  getGameState(): GameState {
    return this.gameState
  }

  /** Get any pending announcements and clear the queue */
  drainAnnouncements(): Announcement[] {
    // Also collect any announcements from gameState.custom (set by onEnter/onExit hooks)
    const customAnnouncements = this.gameState.custom['_announcements'] as Announcement[] | undefined
    if (customAnnouncements && customAnnouncements.length > 0) {
      this.pendingAnnouncements.push(...customAnnouncements)
      this.gameState.custom['_announcements'] = []
    }

    const announcements = [...this.pendingAnnouncements]
    this.pendingAnnouncements = []
    return announcements
  }

  initialize(agentIds: string[]): void {
    if (agentIds.length === 0) {
      throw new Error('StateMachineFlow requires at least one agent')
    }
    this.agentIds = [...agentIds]
    this.initialized = true

    // Enter the initial phase
    this.enterPhase(this.currentPhaseName)
  }

  getCurrentPhase(): string {
    return this.currentPhaseName
  }

  tick(): FlowTick {
    if (!this.initialized) {
      throw new Error('FlowController not initialized — call initialize() first')
    }

    if (this.complete) {
      return {
        nextSpeakers: [],
        channelId: 'main',
        phase: this.currentPhaseName,
        round: this.round,
        isComplete: true,
      }
    }

    const phase = this.phaseMap.get(this.currentPhaseName)
    if (!phase) {
      throw new Error(`Unknown phase: ${this.currentPhaseName}`)
    }

    // If no speakers left in this phase, try to transition
    if (this.speakerIndex >= this.currentSpeakers.length) {
      const transitioned = this.tryTransition()
      if (!transitioned) {
        // No transition available and no speakers — phase is stuck, force complete
        this.complete = true
        return {
          nextSpeakers: [],
          channelId: 'main',
          phase: this.currentPhaseName,
          round: this.round,
          isComplete: true,
        }
      }
      // After transition, get the new phase
      return this.tick()
    }

    const speakerId = this.currentSpeakers[this.speakerIndex]!

    // Resolve instruction (static string or per-agent function)
    let instruction: string | undefined
    if (typeof phase.instruction === 'function') {
      instruction = phase.instruction(speakerId, this.gameState)
    } else {
      instruction = phase.instruction
    }

    // Resolve schema (dynamic getSchema takes precedence over static schema)
    const schema = phase.getSchema
      ? phase.getSchema(speakerId, this.gameState)
      : phase.schema

    return {
      nextSpeakers: [speakerId],
      channelId: phase.channelId,
      schema,
      instruction,
      phase: this.currentPhaseName,
      round: this.round,
      isComplete: false,
      metadata: {
        roleOfSpeaker: this.gameState.roles.get(speakerId),
      },
    }
  }

  onMessage(message: Message): void {
    this.speakerIndex++
    this.turnCount++
    this.phaseMessages.push(message)

    // Record structured decision if present
    const decision = message.metadata?.['decision']
    if (decision !== undefined) {
      this.phaseDecisions.set(message.senderId, decision)
    }

    // Check maxTurns safety valve
    const phase = this.phaseMap.get(this.currentPhaseName)
    if (phase?.maxTurns && this.turnCount >= phase.maxTurns) {
      this.tryTransition()
    }
  }

  isComplete(): boolean {
    return this.complete
  }

  // ── Private ────────────────────────────────────────────────

  private enterPhase(phaseName: string): void {
    const previousPhase = this.currentPhaseName !== phaseName ? this.currentPhaseName : null

    this.currentPhaseName = phaseName
    this.speakerIndex = 0
    this.turnCount = 0
    this.phaseDecisions = new Map()
    this.phaseMessages = []

    const phase = this.phaseMap.get(phaseName)
    if (!phase) {
      throw new Error(`Unknown phase: ${phaseName}`)
    }

    // Check if terminal
    if (this.config.terminalPhases.includes(phaseName)) {
      // Run onEnter for terminal phase (may generate final announcements)
      phase.onEnter?.(this.gameState)
      this.complete = true
      return
    }

    // Run onEnter hook
    phase.onEnter?.(this.gameState)

    // Compute speakers for this phase
    this.currentSpeakers = phase.getSpeakers(this.gameState, this.agentIds)
  }

  private tryTransition(): boolean {
    const currentPhase = this.phaseMap.get(this.currentPhaseName)!

    // Build transition context
    const ctx: TransitionContext = {
      turnCount: this.turnCount,
      decisionCount: this.phaseDecisions.size,
      expectedSpeakers: this.currentSpeakers.length,
      gameState: this.gameState,
      decisions: {
        decisions: this.phaseDecisions,
        messages: this.phaseMessages,
      },
    }

    // Find first matching transition
    for (const rule of this.config.transitions) {
      if (rule.from === this.currentPhaseName && rule.condition(ctx)) {
        // Exit current phase
        currentPhase.onExit?.(this.gameState, {
          decisions: this.phaseDecisions,
          messages: this.phaseMessages,
        })

        // Drain any announcements set during onExit
        // (announcements are added to gameState.custom.announcements by hooks)
        const announcements = this.gameState.custom['_announcements'] as Announcement[] | undefined
        if (announcements && announcements.length > 0) {
          this.pendingAnnouncements.push(...announcements)
          this.gameState.custom['_announcements'] = []
        }

        // Track round progression (each full night→day cycle = 1 round)
        if (rule.to === this.config.initialPhase) {
          this.round++
        }

        // Enter next phase
        this.enterPhase(rule.to)
        return true
      }
    }

    return false
  }
}
