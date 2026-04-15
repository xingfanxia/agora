// ============================================================
// TeamCard — grid card for the /teams list
// ============================================================

'use client'

import Link from 'next/link'
import { AgentAvatarPixel } from './AgentAvatarPixel'

export interface TeamCardTeam {
  id: string
  name: string
  description: string | null
  avatarSeed: string
  defaultModeId: string | null
  leaderAgentId: string | null
  isTemplate: boolean
}

export interface TeamCardMember {
  agentId: string
  avatarSeed: string
  name: string
}

export interface TeamCardProps {
  team: TeamCardTeam
  members?: readonly TeamCardMember[]
  memberCount?: number
  onOpen?: () => void
}

const MODE_BADGE: Record<string, string> = {
  'open-chat': '对话',
  roundtable: '辩论',
  werewolf: '狼人杀',
}

export function TeamCard({ team, members = [], memberCount, onOpen }: TeamCardProps) {
  const rosterCount = memberCount ?? members.length
  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <AgentAvatarPixel seed={team.avatarSeed} size={52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--foreground)',
              marginBottom: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {team.name}
            {team.isTemplate && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 10,
                  fontWeight: 500,
                  color: 'var(--accent)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                }}
              >
                模板
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--muted)',
            }}
          >
            {rosterCount} 位成员
            {team.defaultModeId && (
              <>
                {' · '}
                {MODE_BADGE[team.defaultModeId] ?? team.defaultModeId}
              </>
            )}
          </div>
        </div>
      </div>
      {team.description && (
        <p
          style={{
            fontSize: 13,
            lineHeight: 1.55,
            color: 'var(--muted-strong, var(--muted))',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: 40,
            margin: 0,
            marginBottom: 12,
          }}
        >
          {team.description}
        </p>
      )}
      {members.length > 0 && (
        <div style={{ display: 'flex', gap: -6, alignItems: 'center' }}>
          <AvatarStack members={members} leaderAgentId={team.leaderAgentId} />
        </div>
      )}
    </>
  )

  const cardStyle: React.CSSProperties = {
    display: 'block',
    padding: 16,
    borderRadius: 'var(--radius)',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-sm)',
    textDecoration: 'none',
    color: 'inherit',
    transition: 'transform .15s ease, box-shadow .15s ease',
    cursor: 'pointer',
  }

  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} style={{ ...cardStyle, textAlign: 'left', width: '100%' }}>
        {body}
      </button>
    )
  }
  return (
    <Link href={`/teams/${team.id}`} style={cardStyle}>
      {body}
    </Link>
  )
}

function AvatarStack({
  members,
  leaderAgentId,
}: {
  members: readonly TeamCardMember[]
  leaderAgentId: string | null
}) {
  const visible = members.slice(0, 6)
  const more = members.length - visible.length
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {visible.map((m, i) => (
        <div
          key={m.agentId}
          style={{
            marginLeft: i === 0 ? 0 : -8,
            position: 'relative',
            zIndex: visible.length - i,
          }}
          title={m.name}
        >
          <AgentAvatarPixel seed={m.avatarSeed} size={28} style={{ border: '2px solid var(--surface)' }} />
          {m.agentId === leaderAgentId && (
            <div
              style={{
                position: 'absolute',
                top: -6,
                right: -4,
                fontSize: 10,
                pointerEvents: 'none',
              }}
              title="Leader"
            >
              ⚜
            </div>
          )}
        </div>
      ))}
      {more > 0 && (
        <div
          style={{
            marginLeft: -8,
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--surface-hover)',
            border: '2px solid var(--surface)',
            color: 'var(--muted)',
            fontSize: 11,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          +{more}
        </div>
      )}
    </div>
  )
}
