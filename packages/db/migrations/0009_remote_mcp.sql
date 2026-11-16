CREATE TABLE "launch_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"launch_id" text NOT NULL,
	"n" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"info" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"hash" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"client_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"role" text NOT NULL,
	"fp" text NOT NULL,
	"resource" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "launch_versions_n" ON "launch_versions" USING btree ("launch_id","n");--> statement-breakpoint
CREATE INDEX "oauth_tokens_grant" ON "oauth_tokens" USING btree ("grant_id");