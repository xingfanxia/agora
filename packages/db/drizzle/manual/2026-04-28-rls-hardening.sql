-- ============================================================
-- RLS Hardening — 2026-04-28
-- ============================================================
--
-- APPLIED OUT-OF-BAND via Supabase MCP `apply_migration`
-- (name: enable_rls_force_revoke_anon_authenticated).
--
-- This file is NOT part of the numbered Drizzle migration sequence
-- (drizzle/0000_*.sql … drizzle/0009_*.sql) and is NOT tracked in
-- drizzle/meta/_journal.json. It lives under drizzle/manual/ as a
-- record of the change for future maintainers; do not feed it to
-- drizzle-kit migrate.
--
-- See docs/security/2026-04-28-rls-hardening.md for full context:
-- threat model, why granular policies were rejected, advisor
-- before/after, and reversal SQL.
--
-- Project: ewenvftletxvtrsvtvyd (agora-db, production)
-- Tables : rooms, events, teams, team_members, agents
-- ============================================================

-- Enable RLS on the 5 ERROR-flagged tables.
ALTER TABLE public.rooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents       ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- FORCE RLS so even the table owner obeys policies.
-- BYPASSRLS roles (postgres.<ref> on the Supavisor pooler, used by
-- Drizzle via POSTGRES_URL) still bypass — that's how the app works.
ALTER TABLE public.rooms        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.events       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.teams        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.team_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agents       FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Revoke direct grants from anon/authenticated. ENABLE RLS without
-- policies already denies everything; explicit revokes keep the
-- surface closed even if a future policy is added by mistake.
REVOKE ALL ON public.rooms        FROM anon, authenticated;
REVOKE ALL ON public.events       FROM anon, authenticated;
REVOKE ALL ON public.teams        FROM anon, authenticated;
REVOKE ALL ON public.team_members FROM anon, authenticated;
REVOKE ALL ON public.agents       FROM anon, authenticated;
--> statement-breakpoint

-- Document the intentional deny-all state of allowed_emails so future
-- linter sweeps treat the rls_enabled_no_policy INFO as a false positive.
COMMENT ON TABLE public.allowed_emails IS
  'Signup gate. RLS enabled with NO policies = deny-all to anon + authenticated by design. Only service-role (auth/callback/route.ts) reads this. Linter INFO is a false positive.';
