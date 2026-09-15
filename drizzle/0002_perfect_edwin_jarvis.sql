CREATE TYPE "public"."attendance_calc_type" AS ENUM('strict_hours', 'average_hours', 'day_wise');--> statement-breakpoint
CREATE TYPE "public"."head_type" AS ENUM('none', 'branch_head', 'department_head');--> statement-breakpoint
CREATE TYPE "public"."off_day_policy" AS ENUM('none', 'as_overtime', 'as_present', 'as_present_and_overtime');--> statement-breakpoint
CREATE TYPE "public"."org_unit_kind" AS ENUM('division', 'business_unit', 'sub_business_unit', 'functional_category', 'project', 'location');--> statement-breakpoint
CREATE TYPE "public"."remuneration_type" AS ENUM('regular', 'daily_wages', 'security_guard');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('pending', 'done', 'failed', 'dead');--> statement-breakpoint
CREATE TABLE "job_titles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"head_type" "head_type" DEFAULT 'none' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "job_titles_org_code_key" UNIQUE("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "level_grades" (
	"level_id" uuid NOT NULL,
	"grade_id" uuid NOT NULL,
	CONSTRAINT "level_grades_key" UNIQUE("level_id","grade_id")
);
--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "org_unit_kind" NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_nepali" text,
	"parent_id" uuid,
	"start_date" date,
	"end_date" date,
	"country" text,
	"state" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"remarks" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_units_org_kind_code_key" UNIQUE("org_id","kind","code")
);
--> statement-breakpoint
CREATE TABLE "position_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"level_order" integer NOT NULL,
	"max_service_months" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "position_levels_org_code_key" UNIQUE("org_id","code"),
	CONSTRAINT "position_levels_org_order_key" UNIQUE("org_id","level_order")
);
--> statement-breakpoint
CREATE TABLE "remuneration_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"remuneration_type" "remuneration_type" DEFAULT 'regular' NOT NULL,
	"attendance_calc_type" "attendance_calc_type" DEFAULT 'strict_hours' NOT NULL,
	"standard_salary_days" integer DEFAULT 30 NOT NULL,
	"off_day_policy" "off_day_policy" DEFAULT 'none' NOT NULL,
	"max_break_minutes" integer DEFAULT 60 NOT NULL,
	"daily_ot_limit_minutes" integer,
	"weekly_ot_limit_minutes" integer,
	"monthly_ot_limit_minutes" integer,
	"off_day_ot_limit_minutes" integer,
	"is_overtime_payable" boolean DEFAULT true NOT NULL,
	"is_attendance_exempt" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "remuneration_groups_org_code_key" UNIQUE("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "service_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "service_groups_org_code_key" UNIQUE("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"retirement_age" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "services_org_code_key" UNIQUE("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "holiday_group_branches" (
	"group_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	CONSTRAINT "holiday_group_branches_key" UNIQUE("group_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "holiday_group_employees" (
	"group_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	CONSTRAINT "holiday_group_employees_key" UNIQUE("group_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "holiday_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_nepali" text,
	"applies_to_gender" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "holiday_groups_org_code_key" UNIQUE("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "weekly_offs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid,
	"day_of_week" integer NOT NULL,
	"is_half_day" boolean DEFAULT false NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_offs_scope_key" UNIQUE("org_id","branch_id","day_of_week","effective_from")
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"module" text NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "event_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"completed_handlers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dedupe_key" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	CONSTRAINT "domain_events_dedupe_key" UNIQUE("org_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "module_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"module_id" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "module_states_org_module_key" UNIQUE("org_id","module_id")
);
--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN "holiday_group_id" uuid;--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN "is_half_day" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "division_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "business_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "functional_category_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "position_level_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "job_title_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "service_group_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "remuneration_group_id" uuid;--> statement-breakpoint
ALTER TABLE "job_titles" ADD CONSTRAINT "job_titles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_grades" ADD CONSTRAINT "level_grades_level_id_position_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."position_levels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_grades" ADD CONSTRAINT "level_grades_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_org_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_levels" ADD CONSTRAINT "position_levels_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remuneration_groups" ADD CONSTRAINT "remuneration_groups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_groups" ADD CONSTRAINT "service_groups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_groups" ADD CONSTRAINT "service_groups_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_groups" ADD CONSTRAINT "service_groups_parent_id_service_groups_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."service_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_group_branches" ADD CONSTRAINT "holiday_group_branches_group_id_holiday_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."holiday_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_group_branches" ADD CONSTRAINT "holiday_group_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_group_employees" ADD CONSTRAINT "holiday_group_employees_group_id_holiday_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."holiday_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_group_employees" ADD CONSTRAINT "holiday_group_employees_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_groups" ADD CONSTRAINT "holiday_groups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_offs" ADD CONSTRAINT "weekly_offs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_offs" ADD CONSTRAINT "weekly_offs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_states" ADD CONSTRAINT "module_states_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_units_org_kind_idx" ON "org_units" USING btree ("org_id","kind");--> statement-breakpoint
CREATE INDEX "org_units_parent_idx" ON "org_units" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "service_groups_service_idx" ON "service_groups" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "holiday_group_branches_branch_idx" ON "holiday_group_branches" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "holiday_group_employees_emp_idx" ON "holiday_group_employees" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "weekly_offs_org_idx" ON "weekly_offs" USING btree ("org_id","effective_from");--> statement-breakpoint
CREATE INDEX "domain_events_pending_idx" ON "domain_events" USING btree ("status","occurred_at");--> statement-breakpoint
CREATE INDEX "domain_events_org_name_idx" ON "domain_events" USING btree ("org_id","name");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_division_id_org_units_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_business_unit_id_org_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_functional_category_id_org_units_id_fk" FOREIGN KEY ("functional_category_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_project_id_org_units_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_location_id_org_units_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_level_id_position_levels_id_fk" FOREIGN KEY ("position_level_id") REFERENCES "public"."position_levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_job_title_id_job_titles_id_fk" FOREIGN KEY ("job_title_id") REFERENCES "public"."job_titles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_service_group_id_service_groups_id_fk" FOREIGN KEY ("service_group_id") REFERENCES "public"."service_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_remuneration_group_id_remuneration_groups_id_fk" FOREIGN KEY ("remuneration_group_id") REFERENCES "public"."remuneration_groups"("id") ON DELETE restrict ON UPDATE no action;