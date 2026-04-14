CREATE TABLE "events" (
	"room_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_room_id_seq_pk" PRIMARY KEY("room_id","seq")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode_id" text NOT NULL,
	"topic" text,
	"config" jsonb NOT NULL,
	"status" text NOT NULL,
	"current_phase" text,
	"current_round" integer DEFAULT 1 NOT NULL,
	"thinking_agent_id" text,
	"agents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"role_assignments" jsonb,
	"advanced_rules" jsonb,
	"game_state" jsonb,
	"total_cost" double precision DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_room_type_idx" ON "events" USING btree ("room_id","type");--> statement-breakpoint
CREATE INDEX "rooms_status_created_idx" ON "rooms" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "rooms_mode_id_idx" ON "rooms" USING btree ("mode_id");--> statement-breakpoint
CREATE INDEX "rooms_created_by_idx" ON "rooms" USING btree ("created_by");