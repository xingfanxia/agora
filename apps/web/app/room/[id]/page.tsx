'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useRoomPoll } from './hooks/useRoomPoll'
import { RoundtableView } from './modes/roundtable/RoundtableView'
import { WerewolfView } from './modes/werewolf/WerewolfView'
import { HumanPlayBar } from './components/v2/HumanPlayBar'
import { InvitePanel } from './components/InvitePanel'

/**
 * Thin dispatcher — polls the room, then renders the mode-specific
 * view based on the room's modeId. Each mode composes shared
 * components from components/ with its own layout + decorations.
 */
export default function RoomPage() {
  const params = useParams()
  const roomId = params.id as string
  const { messages, snapshot, errorMsg, loading } = useRoomPoll(roomId)

  // Read human seat token from localStorage (Phase 4.5c)
  const [humanAgentId, setHumanAgentId] = useState<string | null>(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`agora-seat-${roomId}`)
      if (raw) {
        const parsed = JSON.parse(raw) as { agentId?: string }
        if (parsed.agentId) setHumanAgentId(parsed.agentId)
      }
    } catch { /* localStorage unavailable or corrupt */ }
  }, [roomId])

  if (loading) {
    return <LoadingScreen />
  }

  if (errorMsg && messages.length === 0) {
    return <ErrorScreen error={errorMsg} />
  }

  if (!snapshot) {
    return <LoadingScreen />
  }

  // The human play bar — renders at the bottom when the viewer has a seat
  const humanBar = humanAgentId ? (
    <HumanPlayBar
      roomId={roomId}
      humanAgentId={humanAgentId}
      snapshot={snapshot}
      messageCount={messages.length}
    />
  ) : null

  // Owner-only invite panel — shown when the room has 2+ human seats.
  const invitePanel = <InvitePanel roomId={roomId} agents={snapshot.agents ?? []} />

  // Route to the mode-specific view.
  if (snapshot.modeId === 'werewolf') {
    return (
      <>
        <WerewolfView messages={messages} snapshot={snapshot} />
        {humanBar}
        {invitePanel}
      </>
    )
  }

  return (
    <>
      <RoundtableView messages={messages} snapshot={snapshot} />
      {humanBar}
      {invitePanel}
    </>
  )
}

function LoadingScreen() {
  const t = useTranslations('room')
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        color: 'var(--muted)',
        fontSize: '1rem',
      }}
    >
      {t('loading')}
    </div>
  )
}

function ErrorScreen({ error }: { error: string }) {
  const t = useTranslations('room')
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: '1rem',
      }}
    >
      <p style={{ color: 'var(--danger)', fontSize: '1rem' }}>{error}</p>
      <Link
        href="/create"
        style={{
          padding: '0.625rem 1.25rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.875rem',
        }}
      >
        {t('backToCreate')}
      </Link>
    </div>
  )
}
