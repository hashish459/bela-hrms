CREATE TYPE "public"."attendance_device_connection" AS ENUM('tcp_ip', 'usb', 'serial', 'cloud_api');--> statement-breakpoint
CREATE TYPE "public"."attendance_device_direction" AS ENUM('in_only', 'out_only', 'alternating', 'device_reported');--> statement-breakpoint
CREATE TYPE "public"."attendance_device_kind" AS ENUM('fingerprint', 'face', 'card', 'mobile', 'kiosk');--> statement-breakpoint
CREATE TYPE "public"."attendance_device_status" AS ENUM('active', 'inactive', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."device_punch_direction" AS ENUM('in', 'out', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."device_punch_status" AS ENUM('pending', 'applied', 'unmatched', 'skipped');--> statement-breakpoint
CREATE TABLE "attendance_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"branch_id" uuid,
	"location" text,
	"kind" "attendance_device_kind" DEFAULT 'fingerprint' NOT NULL,
	"connection" "attendance_device_connection" DEFAULT 'tcp_ip' NOT NULL,
	"direction" "attendance_device_direction" DEFAULT 'alternating' NOT NULL,
	"status" "attendance_device_status" DEFAULT 'active' NOT NULL,
	"vendor" text,
	"model" text,
	"serial_number" text,
	"ip_address" "inet",
	"port" integer,
	"sync_interval_minutes" integer DEFAULT 15 NOT NULL,
	"last_seen_at" timestamp,
	"last_sync_at" timestamp,
	"last_error" text,
	"api_key_hash" text,
	"api_key_prefix" text,
	"api_key_issued_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_devices_org_code_key" UNIQUE("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "attendance_device_enrolments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"enroll_number" text NOT NULL,
	"enrolled_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_enrolments_device_number_key" UNIQUE("device_id","enroll_number"),
	CONSTRAINT "device_enrolments_device_employee_key" UNIQUE("device_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_device_punches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"enroll_number" text NOT NULL,
	"employee_id" uuid,
	"punched_at" timestamp NOT NULL,
	"punch_date" text NOT NULL,
	"direction" "device_punch_direction" DEFAULT 'unknown' NOT NULL,
	"status" "device_punch_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"note" text,
	CONSTRAINT "device_punches_unique_reading" UNIQUE("device_id","enroll_number","punched_at")
);
--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_devices" ADD CONSTRAINT "attendance_devices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_enrolments" ADD CONSTRAINT "attendance_device_enrolments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_enrolments" ADD CONSTRAINT "attendance_device_enrolments_device_id_attendance_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."attendance_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_enrolments" ADD CONSTRAINT "attendance_device_enrolments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_punches" ADD CONSTRAINT "attendance_device_punches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_punches" ADD CONSTRAINT "attendance_device_punches_device_id_attendance_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."attendance_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_punches" ADD CONSTRAINT "attendance_device_punches_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_devices_org_status_idx" ON "attendance_devices" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "attendance_devices_branch_idx" ON "attendance_devices" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "device_enrolments_employee_idx" ON "attendance_device_enrolments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "device_enrolments_org_idx" ON "attendance_device_enrolments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "device_punches_employee_date_idx" ON "attendance_device_punches" USING btree ("employee_id","punch_date");--> statement-breakpoint
CREATE INDEX "device_punches_org_status_idx" ON "attendance_device_punches" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "device_punches_device_time_idx" ON "attendance_device_punches" USING btree ("device_id","punched_at");