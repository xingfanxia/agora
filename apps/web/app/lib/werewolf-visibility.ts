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
  // Lobby ready-state (multi-human lobby); shown to every seat.
  'seatReady',
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

// Night phases where the acting seat reveals a role, keyed to the
// role that acts. Outside that role, the thinking seat is replaced
// by NIGHT_THINKING_PLACEHOLDER for the whole phase (also when no
// one is acting, so an empty witch/seer turn doesn't reveal a death).
const NIGHT_ACTING_ROLE: Record<string, string> = {
  guardProtect: 'guard',
  wolfDiscuss: 'werewolf',
  wolfVote: 'werewolf',
  witchAction: 'witch',
  seerCheck: 'seer',
}

/** thinkingAgentId sent to viewers outside the acting night role. */
export const NIGHT_THINKING_PLACEHOLDER = 'night'

/**
 * Project the room's thinkingAgentId for a player or observer.
 * `role` is the viewer's verified role (null = observer).
 */
export function projectWerewolfThinkingAgentId(
  thinkingAgentId: string | null,
  phase: string | null,
  role: string | null,
): string | null {
  const actingRole = phase ? NIGHT_ACTING_ROLE[phase] : undefined
  if (!actingRole || role === actingRole) return thinkingAgentId
  return NIGHT_THINKING_PLACEHOLDER
}

// Seat fields safe to show everyone. Werewolf seats can carry a
// role-bearing systemPrompt/persona ("YOUR ROLE: SEER …", fellow
// wolves), so in-progress games send only these.
const PUBLIC_AGENT_KEYS = ['id', 'name', 'model', 'provider', 'isHuman', 'avatarSeed'] as const

/** Project the room's agent seats for a player or observer. */
export function projectWerewolfAgents(agents: unknown): unknown {
  if (!Array.isArray(agents)) return agents
  return agents.map((agent) => {
    if (!agent || typeof agent !== 'object') return agent
    const src = agent as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of PUBLIC_AGENT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = src[key]
    }
    return out
  })
}

/** Bearer token from an Authorization header, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}
