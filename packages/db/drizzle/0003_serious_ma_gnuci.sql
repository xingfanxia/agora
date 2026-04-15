CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"persona" text NOT NULL,
	"system_prompt" text,
	"model_provider" text NOT NULL,
	"model_id" text NOT NULL,
	"style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"avatar_seed" text NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"team_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_agent_id_pk" PRIMARY KEY("team_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"description" text,
	"avatar_seed" text NOT NULL,
	"leader_agent_id" uuid,
	"default_mode_id" text,
	"is_template" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "mode_config" jsonb;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_leader_agent_id_agents_id_fk" FOREIGN KEY ("leader_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_created_by_idx" ON "agents" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "agents_template_idx" ON "agents" USING btree ("is_template");--> statement-breakpoint
CREATE INDEX "team_members_agent_idx" ON "team_members" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "teams_created_by_idx" ON "teams" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "teams_template_idx" ON "teams" USING btree ("is_template");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rooms_team_id_idx" ON "rooms" USING btree ("team_id");