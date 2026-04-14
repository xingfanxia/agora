// ============================================================
// In-memory room store for MVP
// Uses globalThis to persist across Next.js dev hot reloads
// ============================================================

import type { Message, PlatformEvent } from '@agora/shared'
import type { TokenAccountant } from '@agora/core'

export type RoomStatus = 'running' | 'completed' | 'error'

export interface AgentInfo {
  readonly id: string
  readonly name: string
  readonly model: string
  readonly provider: string
}

export interface RoomState {
  readonly id: string
  readonly topic: string
  readonly rounds: number
  readonly modeId: string
  readonly agents: readonly AgentInfo[]
  readonly messages: Message[]
  readonly events: PlatformEvent[]
  status: RoomStatus
  currentRound: number
  thinkingAgentId: string | null
  currentPhase: string | null
  accountant?: TokenAccountant
  /** Werewolf-only: agentId → role name */
  roleAssignments?: Record<string, string>
  /** Werewolf-only: which advanced rules are on */
  advancedRules?: Record<string, boolean>
  /** Werewolf-only: per-phase metadata announced by state machine (eliminated ids, winResult, etc.) */
  gameState?: Record<string, unknown>
  error?: string
}

// Persist across Next.js dev hot reloads via globalThis
const globalKey = '__agora_rooms__' as const

function getRooms(): Map<string, RoomState> {
  const g = globalThis as Record<string, unknown>
  if (!g[globalKey]) {
    g[globalKey] = new Map<string, RoomState>()
  }
  return g[globalKey] as Map<string, RoomState>
}

export function getRoomState(id: string): RoomState | undefined {
  return getRooms().get(id)
}

export function setRoomState(id: string, state: RoomState): void {
  getRooms().set(id, state)
}

export function addMessage(roomId: string, message: Message): void {
  const room = getRooms().get(roomId)
  if (room) {
    room.messages.push(message)
  }
}

export function addEvent(roomId: string, event: PlatformEvent): void {
  const room = getRooms().get(roomId)
  if (room) {
    room.events.push(event)
  }
}

export function updateRoomStatus(roomId: string, status: RoomStatus): void {
  const room = getRooms().get(roomId)
  if (room) {
    room.status = status
  }
}

export function setThinkingAgent(roomId: string, agentId: string | null): void {
  const room = getRooms().get(roomId)
  if (room) {
    room.thinkingAgentId = agentId
  }
}

export function setCurrentRound(roomId: string, round: number): void {
  const room = getRooms().get(roomId)
  if (room) {
    room.currentRound = round
  }
}

export function setCurrentPhase(roomId: string, phase: string | null): void {
  const room = getRooms().get(roomId)
  if (room) {
    room.currentPhase = phase
  }
}

export function setAccountant(roomId: string, accountant: TokenAccountant): void {
  const room = getRooms().get(roomId)
  if (room) {
    room.accountant = accountant
  }
}

export function setGameState(roomId: string, gameState: Record<string, unknown>): void {
  const room = getRooms().get(roomId)
  if (room) {
    room.gameState = gameState
  }
}
