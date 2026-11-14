CREATE TABLE "persona_memory_trees" (
	"persona_id" text PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"leaves" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "persona_global_state" ADD COLUMN "belief_evidence" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "persona_global_state" ADD COLUMN "belief_changed_day" integer;