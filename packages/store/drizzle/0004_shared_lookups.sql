CREATE TABLE "shared_lookup_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lookup_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" jsonb NOT NULL,
	"reverted_to" integer,
	"author_id" uuid NOT NULL,
	"on_behalf_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_lookup_versions_lookup_version_key" UNIQUE("lookup_id","version")
);
--> statement-breakpoint
CREATE TABLE "shared_lookups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_lookups_namespace_name_key" UNIQUE("namespace_id","name")
);
--> statement-breakpoint
ALTER TABLE "shared_lookup_versions" ADD CONSTRAINT "shared_lookup_versions_lookup_id_shared_lookups_id_fk" FOREIGN KEY ("lookup_id") REFERENCES "public"."shared_lookups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_lookup_versions" ADD CONSTRAINT "shared_lookup_versions_author_id_principals_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_lookup_versions" ADD CONSTRAINT "shared_lookup_versions_on_behalf_of_id_principals_id_fk" FOREIGN KEY ("on_behalf_of_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_lookups" ADD CONSTRAINT "shared_lookups_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "public"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_lookups" ADD CONSTRAINT "shared_lookups_created_by_id_principals_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;