ALTER TABLE "sessions" ALTER COLUMN "executor" SET DEFAULT 'midscene';--> statement-breakpoint
ALTER TABLE "issue_candidates" ADD COLUMN "track" text DEFAULT 'experience' NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "track" text DEFAULT 'experience' NOT NULL;--> statement-breakpoint
UPDATE "issue_candidates" SET "track" = 'engineering' WHERE "source" IN ('axe', 'judge', 'ai_quality', 'policy') OR ("source" = 'uap_error' AND COALESCE("error_code", '') <> 'PRODUCT_SMALL_TARGET');--> statement-breakpoint
UPDATE "issues" i SET "track" = 'engineering' WHERE EXISTS (SELECT 1 FROM "issue_candidates" c WHERE c."issue_id" = i."id") AND NOT EXISTS (SELECT 1 FROM "issue_candidates" c WHERE c."issue_id" = i."id" AND c."track" = 'experience');
