/**
 * The working calendar: weekly offs and holiday scoping.
 *
 * Nepal works a six-day week, but "Saturday is the day off" is a policy, not a
 * law of nature — factories run split weekly offs by branch and shift, and the
 * legacy system had a Weekly Off Setup screen for exactly that. Hard-coding
 * Saturday would mean re-deriving every attendance figure the day a branch moved
 * to a Friday–Saturday pattern.
 *
 * Holiday groups mirror the legacy Holiday Group / Holiday Employee Relation /
 * Holiday Branch Relation trio: a holiday can apply to everyone, to a branch, to
 * a gender, or to a named list of employees (Nari Diwas, Loshar, and so on).
 *
 * Resolution order, applied in the calendar module and nowhere else:
 *
 *     holiday (scoped to this employee)  >  weekly off  >  working day
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { holidays, organizations } from "./core";
import { branches } from "./org";
import { employees } from "./hr";

/**
 * One row per (scope, weekday) that is not a working day. A branch row overrides
 * the organisation-wide row for that branch, which is how a single factory moves
 * to a different pattern without touching everybody else.
 */
export const weeklyOffs = pgTable(
  "weekly_offs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** null = the organisation default. */
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    /** 0 = Sunday … 6 = Saturday, matching JS getDay(). */
    dayOfWeek: integer("day_of_week").notNull(),
    /** A half-day Saturday is still a working day with a shorter shift. */
    isHalfDay: boolean("is_half_day").notNull().default(false),
    /** Dated so a pattern change does not rewrite history. */
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("weekly_offs_org_idx").on(t.orgId, t.effectiveFrom),
    unique("weekly_offs_scope_key").on(t.orgId, t.branchId, t.dayOfWeek, t.effectiveFrom),
  ],
);

/** A named set of holidays, e.g. "Nari Diwas" for female staff only. */
export const holidayGroups = pgTable(
  "holiday_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameNepali: text("name_nepali"),
    /** null = everyone; "male" | "female" narrows it automatically. */
    appliesToGender: text("applies_to_gender"),
    /** Empty relations mean the group applies to the whole organisation. */
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("holiday_groups_org_code_key").on(t.orgId, t.code)],
);

export const holidayGroupEmployees = pgTable(
  "holiday_group_employees",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => holidayGroups.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("holiday_group_employees_key").on(t.groupId, t.employeeId),
    index("holiday_group_employees_emp_idx").on(t.employeeId),
  ],
);

export const holidayGroupBranches = pgTable(
  "holiday_group_branches",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => holidayGroups.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("holiday_group_branches_key").on(t.groupId, t.branchId),
    index("holiday_group_branches_branch_idx").on(t.branchId),
  ],
);

export const weeklyOffsRelations = relations(weeklyOffs, ({ one }) => ({
  organization: one(organizations, { fields: [weeklyOffs.orgId], references: [organizations.id] }),
  branch: one(branches, { fields: [weeklyOffs.branchId], references: [branches.id] }),
}));

export const holidayGroupsRelations = relations(holidayGroups, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [holidayGroups.orgId],
    references: [organizations.id],
  }),
  employees: many(holidayGroupEmployees),
  branches: many(holidayGroupBranches),
  holidays: many(holidays),
}));

export const holidayGroupEmployeesRelations = relations(holidayGroupEmployees, ({ one }) => ({
  group: one(holidayGroups, {
    fields: [holidayGroupEmployees.groupId],
    references: [holidayGroups.id],
  }),
  employee: one(employees, {
    fields: [holidayGroupEmployees.employeeId],
    references: [employees.id],
  }),
}));

export const holidayGroupBranchesRelations = relations(holidayGroupBranches, ({ one }) => ({
  group: one(holidayGroups, {
    fields: [holidayGroupBranches.groupId],
    references: [holidayGroups.id],
  }),
  branch: one(branches, { fields: [holidayGroupBranches.branchId], references: [branches.id] }),
}));
