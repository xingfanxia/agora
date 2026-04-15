// ============================================================
// /teams/[id]/edit — team composer (pre-filled)
// ============================================================

'use client'

import { use, useEffect, useState } from 'react'
import { notFound } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { TeamComposer, type TeamComposerInitial } from '../../../components/TeamComposer'

interface TeamRow {
  id: string
  createdBy: string | null
  name: string
  description: string | null
  avatarSeed: string
  defaultModeId: string | null
  leaderAgentId: string | null
  isTemplate: boolean
}

interface MemberRow {
  agentId: string
  position: number
}

export default function EditTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const tCommon = useTranslations('common')
  const [initial, setInitial] = useState<TeamComposerInitial | null>(null)
  const [notFoundFlag, setNotFoundFlag] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await fetch(`/api/teams/${id}`)
      if (res.status === 404) {
        if (!cancelled) setNotFoundFlag(true)
        return
      }
      if (!res.ok) return
      const data = (await res.json()) as { team: TeamRow; members: MemberRow[] }
      if (data.team.isTemplate) {
        if (!cancelled) setNotFoundFlag(true)
        return
      }
      if (!cancelled) {
        setInitial({
          id: data.team.id,
          name: data.team.name,
          description: data.team.description ?? '',
          avatarSeed: data.team.avatarSeed,
          defaultModeId: ((data.team.defaultModeId as TeamComposerInitial['defaultModeId']) ?? 'open-chat'),
          leaderAgentId: data.team.leaderAgentId,
          memberIds: [...data.members]
            .sort((a, b) => a.position - b.position)
            .map((m) => m.agentId),
        })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (notFoundFlag) notFound()
  if (!initial) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
        {tCommon('loading')}
      </div>
    )
  }
  return <TeamComposer initial={initial} onCancelHref={`/teams/${id}`} />
}
