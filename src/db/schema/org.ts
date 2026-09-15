/**
 * Organisation structure: the master data every other module keys off.
 *
 * Branches and departments are self-referencing trees. The legacy system stored
 * `UnderBranch = 0` to mean "root", which meant a broken parent id was
 * indistinguishable from a root node - exactly the failure that took its menu
 * tree down. Here a root has `parentId = NULL` and the foreign key is enforced,
 * so a dangling parent cannot be inserted in the first place.
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { organizations } from "./core";

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameNepali: text("name_nepali"),
    parentId: uuid("parent_id").references((): AnyPgColumn => branches.id, {
      onDelete: "restrict",
    }),
    address: text("address"),
    district: text("district"),
    phone: text("phone"),
    isHeadOffice: boolean("is_head_office").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("branches_org_code_key").on(t.orgId, t.code),
    index("branches_org_idx").on(t.orgId),
  ],
);

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameNepali: text("name_nepali"),
    parentId: uuid("parent_id").references((): AnyPgColumn => departments.id, {
      onDelete: "restrict",
    }),
    /** Resolved lazily - the head is an employee, and employees reference departments. */
    headEmployeeId: uuid("head_employee_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("departments_org_code_key").on(t.orgId, t.code),
    index("departments_org_idx").on(t.orgId),
  ],
);

export const designations = pgTable(
  "designations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameNepali: text("name_nepali"),
    /** 1 is most senior. Drives approval routing and seniority reports. */
    hierarchyLevel: integer("hierarchy_level").notNull().default(50),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [unique("designations_org_code_key").on(t.orgId, t.code)],
);

export const employmentTypes = pgTable(
  "employment_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** Contract and probation staff usually accrue leave differently. */
    accruesLeave: boolean("accrues_leave").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [unique("employment_types_org_code_key").on(t.orgId, t.code)],
);

export const grades = pgTable(
  "grades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    hierarchyLevel: integer("hierarchy_level").notNull().default(50),
    /** Nepalese rupees. numeric, never float - this feeds payroll. */
    basicSalary: numeric("basic_salary", { precision: 14, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [unique("grades_org_code_key").on(t.orgId, t.code)],
);

export const branchesRelations = relations(branches, ({ one, many }) => ({
  organization: one(organizations, { fields: [branches.orgId], references: [organizations.id] }),
  parent: one(branches, {
    fields: [branches.parentId],
    references: [branches.id],
    relationName: "branch_parent",
  }),
  children: many(branches, { relationName: "branch_parent" }),
}));

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [departments.orgId],
    references: [organizations.id],
  }),
  parent: one(departments, {
    fields: [departments.parentId],
    references: [departments.id],
    relationName: "department_parent",
  }),
  children: many(departments, { relationName: "department_parent" }),
}));
