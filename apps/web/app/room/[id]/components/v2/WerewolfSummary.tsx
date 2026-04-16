// ============================================================
// WerewolfSummary — post-game role reveal + survivor list
// ============================================================
//
// Rendered below the win banner in WerewolfView when status=completed.
// Shows each player with their role revealed, color-coded by faction,
// in sequence with who was killed when.

'use client'

import { useMemo } from 'react'
import type { AgentColor } from '../theme'
import { AgentAvatar } from './AgentAvatar'

export interface WerewolfSummaryAgent {
  id: string
  name: string
  model: string
  provider?: string
}

export interface WerewolfSummaryProps {
  agents: readonly WerewolfSummaryAgent[]
  roleMap: Record<string, string>
  eliminatedIds: readonly string[]
  winResult: 'village_wins' | 'werewolves_win' | null
  colorFor: (agentId: string) => AgentColor
}

const ROLE_EMOJI: Record<string, string> = {
  werewolf: '🐺',
  villager: '👤',
  seer: '🔮',
  witch: '🧪',
  hunter: '🎯',
  guard: '🛡️',
  idiot: '🤡',
}

const ROLE_LABEL_ZH: Record<string, string> = {
  werewolf: '狼人',
  villager: '平民',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  guard: '守卫',
  idiot: '白痴',
}

const WOLF_ROLES = new Set(['werewolf'])

export function WerewolfSummary({
  agents,
  roleMap,
  eliminatedIds,
  winResult,
  colorFor,
}: WerewolfSummaryProps) {
  const eliminatedSet = useMemo(() => new Set(eliminatedIds), [eliminatedIds])

  // Split agents by alive / dead; within each, wolves first (for quick scan).
  const ordered = useMemo(() => {
    const alive = agents.filter((a) => !eliminatedSet.has(a.id))
    const dead = agents.filter((a) => eliminatedSet.has(a.id))
    const byRoleDesc = (a: WerewolfSummaryAgent, b: WerewolfSummaryAgent): number => {
      const aw = WOLF_ROLES.has(roleMap[a.id] ?? '') ? 0 : 1
      const bw = WOLF_ROLES.has(roleMap[b.id] ?? '') ? 0 : 1
      return aw - bw
    }
    return { alive: [...alive].sort(byRoleDesc), dead: [...dead].sort(byRoleDesc) }
  }, [agents, eliminatedSet, roleMap])

  return (
    <section
      style={{
        maxWidth: 1280,
        margin: '1rem auto 0',
        width: '100%',
        padding: 20,
        borderRadius: 'var(--radius)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 590,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--muted)',
          marginBottom: 14,
        }}
      >
        角色揭晓 · Role reveal
      </div>

      {ordered.alive.length > 0 && (
        <Group title={`存活 · Survivors (${ordered.alive.length})`}>
          {ordered.alive.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              role={roleMap[a.id]}
              eliminated={false}
              color={colorFor(a.id)}
              winResult={winResult}
            />
          ))}
        </Group>
      )}

      {ordered.dead.length > 0 && (
        <Group title={`出局 · Eliminated (${ordered.dead.length})`}>
          {ordered.dead.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              role={roleMap[a.id]}
              eliminated={true}
              color={colorFor(a.id)}
              winResult={winResult}
            />
          ))}
        </Group>
      )}
    </section>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--muted)',
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}

function AgentRow({
  agent,
  role,
  eliminated,
  color,
  winResult,
}: {
  agent: WerewolfSummaryAgent
  role: string | undefined
  eliminated: boolean
  color: AgentColor
  winResult: 'village_wins' | 'werewolves_win' | null
}) {
  const isWolf = WOLF_ROLES.has(role ?? '')
  const onWinningSide =
    winResult === 'village_wins' ? !isWolf : winResult === 'werewolves_win' ? isWolf : false
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 'var(--radius-sm)',
        background: onWinningSide
          ? 'var(--accent-tint)'
          : eliminated
            ? 'var(--surface-hover)'
            : 'transparent',
        border: `1px solid ${onWinningSide ? 'var(--accent-ring)' : 'var(--border)'}`,
        opacity: eliminated ? 0.7 : 1,
      }}
    >
      <AgentAvatar name={agent.name} color={color} size={28} provider={agent.provider} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 510,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textDecoration: eliminated ? 'line-through' : 'none',
          }}
        >
          {agent.name}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          {role ? `${ROLE_EMOJI[role] ?? ''} ${ROLE_LABEL_ZH[role] ?? role}` : '—'}
        </div>
      </div>
    </div>
  )
}
