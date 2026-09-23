/**
 * Extended organisation structure — legacy parity.
 *
 * The Nimble.Ananta Organization Structure area defined a dozen near-identical
 * code/name/parent tables (Division, Business Unit, Sub Business Unit,
 * Functional Category, Section, Project, Location, Sub Location …), each with
 * its own controller, its own CRUD screen and its own subtly different
 * validation. A dozen tables that differ only in what they are called is one
 * table with a discriminator.
 *
 * Two of them are deliberately not folded in, and the reason matters:
 * `branches` and `departments` are referenced by `employees` and by every
 * report, and both are already self-referencing trees. A *section* is a
 * department with a parent; a *sub-location* is a branch with a parent.
 * Collapsing those into org_units would rewrite the employee master to buy
 * nothing.
 *
 * Everything here is master data: slow-changing, read constantly, written by a
 * handful of people. It is exposed to other modules through OrgPort and through
 * nothing else.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { softDelete } from "./columns";
import { organizations } from "./core";
import { grades } from "./org";

/** The kinds that live in the generic table. Branch and department have their own. */
export const orgUnitKind = pgEnum("org_unit_kind", [
  "division",
  "business_unit",
  "sub_business_unit",
  "functional_category",
  "project",
  "location",
]);

export const orgUnits = pgTable(
  "org_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: orgUnitKind("kind").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameNepali: text("name_nepali"),
    /**
     * Parent within this table. A sub business unit points at a business unit,
     * which points at a division. Which kind may parent which is enforced in the
     * org service, because a check constraint cannot see the parent row.
     */
    parentId: uuid("parent_id").references((): AnyPgColumn => orgUnits.id, {
      onDelete: "restrict",
    }),
    /** Projects are dated; every other kind leaves these null. */
    startDate: date("start_date"),
    endDate: date("end_date"),
    /** Country and state apply to locations. Null elsewhere. */
    country: text("country"),
    state: text("state"),
    sortOrder: integer("sort_order").notNull().default(0),
    remarks: text("remarks"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    ...softDelete,
  },
  (t) => [
    uniqueIndex("org_units_org_kind_code_key").on(t.orgId, t.kind, t.code).where(sql`deleted_at is null`),
    index("org_units_org_kind_idx").on(t.orgId, t.kind),
    index("org_units_parent_idx").on(t.parentId),
  ],
);

/**
 * Position levels — CEO at 1, officer at 8. Designations map onto a level, which
 * is what makes "who outranks whom" answerable without parsing job titles.
 */
export const positionLevels = pgTable(
  "position_levels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** 1 is most senior. Used for ordering and for approval-limit rules. */
    levelOrder: integer("level_order").notNull(),
    /** Legacy "Max Service Month": how long somebody may sit at this level. */
    maxServiceMonths: integer("max_service_months"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    unique("position_levels_org_code_key").on(t.orgId, t.code),
    unique("position_levels_org_order_key").on(t.orgId, t.levelOrder),
  ],
);

/** Which grades a level may hold — the legacy Level Grade Relation. */
export const levelGrades = pgTable(
  "level_grades",
  {
    levelId: uuid("level_id")
      .notNull()
      .references(() => positionLevels.id, { onDelete: "cascade" }),
    gradeId: uuid("grade_id")
      .notNull()
      .references(() => grades.id, { onDelete: "cascade" }),
  },
  (t) => [unique("level_grades_key").on(t.levelId, t.gradeId)],
);

export const headType = pgEnum("head_type", ["none", "branch_head", "department_head"]);

/**
 * Job titles — the role somebody performs, as distinct from their designation
 * (rank) and their department (where they sit). `headType` is what makes an
 * employee the approver for a branch or a department without a second table.
 */
export const jobTitles = pgTable(
  "job_titles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    headType: headType("head_type").notNull().default("none"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [unique("job_titles_org_code_key").on(t.orgId, t.code)],
);

/**
 * Service classification — technical / non-technical and their sub-groups.
 * Retirement age differs by service, so this is not merely a label.
 */
export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    retirementAge: integer("retirement_age"),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [unique("services_org_code_key").on(t.orgId, t.code)],
);

export const serviceGroups = pgTable(
  "service_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Sub-group of another group, e.g. IT under Technical. */
    parentId: uuid("parent_id").references((): AnyPgColumn => serviceGroups.id, {
      onDelete: "restrict",
    }),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [
    unique("service_groups_org_code_key").on(t.orgId, t.code),
    index("service_groups_service_idx").on(t.serviceId),
  ],
);

export const attendanceCalcType = pgEnum("attendance_calc_type", [
  "strict_hours",
  "average_hours",
  "day_wise",
]);

export const remunerationType = pgEnum("remuneration_type", [
  "regular",
  "daily_wages",
  "security_guard",
]);

export const offDayPolicy = pgEnum("off_day_policy", [
  "none",
  "as_overtime",
  "as_present",
  "as_present_and_overtime",
]);

/**
 * Remuneration groups: how a class of staff is measured and paid.
 *
 * The most consequential table in this module, because attendance calculation
 * reads it. It answers: are hours counted strictly or averaged; what happens
 * when somebody works a weekly off; what the daily, weekly and monthly overtime
 * ceilings are.
 *
 * Attendance never imports this table — it receives the resolved policy through
 * the org port, so a column added here does not recompile attendance.
 */
export const remunerationGroups = pgTable(
  "remuneration_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),

    remunerationType: remunerationType("remuneration_type").notNull().default("regular"),
    attendanceCalcType: attendanceCalcType("attendance_calc_type")
      .notNull()
      .default("strict_hours"),
    /** Divisor for a month of salary — 30, or the actual days in the BS month. */
    standardSalaryDays: integer("standard_salary_days").notNull().default(30),

    offDayPolicy: offDayPolicy("off_day_policy").notNull().default("none"),
    maxBreakMinutes: integer("max_break_minutes").notNull().default(60),

    /** Ceilings, in minutes. A figure over the ceiling is clamped, not rejected. */
    dailyOtLimitMinutes: integer("daily_ot_limit_minutes"),
    weeklyOtLimitMinutes: integer("weekly_ot_limit_minutes"),
    monthlyOtLimitMinutes: integer("monthly_ot_limit_minutes"),
    offDayOtLimitMinutes: integer("off_day_ot_limit_minutes"),

    /** Overtime is always computed; this decides whether it is payable. */
    isOvertimePayable: boolean("is_overtime_payable").notNull().default(true),
    /** Staff exempt from punch-based deduction — directors, field sales. */
    isAttendanceExempt: boolean("is_attendance_exempt").notNull().default(false),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("remuneration_groups_org_code_key").on(t.orgId, t.code)],
);

export const orgUnitsRelations = relations(orgUnits, ({ one, many }) => ({
  organization: one(organizations, { fields: [orgUnits.orgId], references: [organizations.id] }),
  parent: one(orgUnits, {
    fields: [orgUnits.parentId],
    references: [orgUnits.id],
    relationName: "org_unit_parent",
  }),
  children: many(orgUnits, { relationName: "org_unit_parent" }),
}));

export const positionLevelsRelations = relations(positionLevels, ({ many }) => ({
  grades: many(levelGrades),
}));

export const serviceGroupsRelations = relations(serviceGroups, ({ one, many }) => ({
  service: one(services, { fields: [serviceGroups.serviceId], references: [services.id] }),
  parent: one(serviceGroups, {
    fields: [serviceGroups.parentId],
    references: [serviceGroups.id],
    relationName: "service_group_parent",
  }),
  children: many(serviceGroups, { relationName: "service_group_parent" }),
}));
