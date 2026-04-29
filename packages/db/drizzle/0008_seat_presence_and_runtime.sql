-- ============================================================
-- Phase 4.5d-1 — seat_presence + rooms.runtime
-- ============================================================
--
-- `seat_presence` is the Postgres-backed liveness signal for human
-- seats. Updated on each client heartbeat (debounced ~5s). Read from
-- WDK step bodies in 4.5d-2 to decide vote-fallback-vs-wait without
-- introducing a Realtime side effect into the durable workflow path.
--
-- `rooms.runtime` is the per-room runtime flag introduced for the
-- 4.5d-2 WDK migration. Defaults to 'http_chain' so existing and
-- newly-created rooms continue on the legacy path until WDK ships;
-- the room-creation API will explicitly set 'wdk' once the substrate
-- is validated.
--
-- Both changes are additive. No data backfill required.
-- Idempotent via IF NOT EXISTS / catch-on-existing-constraint.

CREATE TABLE IF NOT EXISTS "seat_presence" (
	"room_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("room_id", "agent_id")
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "seat_presence" ADD CONSTRAINT "seat_presence_room_id_rooms_id_fk"
   FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "runtime" text DEFAULT 'http_chain' NOT NULL;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "rooms" ADD CONSTRAINT "rooms_runtime_check"
   CHECK ("runtime" IN ('http_chain', 'wdk'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
