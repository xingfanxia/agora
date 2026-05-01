-- ============================================================
-- Status column → pgEnum (closes Bug A class permanently)
-- ============================================================
--
-- Lift the rooms.status enumeration from a text+CHECK pair into a
-- first-class Postgres ENUM type, plumbed through Drizzle pgEnum so
-- TS gets a strict union and `tsc` rejects future invalid values at
-- compile time.
--
-- Why now: P2 added 'lobby' to TS code paths but missed the SQL CHECK
-- constraint at 0002:45. tsc was happy (column was plain text), every
-- insert failed at the DB boundary at runtime. Migration 0011 patched
-- the immediate symptom by adding 'lobby' to the CHECK; this migration
-- closes the underlying class — no future "added a value to TS, forgot
-- the SQL side" mismatch is possible because the enum IS the schema.
--
-- Existing rows: zero risk. Every value already conforms to one of the
-- five enum members (the now-redundant CHECK constraint guaranteed it),
-- so `USING status::room_status` casts cleanly.
--
-- Indexes touching this column:
--   - rooms_status_created_idx (non-partial btree on status, created_at):
--     auto-rebuilds during ALTER COLUMN. Lookups by enum value
--     continue to work.
--   - rooms_runtime_sweep_idx (partial WHERE status IN ('running','waiting'),
--     added in 0002): MUST be dropped before ALTER COLUMN. The predicate
--     compares status to text literals; once the column type changes,
--     Postgres can't find a `room_status = text` operator and the ALTER
--     fails with "operator does not exist". Drop, alter, recreate.
--     Lobby rooms still correctly excluded from the sweeper post-recreate.
--
-- Drop order: index → CHECK constraint → ALTER COLUMN → recreate index,
-- so neither index nor constraint is validated against an in-flux column.

DO $$ BEGIN
  CREATE TYPE room_status AS ENUM ('lobby', 'running', 'waiting', 'completed', 'error');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DROP INDEX IF EXISTS rooms_runtime_sweep_idx;
--> statement-breakpoint

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_status_check;
--> statement-breakpoint

ALTER TABLE rooms ALTER COLUMN status TYPE room_status USING status::room_status;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS rooms_runtime_sweep_idx
  ON rooms (updated_at)
  WHERE status IN ('running', 'waiting');
