// ============================================================
// P2 — Lobby gate: shared resolveLobby + dispatchWorkflowStart
// ============================================================
//
// Rooms with human seats start at status='lobby' (set by each POST
// route via createRoom({ initialStatus: 'lobby' })). The workflow
// has NOT been started yet. Each human seat flips ready via
// POST /api/rooms/[id]/seats/[agentId]/ready, which calls
// markSeatReady() + this resolveLobby(). When all human seats are
// ready, resolveLobby flips status='lobby' → 'running' atomically
// (CAS via flipLobbyToRunning) and dispatches the mode-specific
// workflow start.
//
// Owner force-start (POST /api/rooms/[id]/start) bypasses the
// "all ready" check and calls resolveLobby directly with `force=true`.
//
// dispatchWorkflowStart reconstructs the workflow input from the
// persisted row (agents, roleAssignments, modeConfig). The POST
// routes pre-bake everything needed into those fields at create
// time, so dispatch is purely a read-and-route.

import { start } from 'workflow/api'
import type { RoomRow } from '@agora/db'
import type { LLMProvider, ModelConfig } from '@agora/shared'
import type { WerewolfAdvancedRules, WerewolfRole } from '@agora/modes'
import {
  flipLobbyToRunning,
  getRoom,
  updateRoomStatus,
  type AgentInfo,
} from './room-store.js'
import {
  roundtableWorkflow,
  toRoundtableAgentSnapshot,
} from '../workflows/roundtable-workflow.js'
import {
  openChatWorkflow,
  toOpenChatAgentSnapshot,
} from '../workflows/open-chat-workflow.js'
import { werewolfWorkflow } from '../workflows/werewolf-workflow.js'

// ── Public ──────────────────────────────────────────────────

export interface ResolveLobbyResult {
  /** Was the room actually flipped to 'running' by THIS call? */
  flipped: boolean
  /**
   * If `flipped`, the workflow `start()` was attempted. `started=true`
   * means it returned without throwing. `false` means start() threw
   * and the room was rolled to 'error' — caller should surface a
   * 500.
   */
  started?: boolean
  /**
   * `'not-ready'`: not all human seats have flipped ready yet (and
   * `force=false`). `'not-lobby'`: room is no longer in lobby (someone
   * else won). `'no-room'`: roomId not found.
   */
  reason?: 'not-ready' | 'not-lobby' | 'no-room'
}

/**
 * Try to resolve the lobby gate and start the workflow.
 *
 * - `force=false` (default): only flips if every human seat in
 *   `room.agents` is marked ready in `gameState.seatReady`.
 * - `force=true`: skip the all-ready check (owner override).
 *
 * Caller MUST have just written via `markSeatReady` (for the natural
 * trigger) or established owner authorization (for force-start). This
 * function does NOT re-authenticate.
 */
export async function resolveLobby(
  roomId: string,
  opts: { force?: boolean } = {},
): Promise<ResolveLobbyResult> {
  const room = await getRoom(roomId)
  if (!room) return { flipped: false, reason: 'no-room' }
  if (room.status !== 'lobby') return { flipped: false, reason: 'not-lobby' }

  if (!opts.force) {
    const ready = readSeatReady(room.gameState as Record<string, unknown> | null)
    const humans = (room.agents as unknown as AgentInfo[]).filter((a) => a.isHuman === true)
    const allReady = humans.length > 0 && humans.every((a) => ready[a.id] === true)
    if (!allReady) return { flipped: false, reason: 'not-ready' }
  }

  const won = await flipLobbyToRunning(roomId)
  if (!won) return { flipped: false, reason: 'not-lobby' }

  // We won the flip. Workflow start is now our responsibility — if it
  // throws, we mark the room 'error' so it doesn't sit at 'running'
  // forever (markOrphanedAsError skips WDK rooms intentionally).
  try {
    await dispatchWorkflowStart(room)
    return { flipped: true, started: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[lobby] ${roomId} workflow start failed:`, err)
    await updateRoomStatus(roomId, 'error', `Lobby resolve workflow start failed: ${msg}`)
    return { flipped: true, started: false }
  }
}

/**
 * Read the seatReady map from gameState. Defensive: gameState can be
 * null/undefined on a freshly-created lobby room before any seat
 * flipped, and the seatReady key may be missing.
 */
export function readSeatReady(
  gameState: Record<string, unknown> | null,
): Record<string, boolean> {
  if (!gameState) return {}
  const raw = gameState['seatReady']
  if (raw === null || typeof raw !== 'object') return {}
  const out: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === true) out[k] = true
  }
  return out
}

// ── Workflow dispatch ───────────────────────────────────────

/**
 * Reconstruct the workflow input from the persisted row and call
 * start(workflow, ...). Each mode pulls what it needs:
 *
 * - roundtable + open-chat: AgentInfo carries systemPrompt + persona
 *   already (buildTeamSnapshot bakes them at room-create time). Just
 *   map through `toRoundtableAgentSnapshot` / `toOpenChatAgentSnapshot`.
 * - werewolf: AgentInfo persists systemPrompt (added by werewolf POST
 *   at create time so this dispatch doesn't re-run buildRoleSystemPrompt).
 *   Role comes from row.roleAssignments. ModelConfig is reconstructed
 *   from AgentInfo's flat fields.
 *
 * Throwing here is the caller's signal to mark the room 'error'.
 */
async function dispatchWorkflowStart(room: RoomRow): Promise<void> {
  const agents = (room.agents as unknown as AgentInfo[]) ?? []
  const modeConfig = (room.modeConfig as Record<string, unknown> | null) ?? {}

  switch (room.modeId) {
    case 'roundtable': {
      const topic = (modeConfig['topic'] as string | undefined) ?? room.topic ?? ''
      const rounds = Number(modeConfig['rounds'] ?? 3)
      const snapshots = agents.map((info) => {
        if (!info.systemPrompt) {
          throw new Error(`agent ${info.id} missing systemPrompt for lobby-resolve roundtable`)
        }
        return toRoundtableAgentSnapshot(info, info.systemPrompt)
      })
      await start(roundtableWorkflow, [{ roomId: room.id, agents: snapshots, topic, rounds }])
      return
    }
    case 'open-chat': {
      const topic = (modeConfig['topic'] as string | undefined) ?? room.topic ?? ''
      const rounds = Number(modeConfig['rounds'] ?? 3)
      const snapshots = agents.map((info) => {
        if (!info.systemPrompt) {
          throw new Error(`agent ${info.id} missing systemPrompt for lobby-resolve open-chat`)
        }
        return toOpenChatAgentSnapshot(info, info.systemPrompt)
      })
      await start(openChatWorkflow, [{ roomId: room.id, agents: snapshots, topic, rounds }])
      return
    }
    case 'werewolf': {
      const roleAssignments =
        (room.roleAssignments as Record<string, WerewolfRole> | null) ?? {}
      const advancedRules =
        (modeConfig['advancedRules'] as WerewolfAdvancedRules | undefined) ?? {}
      const language = (modeConfig['language'] as 'en' | 'zh' | undefined) ?? 'zh'
      const snapshots = agents.map((info) => {
        const role = roleAssignments[info.id]
        if (!role) {
          throw new Error(`agent ${info.id} missing role for lobby-resolve werewolf`)
        }
        if (!info.systemPrompt) {
          throw new Error(`agent ${info.id} missing systemPrompt for lobby-resolve werewolf`)
        }
        const model: ModelConfig = {
          provider: info.provider as LLMProvider,
          modelId: info.model,
          maxTokens: 1500,
        }
        return {
          id: info.id,
          name: info.name,
          persona: 'A player in the werewolf game',
          systemPrompt: info.systemPrompt,
          role,
          model,
          isHuman: info.isHuman === true,
        }
      })
      await start(werewolfWorkflow, [
        {
          roomId: room.id,
          agents: snapshots,
          advancedRules,
          seed: room.id,
          language,
        },
      ])
      return
    }
    default:
      throw new Error(`Unknown modeId for lobby resolve: ${room.modeId}`)
  }
}
