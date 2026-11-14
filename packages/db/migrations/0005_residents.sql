CREATE TABLE "households" (
	"id" text PRIMARY KEY NOT NULL,
	"locale" text NOT NULL,
	"type" text NOT NULL,
	"region" text NOT NULL,
	"home_place_id" text,
	"home_unit" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relations" (
	"a" text NOT NULL,
	"b" text NOT NULL,
	"kind" text NOT NULL,
	"strength" real DEFAULT 0.5 NOT NULL,
	CONSTRAINT "relations_a_b_pk" PRIMARY KEY("a","b")
);
--> statement-breakpoint
CREATE TABLE "residents" (
	"persona_id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"role" text NOT NULL,
	"work_group" text NOT NULL,
	"workplace_id" text,
	"income_month" real DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"wallet" real DEFAULT 0 NOT NULL,
	"needs" jsonb,
	"life_event" text,
	"phone" text,
	"email" text,
	"skeleton" jsonb,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "world_events" (
	"id" text PRIMARY KEY NOT NULL,
	"place_id" text NOT NULL,
	"kind" text NOT NULL,
	"from_min" integer NOT NULL,
	"until_min" integer NOT NULL,
	"by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "world_context" jsonb;--> statement-breakpoint
CREATE INDEX "relations_b" ON "relations" USING btree ("b");--> statement-breakpoint
CREATE INDEX "residents_household" ON "residents" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "world_events_until" ON "world_events" USING btree ("until_min");