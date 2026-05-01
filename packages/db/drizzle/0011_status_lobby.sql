-- ============================================================
-- P2 lobby gate — extend rooms_status_check to allow 'lobby'
-- ============================================================
--
-- P2 introduces a `lobby` lifecycle state. Rooms with at least one
-- human seat are inserted at status='lobby' and parked until every
-- human flips ready (or the owner force-starts), at which point
-- flipLobbyToRunning compare-and-swaps to status='running' and the
-- WDK workflow starts.
--
-- The CHECK constraint added in 0002_runtime_polish only enumerated
-- ('running', 'waiting', 'completed', 'error') -- so every lobby
-- insert was rejected at the DB boundary even though the TS column
-- type accepted it (the column is plain text() with a doc comment).
--
-- Drop-and-readd is safe: 'lobby' rows can't exist yet (the
-- constraint blocked them all), so no backfill is required.
--
-- Indexes that filter on status are intentionally NOT changed:
--   - rooms_runtime_sweep_idx (WHERE status IN ('running','waiting')):
--     lobby rooms must NOT be picked up by the auto-tick sweeper.
--     They're parked waiting for human input; only the ready-flip
--     or force-start endpoint can wake them.
--   - rooms_status_created_idx (status, created_at): non-partial,
--     works across all status values.

ALTER TABLE rooms
  DROP CONSTRAINT IF EXISTS rooms_status_check;
--> statement-breakpoint

ALTER TABLE rooms
  ADD CONSTRAINT rooms_status_check
  CHECK (status IN ('running', 'waiting', 'completed', 'error', 'lobby'));
