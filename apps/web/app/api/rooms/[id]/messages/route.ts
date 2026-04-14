// ============================================================
// GET /api/rooms/:id/messages — Poll for room messages + state
// ============================================================

import { NextResponse } from 'next/server'
import { getMessagesSince, getRoomSnapshot } from '../../../../lib/room-store'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const snapshot = await getRoomSnapshot(id)
  if (!snapshot) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  const url = new URL(request.url)
  const afterParam = url.searchParams.get('after')
  const after = afterParam ? parseInt(afterParam, 10) : 0

  const messages = await getMessagesSince(id, after)

  return NextResponse.json({
    messages,
    status: snapshot.status,
    currentRound: snapshot.currentRound,
    totalRounds:
      (snapshot.config as { rounds?: number } | null)?.rounds ?? snapshot.currentRound,
    currentPhase: snapshot.currentPhase,
    modeId: snapshot.modeId,
    thinkingAgentId: snapshot.thinkingAgentId,
    agents: snapshot.agents,
    topic: snapshot.topic ?? '',
    tokenSummary: snapshot.tokenSummary,
    roleAssignments: snapshot.roleAssignments,
    advancedRules: snapshot.advancedRules,
    gameState: snapshot.gameState,
    error: snapshot.error,
  })
}
