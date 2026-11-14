CREATE TABLE "exposures" (
	"id" text PRIMARY KEY NOT NULL,
	"launch_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"channel" text NOT NULL,
	"source_persona_id" text,
	"world_min" integer NOT NULL,
	"place_id" text,
	"reaction" text NOT NULL,
	"thought" text,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intentions" (
	"id" text PRIMARY KEY NOT NULL,
	"launch_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"strength" real DEFAULT 0.5 NOT NULL,
	"created_min" integer NOT NULL,
	"done" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "launch_reports" (
	"launch_id" text NOT NULL,
	"lang" text NOT NULL,
	"basis" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "launch_reports_launch_id_lang_pk" PRIMARY KEY("launch_id","lang")
);
--> statement-breakpoint
CREATE TABLE "launches" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"app_version_id" text NOT NULL,
	"study_id" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"landing_url" text,
	"form" text DEFAULT 'web' NOT NULL,
	"icon_ev" text,
	"shot_evs" jsonb DEFAULT '[]'::jsonb,
	"ad_text" text,
	"intensity" real DEFAULT 0.3 NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'live' NOT NULL,
	"published_min" integer NOT NULL,
	"spend_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text,
	"kind" text NOT NULL,
	"address" text NOT NULL,
	"sender" text,
	"subject" text,
	"body" text NOT NULL,
	"seen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"launch_id" text,
	"session_id" text,
	"body" text NOT NULL,
	"sentiment" real DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"reply_to" text,
	"world_min" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"launch_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"session_id" text,
	"rating" integer NOT NULL,
	"body" text NOT NULL,
	"world_min" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "exposures_launch" ON "exposures" USING btree ("launch_id");--> statement-breakpoint
CREATE INDEX "exposures_persona" ON "exposures" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "intentions_launch" ON "intentions" USING btree ("launch_id");--> statement-breakpoint
CREATE INDEX "launches_app" ON "launches" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "mailbox_persona" ON "mailbox" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "mailbox_address" ON "mailbox" USING btree ("address");--> statement-breakpoint
CREATE INDEX "posts_launch" ON "posts" USING btree ("launch_id");--> statement-breakpoint
CREATE INDEX "posts_time" ON "posts" USING btree ("world_min");--> statement-breakpoint
CREATE INDEX "reviews_launch" ON "store_reviews" USING btree ("launch_id");