CREATE TABLE "app_verdicts" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"lang" text NOT NULL,
	"basis" text NOT NULL,
	"verdict" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_agendas" (
	"persona_id" text NOT NULL,
	"sim_date" text NOT NULL,
	"home_place_id" text NOT NULL,
	"home_unit" integer NOT NULL,
	"role" text NOT NULL,
	"items" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persona_agendas_persona_id_sim_date_pk" PRIMARY KEY("persona_id","sim_date")
);
--> statement-breakpoint
CREATE TABLE "persona_avatars" (
	"persona_id" text PRIMARY KEY NOT NULL,
	"storage_ref" text NOT NULL,
	"mime" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "verdict_app" ON "app_verdicts" USING btree ("app_id");