// ============================================================
// AgentWizard — 4-step create/edit form for agents
// ============================================================
//
// Used by both /agents/new and /agents/[id]/edit. Matches Accio's
// wizard pattern: progress bar at top, back ghost + next green pill
// at bottom, Esc closes.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { getOrCreateUserId } from '../lib/user-id'
import { AgentAvatarPixel } from './AgentAvatarPixel'

interface ModelOption {
  provider: 'anthropic' | 'openai' | 'google' | 'deepseek'
  modelId: string
  label: string
}

const MODEL_OPTIONS: readonly ModelOption[] = [
  { provider: 'anthropic', modelId: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { provider: 'anthropic', modelId: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { provider: 'anthropic', modelId: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { provider: 'anthropic', modelId: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { provider: 'openai', modelId: 'gpt-5.4', label: 'GPT-5.4' },
  { provider: 'google', modelId: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { provider: 'deepseek', modelId: 'deepseek-chat', label: 'DeepSeek Chat' },
  { provider: 'deepseek', modelId: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
]

export interface AgentWizardInitial {
  id?: string            // set → edit mode
  name: string
  persona: string
  systemPrompt: string | null
  modelProvider: ModelOption['provider']
  modelId: string
  maxTokens: number
  language: 'zh' | 'en'
  avatarSeed: string
}

export const EMPTY_INITIAL: AgentWizardInitial = {
  name: '',
  persona: '',
  systemPrompt: null,
  modelProvider: 'anthropic',
  modelId: 'claude-opus-4-7',
  maxTokens: 1024,
  language: 'zh',
  avatarSeed: `seed-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
}

export interface AgentWizardProps {
  initial: AgentWizardInitial
  onCancelHref: string           // where to send user on cancel / back-from-step-1
}

export function AgentWizard({ initial, onCancelHref }: AgentWizardProps) {
  const router = useRouter()
  const t = useTranslations('agents')
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [form, setForm] = useState<AgentWizardInitial>(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const isEdit = Boolean(initial.id)

  // Esc → cancel (back to list)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') router.push(onCancelHref)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router, onCancelHref])

  // Ensure UID cookie is primed.
  useEffect(() => {
    getOrCreateUserId()
  }, [])

  const stepValid = useMemo(() => {
    if (step === 1) return form.name.trim().length > 0 && form.persona.trim().length >= 20
    if (step === 2) {
      return (
        form.modelId.trim().length > 0 &&
        form.maxTokens >= 200 &&
        form.maxTokens <= 4000
      )
    }
    return true
  }, [step, form])

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        persona: form.persona.trim(),
        systemPrompt: form.systemPrompt && form.systemPrompt.trim().length > 0 ? form.systemPrompt.trim() : null,
        modelProvider: form.modelProvider,
        modelId: form.modelId,
        avatarSeed: form.avatarSeed,
        style: {
          maxTokens: form.maxTokens,
          language: form.language,
        },
      }
      const url = isEdit ? `/api/agents/${initial.id}` : '/api/agents'
      const method = isEdit ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as { agent: { id: string } }
      router.push(`/agents/${data.agent.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  function next() {
    if (!stepValid) return
    if (step === 4) {
      void submit()
      return
    }
    setStep((s) => (s + 1) as 1 | 2 | 3 | 4)
  }

  function back() {
    if (step === 1) {
      router.push(onCancelHref)
      return
    }
    setStep((s) => (s - 1) as 1 | 2 | 3 | 4)
  }

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '32px 24px 120px',
      }}
    >
      {/* Progress */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            fontSize: 12,
            color: 'var(--muted)',
            fontWeight: 510,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            marginBottom: 8,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{t(`wizard.stepLabel`, { current: step, total: 4 })}</span>
          <span>{Math.round((step / 4) * 100)}%</span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 4,
          }}
        >
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              style={{
                height: 4,
                borderRadius: 2,
                background: s <= step ? 'var(--accent)' : 'var(--border)',
                transition: 'background .2s ease',
              }}
            />
          ))}
        </div>
      </div>

      <h1
        style={{
          fontSize: 28,
          fontWeight: 590,
          marginBottom: 8,
          color: 'var(--foreground)',
        }}
      >
        {step === 1 && t('wizard.step1.title')}
        {step === 2 && t('wizard.step2.title')}
        {step === 3 && t('wizard.step3.title')}
        {step === 4 && t('wizard.step4.title')}
      </h1>
      <p
        style={{
          fontSize: 14,
          color: 'var(--muted)',
          marginBottom: 32,
          lineHeight: 1.55,
        }}
      >
        {step === 1 && t('wizard.step1.subtitle')}
        {step === 2 && t('wizard.step2.subtitle')}
        {step === 3 && t('wizard.step3.subtitle')}
        {step === 4 && t('wizard.step4.subtitle')}
      </p>

      {step === 1 && (
        <Step1Identity
          form={form}
          update={(p) => setForm({ ...form, ...p })}
          t={t}
        />
      )}
      {step === 2 && (
        <Step2Model
          form={form}
          update={(p) => setForm({ ...form, ...p })}
          t={t}
        />
      )}
      {step === 3 && <Step3Prompt form={form} update={(p) => setForm({ ...form, ...p })} t={t} />}
      {step === 4 && <Step4Review form={form} t={t} />}

      {error && (
        <div
          style={{
            marginTop: 24,
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(220, 53, 69, 0.08)',
            color: 'var(--danger)',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '16px 24px',
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 10,
        }}
      >
        <button
          type="button"
          onClick={back}
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
          {step === 1 ? t('wizard.cancel') : t('wizard.back')}
        </button>
        <button
          type="button"
          onClick={next}
          disabled={!stepValid || saving}
          style={{
            background: stepValid && !saving ? 'var(--accent)' : 'var(--surface-hover)',
            color: stepValid && !saving ? 'white' : 'var(--muted)',
            border: 'none',
            padding: '10px 20px',
            borderRadius: 999,
            fontSize: 14,
            fontWeight: 590,
            cursor: stepValid && !saving ? 'pointer' : 'not-allowed',
            minWidth: 140,
          }}
        >
          {step === 4
            ? saving
              ? t('wizard.saving')
              : isEdit
                ? t('wizard.save')
                : t('wizard.create')
            : t('wizard.next', { step: nextLabel(step, t) })}
        </button>
      </div>
    </div>
  )
}

function nextLabel(step: 1 | 2 | 3 | 4, t: (k: string, values?: Record<string, string | number>) => string): string {
  if (step === 1) return t('wizard.step2.title')
  if (step === 2) return t('wizard.step3.title')
  if (step === 3) return t('wizard.step4.title')
  return ''
}

// ── Step 1: Identity ───────────────────────────────────────

function Step1Identity({
  form,
  update,
  t,
}: {
  form: AgentWizardInitial
  update: (patch: Partial<AgentWizardInitial>) => void
  t: (k: string, values?: Record<string, string | number>) => string
}) {
  function regenAvatar() {
    update({ avatarSeed: `seed-${Date.now()}-${Math.floor(Math.random() * 1e6)}` })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ textAlign: 'center' }}>
          <AgentAvatarPixel seed={form.avatarSeed} size={96} />
          <button
            type="button"
            onClick={regenAvatar}
            style={{
              marginTop: 8,
              background: 'transparent',
              color: 'var(--accent)',
              border: 'none',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 510,
            }}
          >
            {t('wizard.step1.regenAvatar')}
          </button>
        </div>
        <div style={{ flex: 1 }}>
          <Label>{t('wizard.step1.nameLabel')}</Label>
          <input
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder={t('wizard.step1.namePlaceholder')}
            maxLength={100}
            style={inputStyle}
          />
        </div>
      </div>
      <div>
        <Label>{t('wizard.step1.personaLabel')}</Label>
        <textarea
          value={form.persona}
          onChange={(e) => update({ persona: e.target.value })}
          placeholder={t('wizard.step1.personaPlaceholder')}
          maxLength={4000}
          rows={8}
          style={{ ...inputStyle, fontFamily: 'inherit', lineHeight: 1.55, resize: 'vertical' }}
        />
        <HelpText>{t('wizard.step1.personaHelp', { count: form.persona.length, max: 4000 })}</HelpText>
      </div>
    </div>
  )
}

// ── Step 2: Model ──────────────────────────────────────────

function Step2Model({
  form,
  update,
  t,
}: {
  form: AgentWizardInitial
  update: (patch: Partial<AgentWizardInitial>) => void
  t: (k: string, values?: Record<string, string | number>) => string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <Label>{t('wizard.step2.modelLabel')}</Label>
        <select
          value={`${form.modelProvider}:${form.modelId}`}
          onChange={(e) => {
            const [provider, modelId] = e.target.value.split(':')
            update({ modelProvider: provider as ModelOption['provider'], modelId: modelId! })
          }}
          style={inputStyle}
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={`${m.provider}:${m.modelId}`} value={`${m.provider}:${m.modelId}`}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label>{t('wizard.step2.maxTokensLabel')}: {form.maxTokens}</Label>
        <input
          type="range"
          min={200}
          max={4000}
          step={100}
          value={form.maxTokens}
          onChange={(e) => update({ maxTokens: parseInt(e.target.value, 10) })}
          style={{ width: '100%' }}
        />
        <HelpText>{t('wizard.step2.maxTokensHelp')}</HelpText>
      </div>
      <div>
        <Label>{t('wizard.step2.languageLabel')}</Label>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['zh', 'en'] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => update({ language: lang })}
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${form.language === lang ? 'var(--accent)' : 'var(--border)'}`,
                background: form.language === lang ? 'var(--accent-tint)' : 'var(--surface)',
                color: form.language === lang ? 'var(--accent)' : 'var(--foreground)',
                fontSize: 14,
                fontWeight: 510,
                cursor: 'pointer',
              }}
            >
              {lang === 'zh' ? '中文' : 'English'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Step 3: Prompt ─────────────────────────────────────────

function Step3Prompt({
  form,
  update,
  t,
}: {
  form: AgentWizardInitial
  update: (patch: Partial<AgentWizardInitial>) => void
  t: (k: string, values?: Record<string, string | number>) => string
}) {
  const usingCustom = form.systemPrompt !== null
  const preview = useMemo(() => {
    return [
      `你是 ${form.name || 'Agent'}。`,
      '',
      `身份：${form.persona || '（在步骤 1 填写）'}`,
      '',
      form.language === 'zh'
        ? '请用简体中文回应。保持简洁、具体、有观点。'
        : 'Respond in English. Be concise, specific, and opinionated.',
    ].join('\n')
  }, [form.name, form.persona, form.language])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => update({ systemPrompt: null })}
          style={{
            flex: 1,
            padding: '10px 16px',
            borderRadius: 'var(--radius-sm)',
            border: `1px solid ${!usingCustom ? 'var(--accent)' : 'var(--border)'}`,
            background: !usingCustom ? 'var(--accent-tint)' : 'var(--surface)',
            color: !usingCustom ? 'var(--accent)' : 'var(--foreground)',
            fontSize: 14,
            fontWeight: 510,
            cursor: 'pointer',
          }}
        >
          {t('wizard.step3.autoCompose')}
        </button>
        <button
          type="button"
          onClick={() => update({ systemPrompt: form.systemPrompt ?? '' })}
          style={{
            flex: 1,
            padding: '10px 16px',
            borderRadius: 'var(--radius-sm)',
            border: `1px solid ${usingCustom ? 'var(--accent)' : 'var(--border)'}`,
            background: usingCustom ? 'var(--accent-tint)' : 'var(--surface)',
            color: usingCustom ? 'var(--accent)' : 'var(--foreground)',
            fontSize: 14,
            fontWeight: 510,
            cursor: 'pointer',
          }}
        >
          {t('wizard.step3.custom')}
        </button>
      </div>
      {usingCustom ? (
        <div>
          <Label>{t('wizard.step3.customLabel')}</Label>
          <textarea
            value={form.systemPrompt ?? ''}
            onChange={(e) => update({ systemPrompt: e.target.value })}
            placeholder={t('wizard.step3.customPlaceholder')}
            maxLength={8000}
            rows={12}
            style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace', lineHeight: 1.55, resize: 'vertical', fontSize: 13 }}
          />
          <HelpText>{t('wizard.step3.customHelp', { count: (form.systemPrompt ?? '').length, max: 8000 })}</HelpText>
        </div>
      ) : (
        <div>
          <Label>{t('wizard.step3.previewLabel')}</Label>
          <pre
            style={{
              ...inputStyle,
              fontFamily: 'ui-monospace, monospace',
              fontSize: 13,
              lineHeight: 1.55,
              margin: 0,
              whiteSpace: 'pre-wrap',
              color: 'var(--muted-strong, var(--foreground))',
              background: 'var(--surface-hover)',
              minHeight: 200,
            }}
          >
            {preview}
          </pre>
          <HelpText>{t('wizard.step3.previewHelp')}</HelpText>
        </div>
      )}
    </div>
  )
}

// ── Step 4: Review ─────────────────────────────────────────

function Step4Review({
  form,
  t,
}: {
  form: AgentWizardInitial
  t: (k: string, values?: Record<string, string | number>) => string
}) {
  return (
    <div
      style={{
        padding: 24,
        borderRadius: 'var(--radius)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <AgentAvatarPixel seed={form.avatarSeed} size={64} />
        <div>
          <div style={{ fontSize: 20, fontWeight: 590 }}>{form.name}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {form.modelProvider} · {form.modelId}
          </div>
        </div>
      </div>
      <ReviewRow label={t('wizard.step4.personaLabel')} value={form.persona} />
      <ReviewRow
        label={t('wizard.step4.styleLabel')}
        value={`${form.maxTokens} tokens · ${form.language === 'zh' ? '中文' : 'English'}`}
      />
      <ReviewRow
        label={t('wizard.step4.promptLabel')}
        value={
          form.systemPrompt === null ? t('wizard.step4.promptAuto') : form.systemPrompt
        }
      />
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--muted)',
          fontWeight: 510,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          color: 'var(--foreground)',
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
        }}
      >
        {value}
      </div>
    </div>
  )
}

// ── Atoms ──────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 510,
        color: 'var(--foreground)',
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  )
}

function HelpText({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        color: 'var(--muted)',
        marginTop: 6,
      }}
    >
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--foreground)',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}
