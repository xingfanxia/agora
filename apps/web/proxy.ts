// ============================================================
// Proxy (Next 16 middleware) — session refresh + auth-required redirects
// ============================================================
//
// Runs on every non-static request. While the offline switch is on
// (default, app/lib/offline.ts) it only serves the offline notice and
// 410 API responses. Otherwise two jobs:
//
//   1. Refresh the Supabase session cookie (so Server Components
//      downstream see a fresh session without their own refresh).
//   2. Redirect unauthed users away from create/edit pages that
//      require an account. API routes do their own 401 checks —
//      the proxy only redirects page navigations.
//
// The `/room/[id]`, `/r/[roomId]`, `/replay/[id]`, and the tick/
// human-input API routes stay public so guests with seat tokens
// can play without an account.

import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from './app/lib/supabase-middleware'
import { OFFLINE_API_BODY, isOffline } from './app/lib/offline'

const AUTH_REQUIRED_PREFIXES = [
  '/rooms/new',
  '/agents/new',
  '/teams/new',
] as const

const AUTH_REQUIRED_SUFFIXES = ['/edit'] as const

function pageRequiresAuth(pathname: string): boolean {
  if (AUTH_REQUIRED_PREFIXES.some((p) => pathname.startsWith(p))) return true
  if (AUTH_REQUIRED_SUFFIXES.some((s) => pathname.endsWith(s))) return true
  return false
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Offline switch (default on, see app/lib/offline.ts): answer before
  // touching Supabase so no route depends on the deleted database.
  if (isOffline()) {
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return NextResponse.json(OFFLINE_API_BODY, {
        status: 410,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
    if (pathname === '/offline') return NextResponse.next()
    return NextResponse.rewrite(new URL('/offline', request.url))
  }

  const { response, user } = await updateSession(request)

  // Admin pages carry ?secret= in the URL and show hidden game state:
  // never leak the URL via Referer, never cache the response.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.headers.set('Cache-Control', 'no-store')
    return response
  }

  // Already-authed users on /login → bounce to home.
  if (pathname === '/login' && user) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Unauthed users on protected pages → bounce to /login with return path.
  if (!user && pageRequiresAuth(pathname)) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  // Match everything except Next.js internals, favicon and the
  // root-level image files in public/. Only top-level names are skipped,
  // so a URL like /room/x.png still reaches the proxy (and the offline
  // switch). The proxy must still run on /auth/callback + /login so
  // session cookies attach correctly.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|[^/]+\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
