// ============================================================
// TeamComposer — build or edit a team (Accio split layout)
// ============================================================
//
// Left column: Available agents (templates + my agents) with search
//              and a "+ Add" button per card.
// Right column: Selected members in order, leader toggle (⚜ crown),
//               team name + description + default mode + Save.
// Enforces max 12 members.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AgentAvatarPixel } from './AgentAvatarPixel'
import { getOrCreateUserId } from '../lib/user-id'

interface AvailableAgent {
  id: string
  name: string
  persona: string
  avatarSeed: string
  modelProvider: string
  modelId: string
  isTemplate: boolean
}

export interface TeamComposerInitial {
  id?: string                // present → edit mode
  name: string
  description: string
  avatarSeed: string
  defaultModeId: 'open-chat' | 'roundtable' | 'werewolf'
  leaderAgentId: string | null
  memberIds: readonly string[]  // ordered
}

export const EMPTY_TEAM_INITIAL: TeamComposerInitial = {
  name: '',
  description: '',
  avatarSeed: `team-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  defaultModeId: 'open-chat',
  leaderAgentId: null,
  memberIds: [],
}

export interface TeamComposerProps {
  initial: TeamComposerInitial
  onCancelHref: string
}

const MAX_MEMBERS = 12
const MODE_OPTIONS: { id: TeamComposerInitial['defaultModeId']; label: string }[] = [
  { id: 'open-chat', label: '开放对话' },
  { id: 'roundtable', label: '轮桌辩论' },
  { id: 'werewolf', label: '狼人杀' },
]

export function TeamComposer({ initial, onCancelHref }: TeamComposerProps) {
  const router = useRouter()
  const t = useTranslations('teams')
  const [available, setAvailable] = useState<AvailableAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<TeamComposerInitial>(initial)
  const [search, setSearch] = useState('')

  const isEdit = Boolean(initial.id)

  useEffect(() => {
    getOrCreateUserId()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch('/api/agents')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { agents: AvailableAgent[] }
        if (!cancelled) setAvailable(data.agents ?? [])
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const availableById = useMemo(() => {
    const m = new Map<string, AvailableAgent>()
    for (const a of available) m.set(a.id, a)
    return m
  }, [available])

  const selected: AvailableAgent[] = useMemo(() => {
    return form.memberIds
      .map((id) => availableById.get(id))
      .filter((a): a is AvailableAgent => Boolean(a))
  }, [form.memberIds, availableById])

  const filteredAvailable = useMemo(() => {
    const q = search.trim().toLowerCase()
    return available
      .filter((a) => !form.memberIds.includes(a.id))
      .filter((a) => {
        if (!q) return true
        return a.name.toLowerCase().includes(q) || a.persona.toLowerCase().includes(q)
      })
  }, [available, form.memberIds, search])

  function addMember(agent: AvailableAgent) {
    if (form.memberIds.includes(agent.id)) return
    if (form.memberIds.length >= MAX_MEMBERS) return
    setForm({ ...form, memberIds: [...form.memberIds, agent.id] })
  }
  function removeMember(agentId: string) {
    const next = form.memberIds.filter((id) => id !== agentId)
    const newLeader = form.leaderAgentId === agentId ? null : form.leaderAgentId
    setForm({ ...form, memberIds: next, leaderAgentId: newLeader })
  }
  function toggleLeader(agentId: string) {
    setForm({ ...form, leaderAgentId: form.leaderAgentId === agentId ? null : agentId })
  }
  function moveMember(agentId: string, delta: -1 | 1) {
    const idx = form.memberIds.indexOf(agentId)
    if (idx < 0) return
    const target = idx + delta
    if (target < 0 || target >= form.memberIds.length) return
    const next = [...form.memberIds]
    ;[next[idx], next[target]] = [next[target]!, next[idx]!]
    setForm({ ...form, memberIds: next })
  }

  const canSave =
    form.name.trim().length > 0 &&
    form.memberIds.length >= 1 &&
    form.memberIds.length <= MAX_MEMBERS

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      if (isEdit) {
        const patchRes = await fetch(`/api/teams/${initial.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || null,
            avatarSeed: form.avatarSeed,
            defaultModeId: form.defaultModeId,
          }),
        })
        if (!patchRes.ok) {
          const err = await patchRes.json().catch(() => ({ error: 'Failed' }))
          throw new Error((err as { error?: string }).error ?? `HTTP ${patchRes.status}`)
        }
        const putRes = await fetch(`/api/teams/${initial.id}/members`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderedAgentIds: form.memberIds,
            leaderAgentId: form.leaderAgentId,
          }),
        })
        if (!putRes.ok) {
          const err = await putRes.json().catch(() => ({ error: 'Failed' }))
          throw new Error((err as { error?: string }).error ?? `HTTP ${putRes.status}`)
        }
        router.push(`/teams/${initial.id}`)
      } else {
        const res = await fetch('/api/teams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || null,
            avatarSeed: form.avatarSeed,
            defaultModeId: form.defaultModeId,
            memberIds: form.memberIds,
            leaderAgentId: form.leaderAgentId,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Failed' }))
          throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
        }
        const data = (await res.json()) as { team: { id: string } }
        router.push(`/teams/${data.team.id}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 590, marginBottom: 4 }}>
        {isEdit ? t('edit.title') : t('new.title')}
      </h1>
      <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24 }}>
        {isEdit ? t('edit.subtitle') : t('new.subtitle')}
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(300px, 1fr) minmax(360px, 1fr)',
          gap: 24,
        }}
      >
        {/* Available */}
        <section
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 16,
            maxHeight: '70vh',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 590,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              color: 'var(--muted)',
              marginBottom: 12,
            }}
          >
            {t('composer.availableTitle')}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('composer.searchPlaceholder')}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface-hover)',
              color: 'var(--foreground)',
              fontSize: 13,
              marginBottom: 12,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ overflow: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {loading && <p style={{ color: 'var(--muted)', fontSize: 13 }}>{t('composer.loading')}</p>}
            {!loading && filteredAvailable.length === 0 && (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>{t('composer.noMatches')}</p>
            )}
            {filteredAvailable.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => addMember(a)}
                disabled={form.memberIds.length >= MAX_MEMBERS}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  border: '1px solid transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 13,
                  width: '100%',
                }}
              >
                <AgentAvatarPixel seed={a.avatarSeed} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 510, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.name}
                    {a.isTemplate && (
                      <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 6 }}>模板</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{a.modelId}</div>
                </div>
                <span style={{ color: 'var(--accent)', fontSize: 16, fontWeight: 590 }}>+</span>
              </button>
            ))}
          </div>
        </section>

        {/* Selected + form */}
        <section
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 590,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              color: 'var(--muted)',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>{t('composer.selectedTitle')}</span>
            <span>
              {form.memberIds.length} / {MAX_MEMBERS}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {selected.length === 0 && (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>{t('composer.noneSelected')}</p>
            )}
            {selected.map((a) => {
              const isLeader = form.leaderAgentId === a.id
              return (
                <div
                  key={a.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: isLeader ? 'var(--accent-tint)' : 'transparent',
                    border: `1px solid ${isLeader ? 'var(--accent-ring)' : 'transparent'}`,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleLeader(a.id)}
                    title={t('composer.leaderToggle')}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 14,
                      color: isLeader ? 'var(--accent)' : 'var(--muted)',
                      padding: 0,
                      width: 20,
                    }}
                  >
                    ⚜
                  </button>
                  <AgentAvatarPixel seed={a.avatarSeed} size={28} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 510, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.name}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => moveMember(a.id, -1)}
                    title={t('composer.moveUp')}
                    style={iconBtnStyle}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveMember(a.id, 1)}
                    title={t('composer.moveDown')}
                    style={iconBtnStyle}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeMember(a.id)}
                    title={t('composer.remove')}
                    style={{ ...iconBtnStyle, color: 'var(--danger)' }}
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>

          {/* Team form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('composer.nameLabel')}>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t('composer.namePlaceholder')}
                maxLength={100}
                style={inputStyle}
              />
            </Field>
            <Field label={t('composer.descriptionLabel')}>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={t('composer.descriptionPlaceholder')}
                maxLength={2000}
                rows={3}
                style={{ ...inputStyle, fontFamily: 'inherit', lineHeight: 1.55, resize: 'vertical' }}
              />
            </Field>
            <Field label={t('composer.modeLabel')}>
              <div style={{ display: 'flex', gap: 8 }}>
                {MODE_OPTIONS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setForm({ ...form, defaultModeId: m.id })}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${form.defaultModeId === m.id ? 'var(--accent)' : 'var(--border)'}`,
                      background:
                        form.defaultModeId === m.id ? 'var(--accent-tint)' : 'var(--surface)',
                      color: form.defaultModeId === m.id ? 'var(--accent)' : 'var(--foreground)',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {error && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(220, 53, 69, 0.08)',
                color: 'var(--danger)',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button
              type="button"
              onClick={() => router.push(onCancelHref)}
              style={{
                background: 'transparent',
                color: 'var(--muted-strong, var(--muted))',
                border: 'none',
                padding: '8px 16px',
                fontSize: 14,
                fontWeight: 510,
                cursor: 'pointer',
              }}
            >
              {t('composer.cancel')}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!canSave || saving}
              style={{
                background: canSave && !saving ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
                color: canSave && !saving ? '#08090a' : 'var(--muted)',
                border: 'none',
                padding: '10px 20px',
                borderRadius: 'var(--radius-card)',
                fontSize: 14,
                fontWeight: 590,
                cursor: canSave && !saving ? 'pointer' : 'not-allowed',
                minWidth: 120,
              }}
            >
              {saving ? t('composer.saving') : isEdit ? t('composer.save') : t('composer.create')}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 510, color: 'var(--foreground)', marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--foreground)',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--muted)',
  fontSize: 13,
  padding: '2px 6px',
  borderRadius: 4,
}
