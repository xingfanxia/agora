// ============================================================
// GET /auth/callback — magic-link code exchange + allowlist gate
// ============================================================
//
// Supabase magic-link sends the user here with ?code=...  We:
//   1. Exchange the code for a session (sets cookies)
//   2. Fetch the newly-authed user
//   3. Check `allowed_emails` via the service-role client
//   4. If not allowed — sign out and redirect to /login?error=not_allowed
//   5. If allowed — redirect to `next` (default /)
//
// Checking AFTER exchange (not on the /login form) means
// unauthenticated callers can't probe which emails are members.

import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic'

/**
 * Only accept `next` paths that are strictly same-origin relative:
 * start with a single "/" and NOT "//" (which Node's URL parser treats
 * as protocol-relative, enabling redirects to arbitrary origins).
 * Reject any scheme prefix. Anything else falls back to "/".
 */
function sanitizeNext(raw: string | null): string {
  if (!raw) return '/'
  if (!raw.startsWith('/')) return '/'
  if (raw.startsWith('//')) return '/'
  if (raw.includes(':')) return '/'  // guards `/foo:bar` → javascript:, data:, etc.
  return raw
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = sanitizeNext(url.searchParams.get('next'))

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin))
  }

  const supabase = await createSupabaseServerClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeError) {
    console.error('[auth/callback] code exchange failed:', exchangeError)
    return NextResponse.redirect(new URL('/login?error=exchange_failed', url.origin))
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=no_email', url.origin))
  }

  const email = user.email.toLowerCase()
  const service = createSupabaseServiceClient()
  const { data: allowed, error: lookupError } = await service
    .from('allowed_emails')
    .select('email')
    .eq('email', email)
    .maybeSingle()

  if (lookupError) {
    console.error('[auth/callback] allowlist lookup failed:', lookupError)
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=lookup_failed', url.origin))
  }

  if (!allowed) {
    // Email is not on the allowlist. Sign out so no session lingers.
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=not_allowed', url.origin))
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
