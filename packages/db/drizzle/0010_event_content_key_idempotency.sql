-- ============================================================
-- Phase 4.5d-2.6 — content-key idempotency for events
-- ============================================================
--
-- WDK retries triggered by `step_completed` event-delivery failure
-- re-execute a step body that ALREADY committed its DB writes. The
-- existing PK on (room_id, seq) catches the case where the retry
-- recomputes the SAME seq (concurrent-tick collision) but does NOT
-- catch the case where the retry recomputes a NEW seq (because the
-- prior attempt's append succeeded and bumped the count). That's
-- the delivery-failure-after-success hazard.
--
-- These partial UNIQUE indexes dedupe at the CONTENT level: a
-- duplicate write at any seq is a no-op via ON CONFLICT DO NOTHING
-- (untargeted -- catches conflicts from any unique constraint).
-- Combined with the deterministic message-id pattern shipped in
-- 4.5d-2.5 (`rt-${roomId}-t${turnIdx}-${agentId}`), retries produce
-- the same content key and silently no-op.
--
-- Partial WHERE clauses keep evaluation cost bounded -- only
-- message:created and token:recorded rows pay the JSONB extraction.
-- Other event types (room:started/ended, agent:thinking, etc.) are
-- unaffected.
--
-- Schema is additive. No data backfill: existing rows have unique
-- random UUIDs (legacy AIAgent) or unique deterministic ids (4.5d-2.5
-- onward), so the indexes apply cleanly.
--
-- Defense-in-depth pre-check: refuse to apply if pre-existing data
-- already violates the uniqueness constraint. The 4.5d-2.5 -> 4.5d-2.6
-- window (minutes) wasn't long enough for retry-induced duplicates
-- in practice, but verify before touching the index DDL.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM events
    WHERE type = 'message:created'
    GROUP BY room_id, (payload->'message'->>'id')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'pre-existing duplicate (room_id, message.id) tuples in events; '
      'cannot apply 0010 -- run a cleanup query to dedupe first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM events
    WHERE type = 'token:recorded'
    GROUP BY room_id, (payload->>'messageId')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'pre-existing duplicate (room_id, token.messageId) tuples in events; '
      'cannot apply 0010 -- run a cleanup query to dedupe first';
  END IF;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "events_message_id_uq"
  ON "events" (
    "room_id",
    ((payload->'message'->>'id'))
  )
  WHERE "type" = 'message:created';
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "events_token_message_id_uq"
  ON "events" (
    "room_id",
    ((payload->>'messageId'))
  )
  WHERE "type" = 'token:recorded';
