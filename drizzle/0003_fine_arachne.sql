CREATE TYPE "public"."leave_allocation_rule" AS ENUM('advance', 'negative', 'matured_only', 'no_tracking');--> statement-breakpoint
CREATE TYPE "public"."leave_apply_window" AS ENUM('pre', 'post', 'any');--> statement-breakpoint
CREATE TYPE "public"."lapse_type" AS ENUM('none', 'monthly', 'yearly', 'service_period');--> statement-breakpoint
CREATE TYPE "public"."leave_nature" AS ENUM('official_work', 'paid', 'unpaid', 'absent', 'substitute', 'holiday', 'transit');--> statement-breakpoint
CREATE TYPE "public"."leave_qualify_from" AS ENUM('date_of_join', 'date_of_permanent', 'contract_start', 'probation_start');--> statement-breakpoint
CREATE TYPE "public"."substitute_status" AS ENUM('pending', 'approved', 'rejected', 'consumed', 'expired');--> statement-breakpoint
CREATE TABLE "leave_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_nepali" text,
	"remarks" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "leave_groups_org_code_key" UNIQUE("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "leave_maturity_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"affected_leave_type_id" uuid NOT NULL,
	"effect_percent" numeric(5, 2) DEFAULT '100' NOT NULL,
	CONSTRAINT "leave_maturity_effects_key" UNIQUE("leave_type_id","affected_leave_type_id")
);
--> statement-breakpoint
CREATE TABLE "leave_salary_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"salary_head_code" text NOT NULL,
	"pay_percent" numeric(5, 2) DEFAULT '100' NOT NULL,
	CONSTRAINT "leave_salary_effects_key" UNIQUE("leave_type_id","salary_head_code")
);
--> statement-breakpoint
CREATE TABLE "leave_type_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"employment_type_id" uuid NOT NULL,
	"days_allowed" numeric(6, 2) DEFAULT '0' NOT NULL,
	"max_accumulation_days" numeric(6, 2),
	CONSTRAINT "leave_type_entitlements_key" UNIQUE("leave_type_id","employment_type_id")
);
--> statement-breakpoint
CREATE TABLE "substitute_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"worked_date" text NOT NULL,
	"worked_date_bs" text NOT NULL,
	"claim_days" numeric(4, 2) DEFAULT '1' NOT NULL,
	"remarks" text,
	"status" "substitute_status" DEFAULT 'pending' NOT NULL,
	"expires_on" text,
	"consumed_by_request_id" uuid,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp,
	CONSTRAINT "substitute_credits_reference_key" UNIQUE("org_id","reference"),
	CONSTRAINT "substitute_credits_employee_date_key" UNIQUE("employee_id","worked_date")
);
--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "nature" "leave_nature" DEFAULT 'paid' NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "paid_percent" numeric(5, 2) DEFAULT '100' NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "lapse_type" "lapse_type" DEFAULT 'yearly' NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "leave_group_id" uuid;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "allocation_rule" "leave_allocation_rule" DEFAULT 'advance' NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "apply_window" "leave_apply_window" DEFAULT 'any' NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "qualify_from" "leave_qualify_from" DEFAULT 'date_of_join' NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "leave_order" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "marital_status" text;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "times_allowed_in_service" integer;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "min_days_to_qualify" integer;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "max_days_to_apply" integer;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "max_accumulation_days" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "is_encashable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "min_days_to_encash" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "max_days_to_encash" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "is_excess_deducted_from_pay" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "is_deducted_from_service_time" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "excludes_holidays" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "excludes_weekly_offs" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "is_allocated_in_full" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "notifies_hr" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "level1_limit_days" integer;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "level2_limit_days" integer;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "level3_limit_days" integer;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "level4_limit_days" integer;--> statement-breakpoint
ALTER TABLE "leave_groups" ADD CONSTRAINT "leave_groups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_maturity_effects" ADD CONSTRAINT "leave_maturity_effects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_maturity_effects" ADD CONSTRAINT "leave_maturity_effects_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_maturity_effects" ADD CONSTRAINT "leave_maturity_effects_affected_leave_type_id_leave_types_id_fk" FOREIGN KEY ("affected_leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_salary_effects" ADD CONSTRAINT "leave_salary_effects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_salary_effects" ADD CONSTRAINT "leave_salary_effects_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_type_entitlements" ADD CONSTRAINT "leave_type_entitlements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_type_entitlements" ADD CONSTRAINT "leave_type_entitlements_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_type_entitlements" ADD CONSTRAINT "leave_type_entitlements_employment_type_id_employment_types_id_fk" FOREIGN KEY ("employment_type_id") REFERENCES "public"."employment_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_credits" ADD CONSTRAINT "substitute_credits_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_credits" ADD CONSTRAINT "substitute_credits_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "substitute_credits" ADD CONSTRAINT "substitute_credits_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_maturity_effects_org_idx" ON "leave_maturity_effects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "leave_salary_effects_org_idx" ON "leave_salary_effects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "leave_type_entitlements_org_idx" ON "leave_type_entitlements" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "substitute_credits_status_idx" ON "substitute_credits" USING btree ("org_id","status");