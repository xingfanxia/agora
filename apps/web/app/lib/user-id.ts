// ============================================================
// User id — localStorage UID (V1) → Supabase Auth user id (4.5d)
// ============================================================
//
// V1 identity model:
// - Client picks a uuid on first visit, stores it in `localStorage.agora-uid`.
// - Client mirrors the same uuid into a cookie `agora-uid` so that
//   server-side API routes can read `req.cookies.get('agora-uid')`
//   for ownership checks on agents/teams they mutate.
// - Cookie is set without HttpOnly so the client can manage sync;
//   it's not a security boundary in V1 — just a convenience for
//   "this device's agents". Real auth comes in 4.5d when Supabase
//   Auth replaces this helper with Supabase session tokens.

const COOKIE_NAME = 'agora-uid'
const LOCAL_KEY = 'agora-uid'

// Cookie lifetime: 1 year. Rewritten on every visit that syncs,
// so it effectively slides.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

// ── Client ──────────────────────────────────────────────────

/**
 * Client-side only. Returns the UID for this browser, creating one
 * on first call. Also keeps a matching cookie in sync so server routes
 * can read it.
 */
export function getOrCreateUserId(): string {
  if (typeof window === 'undefined') {
    throw new Error('getOrCreateUserId() is client-only')
  }

  let uid = window.localStorage.getItem(LOCAL_KEY)
  if (!uid) {
    uid = crypto.randomUUID()
    window.localStorage.setItem(LOCAL_KEY, uid)
  }

  // Always write the cookie — cheap, and covers the case where the
  // cookie got cleared but localStorage survived.
  const existingCookie = readCookieClient(COOKIE_NAME)
  if (existingCookie !== uid) {
    document.cookie = [
      `${COOKIE_NAME}=${uid}`,
      'path=/',
      `max-age=${COOKIE_MAX_AGE_SECONDS}`,
      'samesite=lax',
    ].join('; ')
  }

  return uid
}

function readCookieClient(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
  return match ? match.slice(name.length + 1) : null
}

// ── Server ──────────────────────────────────────────────────

import type { NextRequest } from 'next/server'

/**
 * Server-side helper. Returns the UID from the cookie if present,
 * else null. API routes that require ownership should 401 on null.
 */
export function getUserIdFromRequest(request: NextRequest | Request): string | null {
  const cookieHeader =
    'cookies' in request && typeof (request as NextRequest).cookies?.get === 'function'
      ? (request as NextRequest).cookies.get(COOKIE_NAME)?.value ?? null
      : parseCookieHeader(request.headers.get('cookie'))?.[COOKIE_NAME] ?? null
  return cookieHeader
}

function parseCookieHeader(header: string | null): Record<string, string> | null {
  if (!header) return null
  const out: Record<string, string> = {}
  for (const chunk of header.split(';')) {
    const [k, ...rest] = chunk.trim().split('=')
    if (k) out[k] = rest.join('=')
  }
  return out
}
