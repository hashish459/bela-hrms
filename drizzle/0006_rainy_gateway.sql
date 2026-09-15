CREATE TYPE "public"."employee_document_kind" AS ENUM('contract', 'citizenship', 'passport', 'pan', 'certificate', 'appraisal', 'letter', 'other');--> statement-breakpoint
CREATE TYPE "public"."notice_audience" AS ENUM('everyone', 'branch', 'department');--> statement-breakpoint
CREATE TYPE "public"."notice_priority" AS ENUM('normal', 'important', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."qualification_kind" AS ENUM('education', 'certification', 'training', 'skill', 'language');--> statement-breakpoint
CREATE TYPE "public"."relationship_kind" AS ENUM('spouse', 'son', 'daughter', 'father', 'mother', 'brother', 'sister', 'father_in_law', 'mother_in_law', 'guardian', 'other');--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "employee_document_kind" NOT NULL,
	"title" text NOT NULL,
	"file_url" text,
	"reference_number" text,
	"issued_on" date,
	"expires_on" date,
	"is_visible_to_employee" boolean DEFAULT true NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_family" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"relationship" "relationship_kind" NOT NULL,
	"date_of_birth" date,
	"occupation" text,
	"contact_number" text,
	"is_dependant" boolean DEFAULT false NOT NULL,
	"is_nominee" boolean DEFAULT false NOT NULL,
	"nominee_share_percent" integer,
	"is_emergency_contact" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "qualification_kind" NOT NULL,
	"title" text NOT NULL,
	"institution" text,
	"result" text,
	"completed_year" integer,
	"expires_on" date,
	"remarks" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notice_reads" (
	"notice_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notice_reads_key" UNIQUE("notice_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"priority" "notice_priority" DEFAULT 'normal' NOT NULL,
	"audience" "notice_audience" DEFAULT 'everyone' NOT NULL,
	"branch_id" uuid,
	"department_id" uuid,
	"publish_from" date NOT NULL,
	"publish_to" date,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"attachment_url" text,
	"posted_by" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_family" ADD CONSTRAINT "employee_family_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_family" ADD CONSTRAINT "employee_family_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_qualifications" ADD CONSTRAINT "employee_qualifications_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_notice_id_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notice_reads" ADD CONSTRAINT "notice_reads_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_documents_employee_idx" ON "employee_documents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_documents_expiry_idx" ON "employee_documents" USING btree ("org_id","expires_on");--> statement-breakpoint
CREATE INDEX "employee_family_employee_idx" ON "employee_family" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employee_qualifications_employee_idx" ON "employee_qualifications" USING btree ("employee_id","kind");--> statement-breakpoint
CREATE INDEX "notice_reads_employee_idx" ON "notice_reads" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "notices_org_window_idx" ON "notices" USING btree ("org_id","publish_from");