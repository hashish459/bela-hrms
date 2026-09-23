CREATE TABLE "retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"dataset" text NOT NULL,
	"retention_days" integer,
	"is_automatic" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp,
	"last_purged" integer,
	"updated_by_label" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "retention_policies_org_dataset_key" UNIQUE("org_id","dataset")
);
--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;