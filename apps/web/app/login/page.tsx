// ============================================================
// /login — magic-link signup/signin
// ============================================================
//
// Anyone can submit an email. Supabase sends the magic link. The
// allowlist check happens in /auth/callback AFTER code exchange, so
// unauthenticated probing can't enumerate which emails are allowed.

'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { supabaseBrowser } from '../lib/supabase-browser'

export default function LoginPage() {
  const tCommon = useTranslations('common')
  return (
    <Suspense fallback={<div style={{ padding: 40 }}>{tCommon('loading')}</div>}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const t = useTranslations('login')
  const search = useSearchParams()
  const errorParam = search.get('error')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setErrorMsg(null)
    try {
      const supabase = supabaseBrowser()
      const redirectTo = `${window.location.origin}/auth/callback`
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      })
      if (error) throw error
      setStatus('sent')
    } catch (err) {
      setStatus('error')
      console.error('[login] signInWithOtp failed:', err)
      setErrorMsg(t('sendFailed'))
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '80px auto', padding: '0 24px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 590, marginBottom: 8 }}>Agora</h1>
      <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.6 }}>
        {t('intro')}
      </p>

      {errorParam === 'not_allowed' && (
        <div
          style={{
            marginBottom: 20,
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(220, 53, 69, 0.08)',
            color: 'var(--danger)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {t('notAllowed')}
        </div>
      )}

      {status === 'sent' ? (
        <div
          style={{
            padding: '16px 20px',
            borderRadius: 'var(--radius)',
            background: 'var(--accent-tint)',
            border: '1px solid var(--accent)',
            color: 'var(--foreground)',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {t.rich('sent', { email, strong: (chunks) => <strong>{chunks}</strong> })}
        </div>
      ) : (
        <form onSubmit={submit}>
          <label
            htmlFor="email"
            style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 510,
              marginBottom: 6,
            }}
          >
            {t('emailLabel')}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--foreground)',
              fontSize: 14,
              outline: 'none',
              boxSizing: 'border-box',
              marginBottom: 16,
            }}
          />
          <button
            type="submit"
            disabled={status === 'sending' || !email.trim()}
            style={{
              width: '100%',
              background:
                status === 'sending' || !email.trim()
                  ? 'rgba(255,255,255,0.04)'
                  : 'var(--accent-strong)',
              color:
                status === 'sending' || !email.trim() ? 'var(--muted)' : '#ffffff',
              border: 'none',
              padding: '10px 16px',
              borderRadius: 'var(--radius-card)',
              fontSize: 14,
              fontWeight: 590,
              cursor:
                status === 'sending' || !email.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {status === 'sending' ? t('sending') : t('submit')}
          </button>
          {errorMsg && (
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--danger)' }}>
              {errorMsg}
            </div>
          )}
        </form>
      )}
    </div>
  )
}
