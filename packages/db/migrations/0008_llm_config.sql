CREATE TABLE "llm_config_versions" (
	"version" integer PRIMARY KEY NOT NULL,
	"parent" integer,
	"content" jsonb NOT NULL,
	"digest" text NOT NULL,
	"submit_id" text,
	"author" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_config_versions_submit_id_unique" UNIQUE("submit_id")
);
--> statement-breakpoint
CREATE TABLE "llm_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"health" jsonb,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"hint" text NOT NULL,
	"cipher" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "llm_tests" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"target_id" text NOT NULL,
	"credential_id" text,
	"cred" text,
	"capability" text NOT NULL,
	"ok" boolean NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error_class" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "llm_traces" ADD COLUMN "config_version" integer;--> statement-breakpoint
ALTER TABLE "llm_traces" ADD COLUMN "target" text;--> statement-breakpoint
ALTER TABLE "llm_traces" ADD COLUMN "cred" text;--> statement-breakpoint
ALTER TABLE "llm_traces" ADD COLUMN "attempt" integer;--> statement-breakpoint
ALTER TABLE "llm_traces" ADD COLUMN "error_class" text;--> statement-breakpoint
CREATE INDEX "llm_tests_target" ON "llm_tests" USING btree ("target_id");