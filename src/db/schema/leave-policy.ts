/**
 * Leave policy — the legacy Leave Master, modelled properly.
 *
 * Nimble.Ananta's Leave Master screen carried roughly forty settings on one
 * form, and three of them decided what the rest of the product did with a leave
 * day. Those three are pulled out here as first-class columns, because every
 * downstream module keys off them:
 *
 *   nature        what the day *is* — worked, paid absence, unpaid absence,
 *                 field work, a holiday, a substitute credit. Attendance turns
 *                 this into a daily status; nothing else may.
 *   paidPercent   what payroll pays for it. 100 for paid leave, 0 for unpaid,
 *                 50 for half-pay study leave. One number, one meaning.
 *   lapseType     when unused entitlement disappears — never, monthly, at year
 *                 end, or at the end of a service period.
 *
 * The legacy system inferred all three from a mix of `LeaveTypeID`, a boolean
 * called `IsPaid`, and a salary-head relation table, and the three disagreed:
 * unpaid leave was paid in one report and deducted in another. A leave day means
 * one thing here, and it is stated once.
 *
 * Per-salary-head overrides still exist — education leave paying 100% of basic
 * and 50% of allowances — but they are an override on top of `paidPercent`, not
 * a competing source of truth.
 */
import { relations } from "drizzle-orm";
import {
  boolean,
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
import { employmentTypes } from "./org";
import { leaveTypes } from "./leave";

/**
 * What a leave day actually is. Attendance maps this onto a daily status and
 * payroll onto a pay rule; nobody else interprets it.
 */
export const leaveNature = pgEnum("leave_nature", [
  /** Working, but away from the office — client visit, site work. Counts as present. */
  "official_work",
  /** Away, and paid. The ordinary case. */
  "paid",
  /** Away, unpaid. Deducted by payroll. */
  "unpaid",
  /** Away without approval — treated as an absence for evaluation and pay. */
  "absent",
  /** Time off owed for a weekly off or holiday that was worked. */
  "substitute",
  /** The office was shut (a strike, a curfew) — nobody is charged for it. */
  "holiday",
  /** Travelling on the organisation's business. Counts as present. */
  "transit",
]);

/** When unused entitlement disappears. */
export const lapseType = pgEnum("lapse_type", ["none", "monthly", "yearly", "service_period"]);

/** How much may be taken against a balance that has not accrued yet. */
export const allocationRule = pgEnum("leave_allocation_rule", [
  /** Up to the full year's entitlement, whenever it is asked for. */
  "advance",
  /** No ceiling — the balance may go negative. */
  "negative",
  /** Only what has matured by the leave date. */
  "matured_only",
  /** No balance is tracked at all (field work). */
  "no_tracking",
]);

/** When the request may be raised relative to the leave itself. */
export const applyWindow = pgEnum("leave_apply_window", ["pre", "post", "any"]);

/** The date service qualification counts from. */
export const qualifyFrom = pgEnum("leave_qualify_from", [
  "date_of_join",
  "date_of_permanent",
  "contract_start",
  "probation_start",
]);

/**
 * Leave groups — the legacy Leave Group screen. A reporting bucket that several
 * leave types share (all sick-type leave, all statutory leave).
 */
export const leaveGroups = pgTable(
  "leave_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameNepali: text("name_nepali"),
    remarks: text("remarks"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [unique("leave_groups_org_code_key").on(t.orgId, t.code)],
);

/**
 * Entitlement by employment type — the legacy Employment Type Relation.
 *
 * A permanent employee gets 12 days of home leave, a contract employee 6, an
 * intern none. Without this the entitlement is a single number on the leave type
 * and every exception becomes a manual balance edit.
 */
export const leaveTypeEntitlements = pgTable(
  "leave_type_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    employmentTypeId: uuid("employment_type_id")
      .notNull()
      .references(() => employmentTypes.id, { onDelete: "cascade" }),
    daysAllowed: numeric("days_allowed", { precision: 6, scale: 2 }).notNull().default("0"),
    /** Overrides the type's own accumulation cap for this employment type. */
    maxAccumulationDays: numeric("max_accumulation_days", { precision: 6, scale: 2 }),
  },
  (t) => [
    unique("leave_type_entitlements_key").on(t.leaveTypeId, t.employmentTypeId),
    index("leave_type_entitlements_org_idx").on(t.orgId),
  ],
);

/**
 * Per-salary-head pay treatment — the legacy Salary Head Relation.
 *
 * An override on `leave_types.paid_percent`, not a replacement for it: absent a
 * row, the head is paid at the type's own percentage. `salaryHeadCode` is text
 * rather than a foreign key because payroll owns salary heads, and leave must
 * not hold a key into another module's tables.
 */
export const leaveSalaryEffects = pgTable(
  "leave_salary_effects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    /** e.g. "BASIC", "GRADE", "ALLOWANCE". Matched by payroll, ignored if unknown. */
    salaryHeadCode: text("salary_head_code").notNull(),
    /** 0–100. What proportion of this head is paid for a day of this leave. */
    payPercent: numeric("pay_percent", { precision: 5, scale: 2 }).notNull().default("100"),
  },
  (t) => [
    unique("leave_salary_effects_key").on(t.leaveTypeId, t.salaryHeadCode),
    index("leave_salary_effects_org_idx").on(t.orgId),
  ],
);

/**
 * Maturity interference — the legacy Effected Leave Relation.
 *
 * Time spent on one leave slows the accrual of another: a month of home leave
 * may earn only half a month of annual leave. `effectPercent` is how much
 * accrual still happens while the employee is on the affecting leave.
 */
export const leaveMaturityEffects = pgTable(
  "leave_maturity_effects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The leave being taken. */
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    /** The leave whose accrual is affected by taking it. */
    affectedLeaveTypeId: uuid("affected_leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    /** 100 = accrues normally, 0 = no accrual at all while on this leave. */
    effectPercent: numeric("effect_percent", { precision: 5, scale: 2 }).notNull().default("100"),
  },
  (t) => [
    unique("leave_maturity_effects_key").on(t.leaveTypeId, t.affectedLeaveTypeId),
    index("leave_maturity_effects_org_idx").on(t.orgId),
  ],
);

export const substituteStatus = pgEnum("substitute_status", [
  "pending",
  "approved",
  "rejected",
  "consumed",
  "expired",
]);

/**
 * Substitute leave credits — the legacy Substitute Leave module.
 *
 * Somebody works a weekly off or a public holiday and earns a day back. The
 * credit is a row here, approved on the shared ledger, and consumed by a leave
 * request against a substitute-nature leave type.
 *
 * `workedDate` is unique per employee: one day worked earns one credit, however
 * many times somebody submits the claim.
 */
export const substituteCredits = pgTable(
  "substitute_credits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    fiscalYearId: uuid("fiscal_year_id")
      .notNull()
      .references(() => fiscalYears.id, { onDelete: "restrict" }),
    /** The off day that was worked. */
    workedDate: text("worked_date").notNull(),
    workedDateBs: text("worked_date_bs").notNull(),
    /** Usually 1, or 0.5 for a half day worked. */
    claimDays: numeric("claim_days", { precision: 4, scale: 2 }).notNull().default("1"),
    remarks: text("remarks"),
    status: substituteStatus("status").notNull().default("pending"),
    /** Credits do not sit unused for ever; null means no expiry. */
    expiresOn: text("expires_on"),
    consumedByRequestId: uuid("consumed_by_request_id"),
    submittedAt: timestamp("submitted_at").notNull().defaultNow(),
    decidedAt: timestamp("decided_at"),
  },
  (t) => [
    unique("substitute_credits_reference_key").on(t.orgId, t.reference),
    unique("substitute_credits_employee_date_key").on(t.employeeId, t.workedDate),
    index("substitute_credits_status_idx").on(t.orgId, t.status),
  ],
);

export const leaveGroupsRelations = relations(leaveGroups, ({ one, many }) => ({
  organization: one(organizations, { fields: [leaveGroups.orgId], references: [organizations.id] }),
  types: many(leaveTypes),
}));

export const leaveTypeEntitlementsRelations = relations(leaveTypeEntitlements, ({ one }) => ({
  leaveType: one(leaveTypes, {
    fields: [leaveTypeEntitlements.leaveTypeId],
    references: [leaveTypes.id],
  }),
  employmentType: one(employmentTypes, {
    fields: [leaveTypeEntitlements.employmentTypeId],
    references: [employmentTypes.id],
  }),
}));

export const substituteCreditsRelations = relations(substituteCredits, ({ one }) => ({
  employee: one(employees, {
    fields: [substituteCredits.employeeId],
    references: [employees.id],
  }),
  fiscalYear: one(fiscalYears, {
    fields: [substituteCredits.fiscalYearId],
    references: [fiscalYears.id],
  }),
}));
