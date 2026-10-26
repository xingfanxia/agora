// ============================================================
// Werewolf viewer projection — what a non-spectator may see
// ============================================================
//
// rooms.gameState holds the full werewolf state (roleMap, seer
// result, witch/guard targets …). The messages endpoint returns it
// to the client, so for an in-progress game every key is opt-in:
// public keys go to everyone, role keys only to that role, and
// anything else (roleMap, unknown/legacy keys) is dropped.
// Spectators (room owner without a seat) and finished games get
// the unfiltered state; that decision stays in the route.

const PUBLIC_KEYS = [
  'currentPhase',
  'nightNumber',
  'eliminatedIds',
  'winResult',
  'agentNames',
  'activeAgentIds',
  'idiotRevealedIds',
  'sheriffId',
  'sheriffElected',
  'pendingLastWordsIds',
  'advancedRules',
] as const

const ROLE_KEYS: Record<string, readonly string[]> = {
  werewolf: ['lastNightKill'],
  witch: [
    'lastNightKill',
    'witchSaveUsed',
    'witchPoisonUsed',
    'witchPoisonTarget',
    'witchUsedPotionTonight',
  ],
  seer: ['seerResult'],
  guard: ['guardProtectedId', 'guardLastProtectedId'],
  hunter: ['hunterCanShoot', 'hunterPendingId', 'hunterShotTarget'],
}

/**
 * Project the werewolf gameState for a player or observer.
 * `role` is the viewer's verified role (null = observer), `seatId`
 * the verified seat (null = observer).
 */
export function projectWerewolfGameState(
  gameState: Record<string, unknown> | null,
  role: string | null,
  seatId: string | null,
): Record<string, unknown> | null {
  if (!gameState) return gameState
  const out: Record<string, unknown> = {}
  const copy = (key: string) => {
    if (Object.prototype.hasOwnProperty.call(gameState, key)) out[key] = gameState[key]
  }
  for (const key of PUBLIC_KEYS) copy(key)
  if (role && ROLE_KEYS[role]) for (const key of ROLE_KEYS[role]) copy(key)
  // Legacy http_chain human turn marker: only the seat whose turn it is
  // needs it (a night-action turn would otherwise reveal that seat's role).
  if (seatId && gameState['waitingForHuman'] === seatId) {
    copy('waitingForHuman')
    copy('waitingForTurnIdx')
  }
  return out
}

/** Bearer token from an Authorization header, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}
