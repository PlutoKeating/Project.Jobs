CREATE TABLE "agent_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb NOT NULL,
	"actor" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" text,
	"message_ref" text,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"title" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"mode" jsonb,
	"tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feishu_targets" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"boards" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pending" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_digest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feishu_users" (
	"open_id" text PRIMARY KEY NOT NULL,
	"name" text,
	"tenant_key" text,
	"role" text NOT NULL,
	"via" text NOT NULL,
	"fp" text,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "issue_links" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text NOT NULL,
	"launch_id" text NOT NULL,
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"url" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"verified_version" integer,
	"verify_sessions" jsonb,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "launch_github" (
	"launch_id" text PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"token" text NOT NULL,
	"auto_verify" boolean DEFAULT true NOT NULL,
	"invite_n" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signed_links" (
	"hash" text PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_actions_session" ON "agent_actions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "issue_links_issue" ON "issue_links" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "issue_links_launch" ON "issue_links" USING btree ("launch_id");