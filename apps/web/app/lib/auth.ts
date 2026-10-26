// ============================================================
// Server-only auth helpers (Phase 4.5d)
// ============================================================
//
// Kept separate from `user-id.ts` because this module imports
// `next/headers` (via `supabase-server.ts`). Mixing server-only
// code into a file that client components also reach breaks the
// Next bundler.

import { getAuthUser } from './supabase-server'

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
 * Identity for READ queries of private rows ("my agents/teams", private
 * detail pages): the verified Supabase session user id, else null.
 *
 * The legacy `agora-uid` cookie is NOT accepted here: it is unsigned and
 * shares the UUID space with real account ids, so trusting it would let
 * anyone who knows a user's id read that user's private rows. Callers
 * with only the legacy cookie are anonymous (templates only). Legacy
 * anonymous rows are covered by a separate migration proposal.
 */
export async function getReaderId(): Promise<string | null> {
  const user = await getAuthUser()
  return user?.id ?? null
}

/**
 * Template rows are public; anything else only for its verified owner.
 * Used wherever private agent/team content (persona, systemPrompt) could
 * be read or copied (detail GETs, room creation from a teamId).
 */
export function canReadOwnedRow(
  row: { isTemplate: boolean; createdBy: string | null },
  readerId: string | null,
): boolean {
  return row.isTemplate || (readerId != null && row.createdBy === readerId)
}
