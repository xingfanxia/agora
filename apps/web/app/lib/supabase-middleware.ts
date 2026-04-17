// ============================================================
// Supabase — middleware client + session refresh
// ============================================================
//
// Middleware runs on every request. We refresh the auth session
// cookie here so Server Components downstream see a fresh session
// without needing their own refresh logic.
//
// Separate from `supabase-server.ts` because middleware has a
// request/response pair we must thread cookies through.

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () =>
          request.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
        setAll: (cookiesToSet) => {
          // Next requires us to re-create the response so cookies attach
          // to the downstream request AND the user's browser.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // IMPORTANT: `getUser()` forces a round-trip to the auth server,
  // which refreshes the session cookie if near expiry. Do not replace
  // with `getSession()` — the cookie would go stale.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { response, user }
}
