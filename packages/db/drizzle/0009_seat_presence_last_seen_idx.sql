-- ============================================================
-- Phase 4.5d-1 — seat_presence(last_seen_at) index
-- ============================================================
--
-- Surfaced in the 4.5d-1 code review: a janitor sweep needs to
-- delete rows older than N days (`WHERE last_seen_at < now() -
-- interval '7 days'`); without an index that becomes a full
-- table scan as the room fleet grows. Cheap to add now —
-- additive, no data backfill.

CREATE INDEX IF NOT EXISTS "seat_presence_last_seen_idx"
  ON "seat_presence" ("last_seen_at");
