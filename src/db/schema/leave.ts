/**
 * Leave, and the approval engine it runs on.
 *
 * The legacy system reimplemented "levels of approval" separately in leave, travel
 * order, expense claim, advance, asset request and appraisal - six copies of the
 * same state machine, each with its own bugs. Here approval is one generic table
 * keyed by (entityType, entityId); leave is simply its first consumer, and travel
 * or expense modules attach to the same engine without new tables.
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { fiscalYears, organizations } from "./core";
import { employees } from "./hr";
import { approvalDecision, approvalSteps, requestStatus } from "./approvals";
import {
  allocationRule,
  applyWindow,
  lapseType,
  leaveNature,
  qualifyFrom,
} from "./leave-policy";

// Re-exported so existing `@/db/schema/leave` imports keep resolving; the
// definitions live in ./approvals because attendance, travel and expense use
// the same ledger and must not import a leave module file to reach it.
export { approvalDecision, approvalSteps, requestStatus };

export const leaveUnit = pgEnum("leave_unit", ["day", "half_day", "hour"]);

export const leaveAppliesTo = pgEnum("leave_applies_to", ["all", "male", "female"]);

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameNepali: text("name_nepali"),
    unit: leaveUnit("unit").notNull().default("day"),
    /** Entitlement granted at the start of each fiscal year. */
    daysPerYear: numeric("days_per_year", { precision: 6, scale: 2 }).notNull().default("0"),
    isPaid: boolean("is_paid").notNull().default(true),
    allowHalfDay: boolean("allow_half_day").notNull().default(true),
    /** Unused days roll into next year, capped by maxCarryForwardDays. */
    allowCarryForward: boolean("allow_carry_forward").notNull().default(false),
    maxCarryForwardDays: numeric("max_carry_forward_days", { precision: 6, scale: 2 }),
    /** Sick leave typically needs a medical certificate beyond a threshold. */
    requiresAttachmentAfterDays: integer("requires_attachment_after_days"),
    minNoticeDays: integer("min_notice_days").notNull().default(0),
    maxConsecutiveDays: integer("max_consecutive_days"),
    appliesTo: leaveAppliesTo("applies_to").notNull().default("all"),
    /** Deducted from balance, or unlimited (e.g. unpaid leave). */
    deductsBalance: boolean("deducts_balance").notNull().default(true),
    /** Hex colour for the calendar view. */
    colour: text("colour").notNull().default("#0f6e63"),
    approvalLevels: integer("approval_levels").notNull().default(1),

    /* ------------------------------------------------ the three that matter */

    /**
     * What a day of this leave *is*. Attendance turns it into a daily status and
     * payroll into a pay rule. See leave-policy.ts — this column, `paidPercent`
     * and `lapseType` are the whole contract with the rest of the product.
     */
    nature: leaveNature("nature").notNull().default("paid"),
    /** 0-100. What payroll pays for a day, before any per-head override. */
    paidPercent: numeric("paid_percent", { precision: 5, scale: 2 }).notNull().default("100"),
    lapseType: lapseType("lapse_type").notNull().default("yearly"),

    /* ------------------------------------------------------- legacy parity */

    leaveGroupId: uuid("leave_group_id"),
    allocationRule: allocationRule("allocation_rule").notNull().default("advance"),
    applyWindow: applyWindow("apply_window").notNull().default("any"),
    qualifyFrom: qualifyFrom("qualify_from").notNull().default("date_of_join"),
    /** Deduction precedence when several types could cover the same day. */
    leaveOrder: integer("leave_order").notNull().default(50),
    /** Marital status this applies to; null is everyone. */
    maritalStatus: text("marital_status"),
    /** Whole-service cap on occurrences, e.g. maternity twice. */
    timesAllowedInService: integer("times_allowed_in_service"),
    /** Service days needed before this can be taken at all. */
    minDaysToQualify: integer("min_days_to_qualify"),
    /** Longest run permitted for a service-period leave such as study leave. */
    maxDaysToApply: integer("max_days_to_apply"),
    /** Ceiling on the accumulated balance, beyond which days must be encashed or lapse. */
    maxAccumulationDays: numeric("max_accumulation_days", { precision: 6, scale: 2 }),

    isEncashable: boolean("is_encashable").notNull().default(false),
    minDaysToEncash: numeric("min_days_to_encash", { precision: 6, scale: 2 }),
    maxDaysToEncash: numeric("max_days_to_encash", { precision: 6, scale: 2 }),
    /** Excess days over entitlement are recovered from salary at year end. */
    isExcessDeductedFromPay: boolean("is_excess_deducted_from_pay").notNull().default(false),
    /** The leave period does not count towards service length. */
    isDeductedFromServiceTime: boolean("is_deducted_from_service_time").notNull().default(false),

    /**
     * Whether holidays and weekly offs inside a leave span are charged.
     * Defaulting both to true matches the way the day count already worked; a
     * type that charges them (long home leave, in some employers) sets false.
     */
    excludesHolidays: boolean("excludes_holidays").notNull().default(true),
    excludesWeeklyOffs: boolean("excludes_weekly_offs").notNull().default(true),

    /** Allocate the whole entitlement at once rather than accruing it monthly. */
    isAllocatedInFull: boolean("is_allocated_in_full").notNull().default(true),
    /** Notify HR on every request of this type, whoever approves it. */
    notifiesHr: boolean("notifies_hr").notNull().default(false),

    /**
     * Day ceilings per approval level. A request longer than level 1's limit
     * skips straight past that level — the legacy behaviour, and the reason a
     * two-day request and a twenty-day request take different routes.
     */
    level1LimitDays: integer("level1_limit_days"),
    level2LimitDays: integer("level2_limit_days"),
    level3LimitDays: integer("level3_limit_days"),
    level4LimitDays: integer("level4_limit_days"),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("leave_types_org_code_key").on(t.orgId, t.code)],
);

/**
 * One row per employee, leave type and fiscal year.
 *
 * `used` is maintained transactionally when a request is approved or cancelled,
 * rather than recomputed by summing requests, so the balance shown to an employee
 * and the balance enforced at submission cannot disagree under concurrency.
 */
export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    fiscalYearId: uuid("fiscal_year_id")
      .notNull()
      .references(() => fiscalYears.id, { onDelete: "cascade" }),
    entitled: numeric("entitled", { precision: 6, scale: 2 }).notNull().default("0"),
    carriedForward: numeric("carried_forward", { precision: 6, scale: 2 }).notNull().default("0"),
    used: numeric("used", { precision: 6, scale: 2 }).notNull().default("0"),
    /** Reserved by requests that are submitted but not yet decided. */
    pending: numeric("pending", { precision: 6, scale: 2 }).notNull().default("0"),
    encashed: numeric("encashed", { precision: 6, scale: 2 }).notNull().default("0"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("leave_balances_unique").on(t.employeeId, t.leaveTypeId, t.fiscalYearId),
    index("leave_balances_org_idx").on(t.orgId),
  ],
);

export const dayPortion = pgEnum("day_portion", ["full", "first_half", "second_half"]);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Human-facing reference, e.g. LV-2083-0042. */
    reference: text("reference").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "restrict" }),
    fiscalYearId: uuid("fiscal_year_id")
      .notNull()
      .references(() => fiscalYears.id, { onDelete: "restrict" }),

    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    fromDateBs: text("from_date_bs").notNull(),
    toDateBs: text("to_date_bs").notNull(),
    portion: dayPortion("portion").notNull().default("full"),
    /** Working days, Saturdays and holidays already excluded. */
    totalDays: numeric("total_days", { precision: 6, scale: 2 }).notNull(),

    reason: text("reason").notNull(),
    contactDuringLeave: text("contact_during_leave"),
    attachmentUrl: text("attachment_url"),
    /** Who covers the work while they are away. */
    handoverToEmployeeId: uuid("handover_to_employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),

    status: requestStatus("status").notNull().default("draft"),
    /** Which approval level is currently outstanding; null once finished. */
    currentLevel: integer("current_level"),
    submittedAt: timestamp("submitted_at"),
    decidedAt: timestamp("decided_at"),
    cancelledAt: timestamp("cancelled_at"),
    cancelReason: text("cancel_reason"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("leave_requests_org_reference_key").on(t.orgId, t.reference),
    index("leave_requests_employee_idx").on(t.employeeId, t.fromDate),
    index("leave_requests_org_status_idx").on(t.orgId, t.status),
  ],
);

export const leaveTypesRelations = relations(leaveTypes, ({ one, many }) => ({
  organization: one(organizations, { fields: [leaveTypes.orgId], references: [organizations.id] }),
  balances: many(leaveBalances),
}));

export const leaveBalancesRelations = relations(leaveBalances, ({ one }) => ({
  employee: one(employees, { fields: [leaveBalances.employeeId], references: [employees.id] }),
  leaveType: one(leaveTypes, { fields: [leaveBalances.leaveTypeId], references: [leaveTypes.id] }),
  fiscalYear: one(fiscalYears, {
    fields: [leaveBalances.fiscalYearId],
    references: [fiscalYears.id],
  }),
}));

export const leaveRequestsRelations = relations(leaveRequests, ({ one }) => ({
  employee: one(employees, { fields: [leaveRequests.employeeId], references: [employees.id] }),
  leaveType: one(leaveTypes, { fields: [leaveRequests.leaveTypeId], references: [leaveTypes.id] }),
  fiscalYear: one(fiscalYears, {
    fields: [leaveRequests.fiscalYearId],
    references: [fiscalYears.id],
  }),
  handoverTo: one(employees, {
    fields: [leaveRequests.handoverToEmployeeId],
    references: [employees.id],
    relationName: "leave_handover",
  }),
}));
