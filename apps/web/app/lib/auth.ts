// ============================================================
// Server-only auth helpers (Phase 4.5d)
// ============================================================
//
// Kept separate from `user-id.ts` because this module imports
// `next/headers` (via `supabase-server.ts`). Mixing server-only
// code into a file that client components also reach breaks the
// Next bundler.

import type { NextRequest } from 'next/server'
import { getAuthUser } from './supabase-server'
import { getUserIdFromRequest } from './user-id'

/**
 * Preferred id for CREATE operations: auth user id when logged in,
 * otherwise null. Routes that require auth should 401 on null.
 *
 * Legacy localStorage UIDs are no longer accepted as identity for
 * new writes — members must log in. Anon browsing still works.
 */
export async function requireAuthUserId(): Promise<
  { ok: true; id: string; email: string } | { ok: false }
> {
  const user = await getAuthUser()
  if (!user?.email) return { ok: false }
  return { ok: true, id: user.id, email: user.email }
}

/**
 * Best-effort identity for READ queries: auth id if logged in, else
 * legacy localStorage UID cookie, else null.
 *
 * Used where we want to show "my agents" for both authed and anon
 * users during the transition period.
 */
export async function getReaderId(request: NextRequest | Request): Promise<string | null> {
  const user = await getAuthUser()
  if (user?.id) return user.id
  return getUserIdFromRequest(request)
}
