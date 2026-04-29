# RLS Hardening — 2026-04-28

**Date:** 2026-04-28
**Project:** agora (Supabase project `ewenvftletxvtrsvtvyd`, agora-db)
**Vercel project:** `agora` (`prj_0YQ9Lfa0rQJvDVCGDAVucDBWvWOg`)
**Status:** Production — has real users
**Scope:** 5 `public` tables — `rooms`, `events`, `teams`, `team_members`, `agents`

## Why

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is shipped in the browser bundle by Next.js
convention — that's what the public env-var prefix means. Without RLS,
anyone could open DevTools, copy that key, and hit PostgREST directly:

```bash
curl "https://ewenvftletxvtrsvtvyd.supabase.co/rest/v1/events?select=*" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

…and exfiltrate the entire chat-message history (`events`) or every user's
agent persona prompts and `system_prompts` (`agents`).

The app today never relies on PostgREST for these tables — all reads/writes
go through Drizzle on the Supavisor pooler (`POSTGRES_URL`, role
`postgres.<ref>`, which has `BYPASSRLS`). Authorization is enforced at the
API-route layer (`requireAuthUserId()` + `createdBy === uid` checks). The
Supabase JS client is used **only** for auth flows; a codebase grep confirms
the lone `.from()` call is `auth/callback/route.ts` reading
`allowed_emails` via the **service role**, not anon.

So RLS here is defense-in-depth: it closes the PostgREST side-door, doesn't
break any current code path, and protects against future contributors
accidentally exposing a table.

## What was applied

Applied via Supabase MCP `apply_migration`, name
`enable_rls_force_revoke_anon_authenticated`:

```sql
-- Enable RLS on the 5 ERROR-flagged tables
ALTER TABLE public.rooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents       ENABLE ROW LEVEL SECURITY;

-- FORCE RLS so even the table owner obeys policies
-- (BYPASSRLS roles like postgres.<ref> still bypass — that's how the app works)
ALTER TABLE public.rooms        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.events       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.teams        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.team_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agents       FORCE ROW LEVEL SECURITY;

-- Revoke direct grants from anon/authenticated.
-- ENABLE RLS without policies already denies everything, but explicit revokes
-- mean the surface is closed even if a future policy is added accidentally.
REVOKE ALL ON public.rooms        FROM anon, authenticated;
REVOKE ALL ON public.events       FROM anon, authenticated;
REVOKE ALL ON public.teams        FROM anon, authenticated;
REVOKE ALL ON public.team_members FROM anon, authenticated;
REVOKE ALL ON public.agents       FROM anon, authenticated;

-- Document allowed_emails intentional state (it was already RLS-on, no policies)
COMMENT ON TABLE public.allowed_emails IS
  'Signup gate. RLS enabled with NO policies = deny-all to anon + authenticated by design. Only service-role (auth/callback/route.ts) reads this. Linter INFO is a false positive.';
```

## Why granular per-row policies were rejected

The obvious "production" approach would be policies like:

```sql
CREATE POLICY "owner can read rooms" ON public.rooms
  FOR SELECT TO authenticated
  USING (created_by = auth.uid()::text);
```

Three reasons not to do this here:

1. **Type mismatch is a smell, not the blocker.** `created_by` is `text`
   (legacy localStorage UID compatibility), not `uuid`. The `::text` cast
   works, but the more important issue is below.
2. **Parallel auth path = weaker security.** The app's real authorization
   logic isn't `created_by = uid`. For multiple resources it's the union
   `is_template OR createdBy = uid OR member_of_team(...)`. A naive
   `created_by = auth.uid()::text` policy would either over-restrict
   (breaking templates) or have to re-implement the whole authorization
   model in SQL — duplicating the API-route logic in a place where it
   can drift silently.
3. **The app doesn't talk to PostgREST anyway.** Drizzle goes through the
   pooler with a `BYPASSRLS` role. Adding row policies wouldn't actually
   gate any production code path; it would only matter on the
   anon-key-via-PostgREST side, which we just closed entirely.

So the fix is: lock the front door (RLS + revoke), keep authorization in
the API layer where it already lives and is tested. If/when a feature
genuinely needs direct Supabase JS access from the browser for these
tables, build the policies *with* the actual authorization model, not a
weaker subset of it.

## Verification

Re-ran Supabase advisor immediately after migration:

| | Before | After |
|---|---|---|
| ERROR `rls_disabled_in_public` | 5 | 0 |
| INFO `rls_enabled_no_policy` | 1 (`allowed_emails`) | 7 (intentional — deny-all by design) |
| WARN `function_search_path_mutable` (`touch_updated_at`) | 1 | 1 (out of scope) |

The 7 INFO lints are expected — RLS-enabled-with-no-policies is the
deny-all design for these tables. The remaining WARN on
`touch_updated_at` search_path is unrelated and out of scope for this
migration.

## Reversal

Per table, if needed:

```sql
ALTER TABLE public.<t> DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.<t> NO FORCE ROW LEVEL SECURITY;
GRANT ALL ON public.<t> TO anon, authenticated;
```

Where `<t>` is one of `rooms`, `events`, `teams`, `team_members`, `agents`.
Reversal restores the pre-2026-04-28 state (RLS off, full anon/authenticated
grants) and would re-trigger the 5 ERROR-level advisor lints.

## Author note

Applied via Supabase MCP `apply_migration` on 2026-04-28 as part of a
portfolio-wide RLS hardening sweep. The SQL is recorded at
`packages/db/drizzle/manual/2026-04-28-rls-hardening.sql` outside the
numbered Drizzle sequence, since it was not generated or applied by
Drizzle and putting it in the numbered sequence would mislead
`drizzle-kit migrate` into thinking it was a tracked migration.
