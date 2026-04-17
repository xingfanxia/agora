// ============================================================
// Supabase — server client (Server Components, Route Handlers)
// ============================================================
//
// Phase 4.5d auth layer. Use this in Server Components and Route
// Handlers that need access to the authed user or the Supabase API
// on the server. Middleware uses a different client (see
// `supabase-middleware.ts`) because it has to pair request/response
// for cookie refresh.
//
// Cookies API note: `next/headers`' `cookies()` is async on Next 15+.
// Awaiting once per request is fine — it's a request-scoped cache.

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // `cookieStore.set` throws in Server Components (read-only).
            // Middleware handles session refresh; swallow here so
            // `getUser()` inside a Server Component still works.
          }
        },
      },
    },
  )
}

/**
 * Service-role client — bypasses RLS. ONLY use server-side for
 * privileged operations (allowlist reads, admin inserts). Never ship
 * the service role key to a client bundle.
 */
export function createSupabaseServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  })
}

/**
 * Convenience: returns the authed user (verified against auth server)
 * or null if no session. Use for authorization decisions in Server
 * Components and Route Handlers.
 */
export async function getAuthUser() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user
}
