-- ============================================================
-- Phase 4.5a — Runtime state polish
-- ============================================================
-- 1. Auto-maintain rooms.updated_at via trigger so the tick-all
--    sweeper can reliably detect stuck rooms by "no recent activity".
-- 2. Partial index for the sweeper query:
--      SELECT id FROM rooms
--       WHERE status IN ('running','waiting')
--         AND updated_at < now() - interval '10 seconds'
-- 3. CHECK constraint enumerating valid statuses so bad writers are
--    rejected at the DB boundary, not just in TS.

-- Trigger function: generic, works for any table with `updated_at`.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS rooms_touch_updated_at ON rooms;
--> statement-breakpoint

CREATE TRIGGER rooms_touch_updated_at
BEFORE UPDATE ON rooms
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();
--> statement-breakpoint

-- Sweeper index: only rows that may need resuming are indexed.
CREATE INDEX IF NOT EXISTS rooms_runtime_sweep_idx
  ON rooms (updated_at)
  WHERE status IN ('running', 'waiting');
--> statement-breakpoint

-- Status CHECK constraint. `waiting` is added for Phase 4.5a.
ALTER TABLE rooms
  DROP CONSTRAINT IF EXISTS rooms_status_check;
--> statement-breakpoint

ALTER TABLE rooms
  ADD CONSTRAINT rooms_status_check
  CHECK (status IN ('running', 'waiting', 'completed', 'error'));
