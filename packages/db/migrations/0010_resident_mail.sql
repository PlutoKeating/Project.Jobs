CREATE TABLE "mail_routes" (
	"address" text PRIMARY KEY NOT NULL,
	"persona_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "html" text;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "raw_ev" text;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "extracted" jsonb;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "mail_routes_persona" ON "mail_routes" USING btree ("persona_id");--> statement-breakpoint
CREATE INDEX "mailbox_session" ON "mailbox" USING btree ("session_id");