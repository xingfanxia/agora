// ============================================================
// Supabase — browser client (Client Components)
// ============================================================
//
// Singleton per tab. `@supabase/ssr` handles cookie sync with
// `document.cookie`; middleware refreshes the session cookie on
// every request so this client's view is never stale for long.

import { createBrowserClient } from '@supabase/ssr'

let client: ReturnType<typeof createBrowserClient> | null = null

export function supabaseBrowser() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }
  return client
}
