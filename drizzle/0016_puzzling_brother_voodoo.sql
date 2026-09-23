CREATE TYPE "public"."leave_balance_adjustment_kind" AS ENUM('allocation', 'adjustment', 'carry_forward', 'lapse', 'encashment', 'encashment_reversal');--> statement-breakpoint
CREATE TABLE "leave_balance_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"balance_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"kind" "leave_balance_adjustment_kind" NOT NULL,
	"field" text NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"before" numeric(6, 2) NOT NULL,
	"after" numeric(6, 2) NOT NULL,
	"reason" text,
	"reference" text,
	"reverses_id" uuid,
	"reversed_at" timestamp,
	"dedupe_key" text,
	"by_user_id" text,
	"by_label" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "leave_balance_adjustments_dedupe_key" UNIQUE("org_id","dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_balance_id_leave_balances_id_fk" FOREIGN KEY ("balance_id") REFERENCES "public"."leave_balances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balance_adjustments" ADD CONSTRAINT "leave_balance_adjustments_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_balance_adjustments_balance_idx" ON "leave_balance_adjustments" USING btree ("balance_id","created_at");--> statement-breakpoint
CREATE INDEX "leave_balance_adjustments_org_kind_idx" ON "leave_balance_adjustments" USING btree ("org_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "leave_balance_adjustments_employee_idx" ON "leave_balance_adjustments" USING btree ("employee_id","created_at");