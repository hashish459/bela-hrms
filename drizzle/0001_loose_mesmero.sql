CREATE TABLE "period_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"module" text NOT NULL,
	"bs_month" integer,
	"locked_by" text,
	"locked_at" timestamp DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "period_locks_unique" UNIQUE("org_id","fiscal_year_id","module","bs_month")
);
--> statement-breakpoint
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "period_locks_org_idx" ON "period_locks" USING btree ("org_id","fiscal_year_id");--> statement-breakpoint
-- Exactly one current fiscal year per organisation.
--
-- Every figure in the product is scoped to a fiscal year, and the app resolves
-- "the current one" on every request. Two rows flagged current would make that
-- resolution non-deterministic — the same query returning a different year
-- depending on plan order. A partial unique index makes it impossible in the
-- database rather than only in the code that writes it.
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_years_one_current_per_org"
  ON "fiscal_years" ("org_id") WHERE "is_current";
