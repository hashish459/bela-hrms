CREATE TYPE "public"."probation_outcome" AS ENUM('confirmed', 'extended', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."employee_document_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea" NOT NULL,
	"uploaded_by" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "probation_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"probation_end_date" date,
	"outcome" "probation_outcome" NOT NULL,
	"effective_date" date NOT NULL,
	"new_probation_end_date" date,
	"remarks" text,
	"decided_by_user_id" text,
	"decided_by_label" text,
	"decided_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "photo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD COLUMN "status" "employee_document_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probation_reviews" ADD CONSTRAINT "probation_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "probation_reviews" ADD CONSTRAINT "probation_reviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_org_idx" ON "files" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "files_sha_idx" ON "files" USING btree ("org_id","sha256");--> statement-breakpoint
CREATE INDEX "probation_reviews_employee_idx" ON "probation_reviews" USING btree ("employee_id","decided_at");--> statement-breakpoint
CREATE INDEX "probation_reviews_org_idx" ON "probation_reviews" USING btree ("org_id","decided_at");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_photo_file_id_files_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_documents_status_idx" ON "employee_documents" USING btree ("org_id","status");