CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."clearance_status" AS ENUM('pending', 'cleared', 'waived');--> statement-breakpoint
CREATE TYPE "public"."employee_movement_kind" AS ENUM('transfer', 'promotion', 'demotion', 'redesignation', 'salary_revision', 'supervisor_change');--> statement-breakpoint
CREATE TYPE "public"."employee_movement_status" AS ENUM('scheduled', 'applied', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."profile_change_status" AS ENUM('pending', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."profile_change_section" AS ENUM('contact', 'address', 'emergency', 'personal', 'bank', 'family', 'qualification', 'experience');--> statement-breakpoint
CREATE TYPE "public"."separation_kind" AS ENUM('resignation', 'termination', 'retirement', 'contract_end', 'death', 'absconding');--> statement-breakpoint
CREATE TYPE "public"."separation_status" AS ENUM('in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('pending', 'processed', 'not_applicable');--> statement-breakpoint
CREATE TABLE "employee_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"kind" "employee_movement_kind" NOT NULL,
	"status" "employee_movement_status" DEFAULT 'scheduled' NOT NULL,
	"effective_date" date NOT NULL,
	"from_branch_id" uuid,
	"from_department_id" uuid,
	"from_designation_id" uuid,
	"from_grade_id" uuid,
	"from_supervisor_id" uuid,
	"from_basic_salary" numeric(14, 2),
	"to_branch_id" uuid,
	"to_department_id" uuid,
	"to_designation_id" uuid,
	"to_grade_id" uuid,
	"to_supervisor_id" uuid,
	"to_basic_salary" numeric(14, 2),
	"reason" text,
	"letter_number" text,
	"created_by_user_id" text,
	"created_by_label" text,
	"applied_at" timestamp,
	"cancelled_at" timestamp,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_separations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"kind" "separation_kind" NOT NULL,
	"status" "separation_status" DEFAULT 'in_progress' NOT NULL,
	"notice_date" date NOT NULL,
	"last_working_date" date NOT NULL,
	"reason" text,
	"exit_interview" text,
	"eligible_for_rehire" boolean DEFAULT true NOT NULL,
	"settlement_status" "settlement_status" DEFAULT 'pending' NOT NULL,
	"settlement_note" text,
	"created_by_user_id" text,
	"created_by_label" text,
	"completed_at" timestamp,
	"completed_by_label" text,
	"cancelled_at" timestamp,
	"previous_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"section" "profile_change_section" NOT NULL,
	"action" text DEFAULT 'update' NOT NULL,
	"target_id" uuid,
	"proposed" jsonb NOT NULL,
	"current" jsonb,
	"note" text,
	"status" "profile_change_status" DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" text,
	"decided_by_label" text,
	"decided_at" timestamp,
	"decision_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "separation_clearances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"separation_id" uuid NOT NULL,
	"owner" text NOT NULL,
	"item" text NOT NULL,
	"status" "clearance_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"cleared_by_label" text,
	"cleared_at" timestamp,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_experience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"employer" text NOT NULL,
	"designation" text,
	"from_date" date,
	"to_date" date,
	"responsibilities" text,
	"reason_for_leaving" text,
	"reference_contact" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" text
);
--> statement-breakpoint
ALTER TABLE "branches" DROP CONSTRAINT "branches_org_code_key";--> statement-breakpoint
ALTER TABLE "departments" DROP CONSTRAINT "departments_org_code_key";--> statement-breakpoint
ALTER TABLE "designations" DROP CONSTRAINT "designations_org_code_key";--> statement-breakpoint
ALTER TABLE "employment_types" DROP CONSTRAINT "employment_types_org_code_key";--> statement-breakpoint
ALTER TABLE "grades" DROP CONSTRAINT "grades_org_code_key";--> statement-breakpoint
ALTER TABLE "org_units" DROP CONSTRAINT "org_units_org_kind_code_key";--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_org_code_key";--> statement-breakpoint
DROP INDEX "employees_org_status_idx";--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "designations" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "designations" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "employment_types" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "employment_types" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "org_units" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "org_units" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "employee_assignments" ADD COLUMN "movement_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "emergency_contact_relation" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "blood_group" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "religion" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "passport_number" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "notice_period_days" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "employee_family" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "employee_family" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "notices" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "employee_movements" ADD CONSTRAINT "employee_movements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_movements" ADD CONSTRAINT "employee_movements_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_movements" ADD CONSTRAINT "employee_movements_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_movements" ADD CONSTRAINT "employee_movements_from_department_id_departments_id_fk" FOREIGN KEY ("from_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_movements" ADD CONSTRAINT "employee_movements_from_designation_id_designations_id_fk" FOREIGN KEY ("from_designation_id") REFERENCES "public"."designations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_movements" ADD CONSTRAINT "employee_movements_from_grade_id_grades_id_fk" FOREIGN KEY ("from_grade_id") REFERENCES "public"."grades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_movements" ADD CONSTRAINT "employee_movements_from_supervisor_id_employees_id_fk" FOREIGN KEY ("from_supervisor_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_movements" ADD CONSTRAINT "employee_movements_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_movements" ADD CONSTRAINT "employee_movements_to_department_id_departments_id_fk" FOREIGN KEY ("to_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_movements" ADD CONSTRAINT "employee_movements_to_designation_id_designations_id_fk" FOREIGN KEY ("to_designation_id") REFERENCES "public"."designations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_movements" ADD CONSTRAINT "employee_movements_to_grade_id_grades_id_fk" FOREIGN KEY ("to_grade_id") REFERENCES "public"."grades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_movements" ADD CONSTRAINT "employee_movements_to_supervisor_id_employees_id_fk" FOREIGN KEY ("to_supervisor_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_separations" ADD CONSTRAINT "employee_separations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_separations" ADD CONSTRAINT "employee_separations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "separation_clearances" ADD CONSTRAINT "separation_clearances_separation_id_employee_separations_id_fk" FOREIGN KEY ("separation_id") REFERENCES "public"."employee_separations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_experience" ADD CONSTRAINT "employee_experience_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_experience" ADD CONSTRAINT "employee_experience_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_movements_ref_key" ON "employee_movements" USING btree ("org_id","reference");--> statement-breakpoint
CREATE INDEX "employee_movements_employee_idx" ON "employee_movements" USING btree ("employee_id","effective_date");--> statement-breakpoint
CREATE INDEX "employee_movements_due_idx" ON "employee_movements" USING btree ("org_id","effective_date") WHERE status = 'scheduled';--> statement-breakpoint
CREATE UNIQUE INDEX "employee_separations_ref_key" ON "employee_separations" USING btree ("org_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_separations_open_key" ON "employee_separations" USING btree ("employee_id") WHERE status = 'in_progress';--> statement-breakpoint
CREATE INDEX "employee_separations_org_idx" ON "employee_separations" USING btree ("org_id","status","last_working_date");--> statement-breakpoint
CREATE INDEX "profile_change_requests_queue_idx" ON "profile_change_requests" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "profile_change_requests_employee_idx" ON "profile_change_requests" USING btree ("employee_id","created_at");--> statement-breakpoint
CREATE INDEX "separation_clearances_case_idx" ON "separation_clearances" USING btree ("separation_id","sort_order");--> statement-breakpoint
CREATE INDEX "employee_experience_employee_idx" ON "employee_experience" USING btree ("employee_id","from_date");--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_accounts_employee_idx" ON "user_accounts" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_org_code_key" ON "branches" USING btree ("org_id","code") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_org_code_key" ON "departments" USING btree ("org_id","code") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "designations_org_code_key" ON "designations" USING btree ("org_id","code") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "employment_types_org_code_key" ON "employment_types" USING btree ("org_id","code") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "grades_org_code_key" ON "grades" USING btree ("org_id","code") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_org_kind_code_key" ON "org_units" USING btree ("org_id","kind","code") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "employee_assignments_org_idx" ON "employee_assignments" USING btree ("org_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_org_code_key" ON "employees" USING btree ("org_id","employee_code") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "employees_org_branch_idx" ON "employees" USING btree ("org_id","branch_id");--> statement-breakpoint
CREATE INDEX "employees_search_trgm_idx" ON "employees" USING gin ((coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || employee_code || ' ' || coalesce(work_email, '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "leave_requests_org_dates_idx" ON "leave_requests" USING btree ("org_id","from_date","to_date");--> statement-breakpoint
CREATE INDEX "leave_requests_type_idx" ON "leave_requests" USING btree ("leave_type_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_notification_idx" ON "notification_delivery" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "notification_user_unread_idx" ON "notification" USING btree ("user_id") WHERE read_at is null and archived_at is null;--> statement-breakpoint
CREATE INDEX "employees_org_status_idx" ON "employees" USING btree ("org_id","status") WHERE deleted_at is null;