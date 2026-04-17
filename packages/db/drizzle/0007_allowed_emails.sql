-- ============================================================
-- Phase 4.5d — allowed_emails signup gate
-- ============================================================
--
-- Magic-link signup accepts any email; the callback verifies the
-- email is in this table before granting the session. Writes are
-- service-role only (RLS: no public SELECT/INSERT/UPDATE/DELETE).
--
-- Idempotent via IF NOT EXISTS. Seed the owner's email after apply.

CREATE TABLE IF NOT EXISTS "allowed_emails" (
	"email" text PRIMARY KEY,
	"invited_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "allowed_emails" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- No policies = no access for anon/authenticated roles. Service role
-- bypasses RLS automatically. This is intentional: only server-side
-- code holding the service key should read or write this table.
