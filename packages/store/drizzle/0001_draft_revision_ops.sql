ALTER TABLE "draft_revisions" ADD COLUMN "ops" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD COLUMN "reverted_to" integer;