CREATE TYPE "public"."work_book_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."work_task_category" AS ENUM('development', 'operations', 'meeting', 'support', 'administration', 'field_work', 'training', 'research', 'planning', 'other');--> statement-breakpoint
CREATE TYPE "public"."work_task_status" AS ENUM('done', 'in_progress', 'blocked');--> statement-breakpoint
CREATE TABLE "work_book_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"date_bs" text NOT NULL,
	"status" "work_book_status" DEFAULT 'draft' NOT NULL,
	"summary" text,
	"blockers" text,
	"plan_next" text,
	"self_rating" smallint,
	"total_minutes" integer DEFAULT 0 NOT NULL,
	"task_count" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp,
	"reopened_at" timestamp,
	"reopened_by_label" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_book_entries_employee_date_key" UNIQUE("employee_id","date")
);
--> statement-breakpoint
CREATE TABLE "work_book_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"title" text NOT NULL,
	"details" text,
	"category" "work_task_category" DEFAULT 'other' NOT NULL,
	"project" text,
	"minutes" integer DEFAULT 0 NOT NULL,
	"status" "work_task_status" DEFAULT 'done' NOT NULL,
	"outcome" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_book_entries" ADD CONSTRAINT "work_book_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_book_entries" ADD CONSTRAINT "work_book_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_book_tasks" ADD CONSTRAINT "work_book_tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_book_tasks" ADD CONSTRAINT "work_book_tasks_entry_id_work_book_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."work_book_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_book_entries_org_date_idx" ON "work_book_entries" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "work_book_entries_org_status_idx" ON "work_book_entries" USING btree ("org_id","status","date");--> statement-breakpoint
CREATE INDEX "work_book_tasks_entry_idx" ON "work_book_tasks" USING btree ("entry_id","sort_order");--> statement-breakpoint
CREATE INDEX "work_book_tasks_org_category_idx" ON "work_book_tasks" USING btree ("org_id","category");--> statement-breakpoint
-- Everybody who has an employee desk can keep a work-book: grant the new
-- permission to every role that already holds the desk. Reviewing records
-- (workbook.record.viewAll) is left to administrators.
INSERT INTO "role_grants" ("role_id", "permission")
SELECT DISTINCT "role_id", 'workbook.entry.write' FROM "role_grants" WHERE "permission" = 'self.desk.view'
ON CONFLICT DO NOTHING;
