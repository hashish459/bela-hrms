CREATE TYPE "public"."overtime_claim_status" AS ENUM('pending', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."overtime_day_kind" AS ENUM('working_day', 'weekly_off', 'public_holiday');--> statement-breakpoint
CREATE TABLE "overtime_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"date_bs" text NOT NULL,
	"day_kind" "overtime_day_kind" NOT NULL,
	"computed_minutes" integer NOT NULL,
	"claimed_minutes" integer NOT NULL,
	"approved_minutes" integer,
	"multiplier" numeric(4, 2) NOT NULL,
	"payable_minutes" integer,
	"reason" text NOT NULL,
	"status" "overtime_claim_status" DEFAULT 'pending' NOT NULL,
	"approver_employee_id" uuid,
	"decided_by_user_id" text,
	"decided_by_label" text,
	"decided_at" timestamp,
	"decision_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "overtime_claims_org_reference_key" UNIQUE("org_id","reference")
);
--> statement-breakpoint
CREATE TABLE "overtime_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"day_kind" "overtime_day_kind" NOT NULL,
	"multiplier" numeric(4, 2) NOT NULL,
	"min_minutes" integer DEFAULT 30 NOT NULL,
	"max_minutes" integer DEFAULT 240 NOT NULL,
	"updated_by_label" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "overtime_rules_org_kind_key" UNIQUE("org_id","day_kind")
);
--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_approver_employee_id_employees_id_fk" FOREIGN KEY ("approver_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overtime_rules" ADD CONSTRAINT "overtime_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "overtime_claims_live_key" ON "overtime_claims" USING btree ("employee_id","date") WHERE status in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "overtime_claims_org_status_idx" ON "overtime_claims" USING btree ("org_id","status","date");--> statement-breakpoint
CREATE INDEX "overtime_claims_approver_idx" ON "overtime_claims" USING btree ("approver_employee_id","status");--> statement-breakpoint
CREATE INDEX "overtime_claims_employee_idx" ON "overtime_claims" USING btree ("employee_id","date");