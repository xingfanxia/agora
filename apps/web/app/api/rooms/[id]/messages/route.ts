// ============================================================
// GET /api/rooms/:id/messages — Poll for room messages + state
// ============================================================

import { NextResponse } from 'next/server'
import { getRoomState } from '../../../../lib/room-store'
import type { AgentTokenTotals, ModelTokenTotals } from '@agora/core'

/** Map -> array so JSON is stable and cheap to consume. */
function serializeTotals<T extends AgentTokenTotals | ModelTokenTotals>(
  values: IterableIterator<T>,
): T[] {
  return [...values]
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const room = getRoomState(id)

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const afterParam = url.searchParams.get('after')
  const after = afterParam ? parseInt(afterParam, 10) : 0

  const messages =
    after > 0 ? room.messages.filter((m) => m.timestamp > after) : room.messages

  const tokenSummary = room.accountant
    ? (() => {
        const s = room.accountant.getSummary(id)
        return {
          totalCost: s.totalCost,
          totalTokens: s.totalTokens,
          callCount: s.callCount,
          byAgent: serializeTotals(s.byAgent.values()),
          byModel: serializeTotals(s.byModel.values()),
        }
      })()
    : null

  return NextResponse.json({
    messages,
    status: room.status,
    currentRound: room.currentRound,
    totalRounds: room.rounds,
    currentPhase: room.currentPhase,
    modeId: room.modeId,
    thinkingAgentId: room.thinkingAgentId,
    agents: room.agents,
    topic: room.topic,
    tokenSummary,
    roleAssignments: room.roleAssignments ?? null,
    advancedRules: room.advancedRules ?? null,
    gameState: room.gameState ?? null,
    error: room.error,
  })
}
