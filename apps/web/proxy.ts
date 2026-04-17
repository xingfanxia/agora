// ============================================================
// Proxy (Next 16 middleware) — session refresh + auth-required redirects
// ============================================================
//
// Runs on every non-static request. Two jobs:
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
  const { response, user } = await updateSession(request)
  const { pathname } = request.nextUrl

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
  // Match everything except Next.js internals, common static assets,
  // and favicon. The proxy must still run on /auth/callback + /login
  // so session cookies attach correctly.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
