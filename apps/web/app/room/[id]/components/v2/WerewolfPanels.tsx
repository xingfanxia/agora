// ============================================================
// WerewolfPanels — Role-specific input panels for werewolf
// ============================================================
//
// Phase 4.5c — One component per werewolf turn type. Each panel:
//  - Reads current game state from snapshot.gameState
//  - Renders a role-appropriate input UI
//  - Posts to /api/rooms/[id]/human-input with the right turnId + payload

'use client'

import { useState } from 'react'
import type { AgentData, PollResponse } from '../theme'

export interface WerewolfPanelCommonProps {
  roomId: string
  humanAgentId: string
  snapshot: Omit<PollResponse, 'messages'>
  onSubmitted: () => void
}

// ── Shared helpers ─────────────────────────────────────────

async function submitHumanInput(
  roomId: string,
  humanAgentId: string,
  turnId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/rooms/${roomId}/human-input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: humanAgentId, turnId, payload }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed' }))
      console.error('[WerewolfPanels] submit failed:', (err as { error?: string }).error)
      return false
    }
    return true
  } catch (e) {
    console.error('[WerewolfPanels] submit error:', e)
    return false
  }
}

function getAliveAgents(
  snapshot: Omit<PollResponse, 'messages'>,
  excludeSelf?: string,
): AgentData[] {
  const gs = (snapshot.gameState ?? {}) as { eliminatedIds?: string[] }
  const eliminated = new Set(gs.eliminatedIds ?? [])
  return snapshot.agents.filter((a) => {
    if (eliminated.has(a.id)) return false
    if (excludeSelf && a.id === excludeSelf) return false
    return true
  })
}

// ── Agent Grid (reusable picker) ───────────────────────────

interface AgentGridProps {
  agents: AgentData[]
  selected: string | null
  onSelect: (id: string | null) => void
  disabledIds?: Set<string>
}

function AgentGrid({ agents, selected, onSelect, disabledIds }: AgentGridProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
        gap: 8,
        marginTop: 8,
        marginBottom: 12,
      }}
    >
      {agents.map((a) => {
        const isSelected = selected === a.id
        const isDisabled = disabledIds?.has(a.id) ?? false
        return (
          <button
            key={a.id}
            type="button"
            disabled={isDisabled}
            onClick={() => onSelect(isSelected ? null : a.id)}
            style={{
              padding: '8px 6px',
              borderRadius: 6,
              border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
              background: isSelected
                ? 'var(--accent-soft)'
                : isDisabled
                  ? 'var(--surface-hover)'
                  : 'var(--surface)',
              color: isDisabled ? 'var(--muted)' : 'var(--foreground)',
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              opacity: isDisabled ? 0.5 : 1,
              fontSize: 12,
              fontWeight: 510,
              textAlign: 'center',
              transition: 'all 150ms ease',
            }}
          >
            {a.name}
          </button>
        )
      })}
    </div>
  )
}

// ── Action Button ──────────────────────────────────────────

function ActionButton({
  label,
  onClick,
  disabled,
  variant = 'primary',
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'danger'
}) {
  const bg =
    variant === 'primary' && !disabled
      ? 'var(--accent)'
      : variant === 'danger' && !disabled
        ? 'var(--danger, #e74c3c)'
        : 'var(--surface-hover)'
  const color =
    variant === 'primary' && !disabled
      ? 'white'
      : variant === 'danger' && !disabled
        ? 'white'
        : disabled
          ? 'var(--muted)'
          : 'var(--foreground)'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: bg,
        color,
        border: 'none',
        padding: '6px 16px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 590,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  )
}

// ── Panel: Vote (wolf vote + day vote) ─────────────────────

export function VotePanel({
  roomId,
  humanAgentId,
  snapshot,
  onSubmitted,
  turnId, // 'wolf-vote' | 'day-vote'
}: WerewolfPanelCommonProps & { turnId: 'wolf-vote' | 'day-vote' }) {
  const [target, setTarget] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)

  const isWolfVote = turnId === 'wolf-vote'
  // Wolf vote: can target anyone except wolves (simplified: anyone except self for MVP)
  // Day vote: can target anyone except self
  const alive = getAliveAgents(snapshot, humanAgentId)
  const allowSkip = turnId === 'day-vote'

  async function submit() {
    if (!target && !allowSkip) return
    setSending(true)
    const ok = await submitHumanInput(roomId, humanAgentId, turnId, {
      target: target ?? 'skip',
      reason: reason.trim() || undefined,
    })
    setSending(false)
    if (ok) onSubmitted()
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 590, marginBottom: 4 }}>
        {isWolfVote ? '🗳️ Choose tonight\'s target' : '🗳️ Vote to eliminate'}
      </div>
      <AgentGrid agents={alive} selected={target} onSelect={setTarget} />
      {allowSkip && (
        <button
          onClick={() => setTarget('skip')}
          style={{
            padding: '4px 12px',
            marginBottom: 8,
            borderRadius: 6,
            border: `1px solid ${target === 'skip' ? 'var(--accent)' : 'var(--border)'}`,
            background: target === 'skip' ? 'var(--accent-tint)' : 'var(--surface)',
            color: target === 'skip' ? 'var(--accent)' : 'var(--muted)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          ⊘ Skip / Abstain
        </button>
      )}
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        style={{
          width: '100%',
          padding: '6px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--background)',
          color: 'var(--foreground)',
          fontSize: 13,
          marginBottom: 8,
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ActionButton
          label={sending ? '...' : 'Confirm Vote →'}
          onClick={() => void submit()}
          disabled={(!target) || sending}
        />
      </div>
    </div>
  )
}

// ── Panel: Witch Action ────────────────────────────────────

export function WitchPanel({
  roomId,
  humanAgentId,
  snapshot,
  onSubmitted,
}: WerewolfPanelCommonProps) {
  const gs = (snapshot.gameState ?? {}) as {
    lastNightKill?: string | null
    witchSaveUsed?: boolean
    witchPoisonUsed?: boolean
  }
  const killedId = gs.lastNightKill ?? null
  const saveUsed = gs.witchSaveUsed ?? false
  const poisonUsed = gs.witchPoisonUsed ?? false
  const killedAgent = killedId ? snapshot.agents.find((a) => a.id === killedId) : null

  const [action, setAction] = useState<'save' | 'poison' | 'pass' | null>(null)
  const [poisonTarget, setPoisonTarget] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const alive = getAliveAgents(snapshot, humanAgentId)

  async function submit(a: 'save' | 'poison' | 'pass') {
    if (a === 'poison' && !poisonTarget) return
    setSending(true)
    const ok = await submitHumanInput(roomId, humanAgentId, 'witch-action', {
      action: a,
      poisonTarget: a === 'poison' ? poisonTarget : undefined,
    })
    setSending(false)
    if (ok) onSubmitted()
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 590, marginBottom: 4 }}>
        {'🧪 '}Witch&apos;s Turn
      </div>
      {killedAgent ? (
        <div
          style={{
            padding: 10,
            marginBottom: 10,
            background: 'rgba(231, 76, 60, 0.08)',
            border: '1px solid rgba(231, 76, 60, 0.3)',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          Tonight the wolves killed: <b>{killedAgent.name}</b>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          No one was killed tonight.
        </div>
      )}

      {action === 'poison' ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
            Pick poison target:
          </div>
          <AgentGrid
            agents={alive.filter((a) => a.id !== killedId)}
            selected={poisonTarget}
            onSelect={setPoisonTarget}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <ActionButton label="Cancel" onClick={() => setAction(null)} variant="secondary" />
            <ActionButton
              label={sending ? '...' : 'Poison'}
              onClick={() => void submit('poison')}
              disabled={!poisonTarget || sending}
              variant="danger"
            />
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {killedAgent && !saveUsed && (
            <ActionButton
              label={sending ? '...' : '💊 Save 救人'}
              onClick={() => void submit('save')}
              disabled={sending}
            />
          )}
          {!poisonUsed && (
            <ActionButton
              label="☠️ Poison... 毒杀"
              onClick={() => setAction('poison')}
              variant="secondary"
            />
          )}
          <ActionButton
            label={sending ? '...' : '🚫 Pass 跳过'}
            onClick={() => void submit('pass')}
            disabled={sending}
            variant="secondary"
          />
        </div>
      )}
    </div>
  )
}

// ── Panel: Seer Check ──────────────────────────────────────

export function SeerPanel({
  roomId,
  humanAgentId,
  snapshot,
  onSubmitted,
}: WerewolfPanelCommonProps) {
  const [target, setTarget] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const alive = getAliveAgents(snapshot, humanAgentId)

  async function submit() {
    if (!target) return
    setSending(true)
    const ok = await submitHumanInput(roomId, humanAgentId, 'seer-check', { target })
    setSending(false)
    if (ok) onSubmitted()
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 590, marginBottom: 4 }}>
        {'🔮 '}Seer&apos;s Turn — Check one player
      </div>
      <AgentGrid agents={alive} selected={target} onSelect={setTarget} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ActionButton
          label={sending ? '...' : 'Check →'}
          onClick={() => void submit()}
          disabled={!target || sending}
        />
      </div>
    </div>
  )
}

// ── Panel: Guard Protect ───────────────────────────────────

export function GuardPanel({
  roomId,
  humanAgentId,
  snapshot,
  onSubmitted,
}: WerewolfPanelCommonProps) {
  const [target, setTarget] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const gs = (snapshot.gameState ?? {}) as { guardLastProtectedId?: string | null }
  const lastProtectedId = gs.guardLastProtectedId ?? null

  // Guard CAN protect self in Chinese rules — include self
  const alive = getAliveAgents(snapshot)
  const disabled = lastProtectedId ? new Set([lastProtectedId]) : undefined
  const lastProtected = lastProtectedId
    ? snapshot.agents.find((a) => a.id === lastProtectedId)
    : null

  async function submit() {
    if (!target) return
    setSending(true)
    const ok = await submitHumanInput(roomId, humanAgentId, 'guard-protect', { target })
    setSending(false)
    if (ok) onSubmitted()
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 590, marginBottom: 4 }}>
        {'🛡️ '}Guard&apos;s Turn — Protect one player tonight
      </div>
      {lastProtected && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
          ⚠️ You protected {lastProtected.name} last night — can&apos;t protect them again.
        </div>
      )}
      <AgentGrid agents={alive} selected={target} onSelect={setTarget} disabledIds={disabled} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ActionButton
          label={sending ? '...' : 'Protect →'}
          onClick={() => void submit()}
          disabled={!target || sending}
        />
      </div>
    </div>
  )
}

// ── Panel: Hunter Shoot ────────────────────────────────────

export function HunterPanel({
  roomId,
  humanAgentId,
  snapshot,
  onSubmitted,
}: WerewolfPanelCommonProps) {
  const [target, setTarget] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const alive = getAliveAgents(snapshot, humanAgentId)

  async function submit(shoot: boolean) {
    if (shoot && !target) return
    setSending(true)
    const ok = await submitHumanInput(roomId, humanAgentId, 'hunter-shoot', {
      shoot,
      target: shoot ? target : undefined,
    })
    setSending(false)
    if (ok) onSubmitted()
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 590, marginBottom: 4 }}>
        {'🏹 '}You&apos;ve been eliminated! Take someone with you?
      </div>
      <AgentGrid agents={alive} selected={target} onSelect={setTarget} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <ActionButton
          label="🚫 Don't shoot"
          onClick={() => void submit(false)}
          disabled={sending}
          variant="secondary"
        />
        <ActionButton
          label={sending ? '...' : '🏹 Shoot'}
          onClick={() => void submit(true)}
          disabled={!target || sending}
          variant="danger"
        />
      </div>
    </div>
  )
}

// ── Panel: Sheriff Election ────────────────────────────────

export function SheriffElectionPanel({
  roomId,
  humanAgentId,
  snapshot,
  onSubmitted,
}: WerewolfPanelCommonProps) {
  const [target, setTarget] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const alive = getAliveAgents(snapshot)

  async function submit(val: string | 'skip') {
    setSending(true)
    const ok = await submitHumanInput(roomId, humanAgentId, 'sheriff-election', { target: val })
    setSending(false)
    if (ok) onSubmitted()
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 590, marginBottom: 4 }}>
        {'🎖️ '}Sheriff Election — Vote for a candidate
      </div>
      <AgentGrid agents={alive} selected={target} onSelect={setTarget} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <ActionButton label="⊘ Don't run" onClick={() => void submit('skip')} variant="secondary" />
        <ActionButton
          label={sending ? '...' : 'Vote →'}
          onClick={() => target && submit(target)}
          disabled={!target || sending}
        />
      </div>
    </div>
  )
}

// ── Panel: Sheriff Transfer ────────────────────────────────

export function SheriffTransferPanel({
  roomId,
  humanAgentId,
  snapshot,
  onSubmitted,
}: WerewolfPanelCommonProps) {
  const [target, setTarget] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const alive = getAliveAgents(snapshot, humanAgentId)

  async function submit(val: string | 'destroy') {
    setSending(true)
    const ok = await submitHumanInput(roomId, humanAgentId, 'sheriff-transfer', { target: val })
    setSending(false)
    if (ok) onSubmitted()
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 590, marginBottom: 4 }}>
        {'🎖️ '}Transfer your Sheriff badge
      </div>
      <AgentGrid agents={alive} selected={target} onSelect={setTarget} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <ActionButton
          label="💥 Destroy badge"
          onClick={() => void submit('destroy')}
          variant="danger"
        />
        <ActionButton
          label={sending ? '...' : 'Transfer →'}
          onClick={() => target && submit(target)}
          disabled={!target || sending}
        />
      </div>
    </div>
  )
}
