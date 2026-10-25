CREATE TABLE "case_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"definition_version_id" uuid NOT NULL,
	"binding" "case_binding" NOT NULL,
	"label" text,
	"started_by_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "case_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"case_id" uuid NOT NULL,
	"attachment_id" uuid,
	"item" text,
	"type" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_kind" "principal_kind" NOT NULL,
	"on_behalf_of_id" uuid,
	"on_behalf_of_kind" "principal_kind",
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_events_on_behalf_of_kind" CHECK (("case_events"."on_behalf_of_id" IS NULL) = ("case_events"."on_behalf_of_kind" IS NULL)
				AND "case_events"."on_behalf_of_kind" IS DISTINCT FROM 'agent'),
	CONSTRAINT "case_events_actor_on_behalf_of" CHECK (("case_events"."actor_kind" = 'user' AND "case_events"."on_behalf_of_id" IS NULL)
				OR ("case_events"."actor_kind" = 'agent' AND "case_events"."on_behalf_of_id" IS NOT NULL)
				OR "case_events"."actor_kind" = 'service')
);
--> statement-breakpoint
CREATE TABLE "case_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"fact" text NOT NULL,
	"value" jsonb NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"fact" text,
	"evidence" text,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases" DROP CONSTRAINT "cases_definition_version_id_definition_versions_id_fk";
--> statement-breakpoint
DROP INDEX "cases_definition_version_id_idx";--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "opened_by_id" uuid;--> statement-breakpoint
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_definition_version_id_definition_versions_id_fk" FOREIGN KEY ("definition_version_id") REFERENCES "public"."definition_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_started_by_id_principals_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Each existing case becomes a case with its one process attached, keeping its version and binding.
INSERT INTO "case_attachments" ("case_id", "definition_version_id", "binding", "created_at", "updated_at")
	SELECT "id", "definition_version_id", "binding", "created_at", "updated_at" FROM "cases";--> statement-breakpoint
ALTER TABLE "case_version_moves" ADD COLUMN "attachment_id" uuid;--> statement-breakpoint
UPDATE "case_version_moves" AS m SET "attachment_id" = a."id"
	FROM "case_attachments" AS a WHERE a."case_id" = m."case_id";--> statement-breakpoint
ALTER TABLE "case_version_moves" ALTER COLUMN "attachment_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_attachment_id_case_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."case_attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_actor_fk" FOREIGN KEY ("actor_id","actor_kind") REFERENCES "public"."principals"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_on_behalf_of_fk" FOREIGN KEY ("on_behalf_of_id","on_behalf_of_kind") REFERENCES "public"."principals"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_facts" ADD CONSTRAINT "case_facts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_facts" ADD CONSTRAINT "case_facts_event_id_case_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."case_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_files" ADD CONSTRAINT "case_files_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_files" ADD CONSTRAINT "case_files_event_id_case_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."case_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_attachments_case_id_idx" ON "case_attachments" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_attachments_definition_version_id_idx" ON "case_attachments" USING btree ("definition_version_id");--> statement-breakpoint
CREATE INDEX "case_events_case_seq_idx" ON "case_events" USING btree ("case_id","seq");--> statement-breakpoint
CREATE INDEX "case_facts_case_fact_idx" ON "case_facts" USING btree ("case_id","fact");--> statement-breakpoint
CREATE INDEX "case_files_case_id_idx" ON "case_files" USING btree ("case_id");--> statement-breakpoint
ALTER TABLE "case_version_moves" ADD CONSTRAINT "case_version_moves_attachment_id_case_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."case_attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_opened_by_id_principals_id_fk" FOREIGN KEY ("opened_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_namespace_id_idx" ON "cases" USING btree ("namespace_id");--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN "definition_version_id";--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN "binding";