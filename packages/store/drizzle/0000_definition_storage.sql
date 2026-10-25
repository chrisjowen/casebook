CREATE TYPE "public"."definition_version_status" AS ENUM('published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."principal_kind" AS ENUM('user', 'group', 'agent', 'service');--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"definition_version_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_id_namespace_key" UNIQUE("id","namespace_id")
);
--> statement-breakpoint
CREATE TABLE "definition_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "definition_version_status" DEFAULT 'published' NOT NULL,
	"body" jsonb NOT NULL,
	"schema_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"author_id" uuid NOT NULL,
	"published_by_id" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "definition_versions_definition_version_key" UNIQUE("definition_id","version"),
	CONSTRAINT "definition_versions_version_positive" CHECK ("definition_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "delegation_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delegator_id" uuid NOT NULL,
	"delegator_kind" "principal_kind" DEFAULT 'user' NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_kind" "principal_kind" DEFAULT 'agent' NOT NULL,
	"namespace_id" uuid,
	"case_id" uuid,
	"role" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delegation_grants_delegator_kind_user" CHECK ("delegation_grants"."delegator_kind" = 'user'),
	CONSTRAINT "delegation_grants_agent_kind_agent" CHECK ("delegation_grants"."agent_kind" = 'agent'),
	CONSTRAINT "delegation_grants_case_has_namespace" CHECK ("delegation_grants"."case_id" IS NULL OR "delegation_grants"."namespace_id" IS NOT NULL),
	CONSTRAINT "delegation_grants_role_not_blank" CHECK ("delegation_grants"."role" IS NULL OR btrim("delegation_grants"."role") <> ''),
	CONSTRAINT "delegation_grants_expires_after_created" CHECK ("delegation_grants"."expires_at" > "delegation_grants"."created_at")
);
--> statement-breakpoint
CREATE TABLE "draft_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"body" jsonb NOT NULL,
	"author_id" uuid NOT NULL,
	"author_kind" "principal_kind" NOT NULL,
	"on_behalf_of_id" uuid,
	"on_behalf_of_kind" "principal_kind",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_revisions_definition_revision_key" UNIQUE("definition_id","revision"),
	CONSTRAINT "draft_revisions_revision_positive" CHECK ("draft_revisions"."revision" > 0),
	CONSTRAINT "draft_revisions_on_behalf_of_kind" CHECK (("draft_revisions"."on_behalf_of_id" IS NULL) = ("draft_revisions"."on_behalf_of_kind" IS NULL)
				AND "draft_revisions"."on_behalf_of_kind" IS DISTINCT FROM 'agent'),
	CONSTRAINT "draft_revisions_author_on_behalf_of" CHECK (("draft_revisions"."author_kind" = 'user' AND "draft_revisions"."on_behalf_of_id" IS NULL)
				OR ("draft_revisions"."author_kind" IN ('agent', 'service') AND "draft_revisions"."on_behalf_of_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"group_kind" "principal_kind" DEFAULT 'group' NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_member_id_pk" PRIMARY KEY("group_id","member_id"),
	CONSTRAINT "group_members_group_kind_group" CHECK ("group_members"."group_kind" = 'group'),
	CONSTRAINT "group_members_not_self" CHECK ("group_members"."group_id" <> "group_members"."member_id")
);
--> statement-breakpoint
CREATE TABLE "namespaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "namespaces_path_format" CHECK ("namespaces"."path" ~ '^[^/[:space:]]+(/[^/[:space:]]+)*$')
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "principal_kind" NOT NULL,
	"display_name" text NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"owner_id" uuid,
	"owner_kind" "principal_kind" DEFAULT 'service' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "principals_issuer_subject_key" UNIQUE("issuer","subject"),
	CONSTRAINT "principals_id_kind_key" UNIQUE("id","kind"),
	CONSTRAINT "principals_owner_kind_service" CHECK ("principals"."owner_kind" = 'service'),
	CONSTRAINT "principals_owner_agent_only" CHECK ("principals"."owner_id" IS NULL OR "principals"."kind" = 'agent')
);
--> statement-breakpoint
CREATE TABLE "process_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "process_definitions_namespace_slug_key" UNIQUE("namespace_id","slug"),
	CONSTRAINT "process_definitions_slug_format" CHECK ("process_definitions"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "role_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"role" text NOT NULL,
	"namespace_id" uuid NOT NULL,
	"case_id" uuid,
	"scope_type" text GENERATED ALWAYS AS (CASE WHEN case_id IS NULL THEN 'namespace' ELSE 'case' END) STORED NOT NULL,
	"scope_id" uuid GENERATED ALWAYS AS (COALESCE(case_id, namespace_id)) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_bindings_role_not_blank" CHECK (btrim("role_bindings"."role") <> '')
);
--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_definition_version_id_definition_versions_id_fk" FOREIGN KEY ("definition_version_id") REFERENCES "public"."definition_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definition_versions" ADD CONSTRAINT "definition_versions_definition_id_process_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."process_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definition_versions" ADD CONSTRAINT "definition_versions_author_id_principals_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definition_versions" ADD CONSTRAINT "definition_versions_published_by_id_principals_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_grants" ADD CONSTRAINT "delegation_grants_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_grants" ADD CONSTRAINT "delegation_grants_delegator_fk" FOREIGN KEY ("delegator_id","delegator_kind") REFERENCES "public"."principals"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_grants" ADD CONSTRAINT "delegation_grants_agent_fk" FOREIGN KEY ("agent_id","agent_kind") REFERENCES "public"."principals"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delegation_grants" ADD CONSTRAINT "delegation_grants_case_fk" FOREIGN KEY ("case_id","namespace_id") REFERENCES "public"."cases"("id","namespace_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD CONSTRAINT "draft_revisions_definition_id_process_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."process_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD CONSTRAINT "draft_revisions_author_fk" FOREIGN KEY ("author_id","author_kind") REFERENCES "public"."principals"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD CONSTRAINT "draft_revisions_on_behalf_of_fk" FOREIGN KEY ("on_behalf_of_id","on_behalf_of_kind") REFERENCES "public"."principals"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_member_id_principals_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_fk" FOREIGN KEY ("group_id","group_kind") REFERENCES "public"."principals"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespaces" ADD CONSTRAINT "namespaces_parent_id_namespaces_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_owner_fk" FOREIGN KEY ("owner_id","owner_kind") REFERENCES "public"."principals"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_definitions" ADD CONSTRAINT "process_definitions_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_definitions" ADD CONSTRAINT "process_definitions_owner_id_principals_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_bindings" ADD CONSTRAINT "role_bindings_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_bindings" ADD CONSTRAINT "role_bindings_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_bindings" ADD CONSTRAINT "role_bindings_case_fk" FOREIGN KEY ("case_id","namespace_id") REFERENCES "public"."cases"("id","namespace_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "delegation_grants_agent_active_idx" ON "delegation_grants" USING btree ("agent_id") WHERE "delegation_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "delegation_grants_delegator_id_idx" ON "delegation_grants" USING btree ("delegator_id");--> statement-breakpoint
CREATE INDEX "group_members_member_id_idx" ON "group_members" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "namespaces_path_key" ON "namespaces" USING btree ("path");--> statement-breakpoint
CREATE INDEX "namespaces_parent_id_idx" ON "namespaces" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_bindings_tuple_key" ON "role_bindings" USING btree ("principal_id","role","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "role_bindings_case_role_idx" ON "role_bindings" USING btree ("case_id","role") WHERE "role_bindings"."case_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "role_bindings_namespace_role_idx" ON "role_bindings" USING btree ("namespace_id","role") WHERE "role_bindings"."case_id" IS NULL;--> statement-breakpoint
CREATE INDEX "role_bindings_principal_id_idx" ON "role_bindings" USING btree ("principal_id");