// ============================================================
// In-memory room store for MVP
// ============================================================

import type { Message, PlatformEvent } from '@agora/shared'

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
  readonly agents: readonly AgentInfo[]
  readonly messages: Message[]
  readonly events: PlatformEvent[]
  status: RoomStatus
  currentRound: number
  thinkingAgentId: string | null
  error?: string
}

// Global in-memory store — persists across requests in the same process
const rooms = new Map<string, RoomState>()

export function getRoomState(id: string): RoomState | undefined {
  return rooms.get(id)
}

export function setRoomState(id: string, state: RoomState): void {
  rooms.set(id, state)
}

export function addMessage(roomId: string, message: Message): void {
  const room = rooms.get(roomId)
  if (room) {
    room.messages.push(message)
  }
}

export function addEvent(roomId: string, event: PlatformEvent): void {
  const room = rooms.get(roomId)
  if (room) {
    room.events.push(event)
  }
}

export function updateRoomStatus(roomId: string, status: RoomStatus): void {
  const room = rooms.get(roomId)
  if (room) {
    room.status = status
  }
}

export function setThinkingAgent(roomId: string, agentId: string | null): void {
  const room = rooms.get(roomId)
  if (room) {
    room.thinkingAgentId = agentId
  }
}

export function setCurrentRound(roomId: string, round: number): void {
  const room = rooms.get(roomId)
  if (room) {
    room.currentRound = round
  }
}
