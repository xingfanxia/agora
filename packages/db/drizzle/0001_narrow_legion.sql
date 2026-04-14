ALTER TABLE "rooms" ADD COLUMN "waiting_for" jsonb;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "waiting_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;