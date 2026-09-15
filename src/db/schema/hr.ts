/**
 * The employee master.
 *
 * Field selection follows the legacy `EmployeeInfo` table, keeping what Nepali HR
 * and payroll actually need - PAN, SSF, CIT and provident fund identifiers,
 * citizenship number, Nepali-script name - and dropping the columns that had
 * accumulated as one-off report scratch space.
 *
 * Dates are stored Gregorian and rendered in Bikram Sambat. The legacy schema kept
 * both a `datetime` and a `varchar` BS string for many dates, and they drifted.
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { organizations } from "./core";
import { branches, departments, designations, employmentTypes, grades } from "./org";
import {
  jobTitles,
  orgUnits,
  positionLevels,
  remunerationGroups,
  serviceGroups,
} from "./org-structure";

export const gender = pgEnum("gender", ["male", "female", "other"]);

export const maritalStatus = pgEnum("marital_status", [
  "single",
  "married",
  "divorced",
  "widowed",
]);

/**
 * Employment lifecycle. `probation` and `active` are both "currently employed";
 * everything from `resigned` onward is a separation and freezes leave accrual.
 */
export const employeeStatus = pgEnum("employee_status", [
  "probation",
  "active",
  "on_leave",
  "suspended",
  "resigned",
  "terminated",
  "retired",
]);

export const EMPLOYED_STATUSES = ["probation", "active", "on_leave", "suspended"] as const;

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** Human-facing identifier, unique within the organisation. */
    employeeCode: text("employee_code").notNull(),

    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    lastName: text("last_name").notNull(),
    fullNameNepali: text("full_name_nepali"),

    gender: gender("gender").notNull(),
    maritalStatus: maritalStatus("marital_status"),
    dateOfBirth: date("date_of_birth"),

    personalEmail: text("personal_email"),
    workEmail: text("work_email"),
    mobile: text("mobile"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),

    permanentAddress: text("permanent_address"),
    temporaryAddress: text("temporary_address"),
    district: text("district"),

    // ---- placement
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "restrict",
    }),
    designationId: uuid("designation_id").references(() => designations.id, {
      onDelete: "restrict",
    }),
    employmentTypeId: uuid("employment_type_id").references(() => employmentTypes.id, {
      onDelete: "restrict",
    }),
    gradeId: uuid("grade_id").references(() => grades.id, { onDelete: "restrict" }),

    // ---- extended structure (legacy parity)
    // Nullable throughout: an organisation that does not run divisions or
    // projects leaves them empty, and no query changes shape because of it.
    divisionId: uuid("division_id").references(() => orgUnits.id, { onDelete: "restrict" }),
    businessUnitId: uuid("business_unit_id").references(() => orgUnits.id, {
      onDelete: "restrict",
    }),
    functionalCategoryId: uuid("functional_category_id").references(() => orgUnits.id, {
      onDelete: "restrict",
    }),
    projectId: uuid("project_id").references(() => orgUnits.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").references(() => orgUnits.id, { onDelete: "restrict" }),
    positionLevelId: uuid("position_level_id").references(() => positionLevels.id, {
      onDelete: "restrict",
    }),
    jobTitleId: uuid("job_title_id").references(() => jobTitles.id, { onDelete: "restrict" }),
    serviceGroupId: uuid("service_group_id").references(() => serviceGroups.id, {
      onDelete: "restrict",
    }),
    /**
     * Which attendance and overtime policy applies. Attendance reads this
     * through the org port; a null falls back to the organisation default, so an
     * unconfigured employee is still calculable.
     */
    remunerationGroupId: uuid("remuneration_group_id").references(() => remunerationGroups.id, {
      onDelete: "restrict",
    }),
    /** Approval routing walks this chain. */
    supervisorId: uuid("supervisor_id").references((): AnyPgColumn => employees.id, {
      onDelete: "set null",
    }),

    // ---- lifecycle
    status: employeeStatus("status").notNull().default("probation"),
    dateOfJoin: date("date_of_join").notNull(),
    probationEndDate: date("probation_end_date"),
    confirmationDate: date("confirmation_date"),
    separationDate: date("separation_date"),
    separationReason: text("separation_reason"),

    // ---- statutory (Nepal)
    /** Permanent Account Number - required for TDS. */
    panNumber: text("pan_number"),
    citizenshipNumber: text("citizenship_number"),
    /** Social Security Fund contributor id. */
    ssfNumber: text("ssf_number"),
    /** Employees Provident Fund id. */
    pfNumber: text("pf_number"),
    /** Citizen Investment Trust id. */
    citNumber: text("cit_number"),

    // ---- payment
    bankName: text("bank_name"),
    bankBranch: text("bank_branch"),
    bankAccountNumber: text("bank_account_number"),
    basicSalary: numeric("basic_salary", { precision: 14, scale: 2 }),

    photoUrl: text("photo_url"),
    notes: text("notes"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("employees_org_code_key").on(t.orgId, t.employeeCode),
    index("employees_org_status_idx").on(t.orgId, t.status),
    index("employees_org_dept_idx").on(t.orgId, t.departmentId),
    index("employees_supervisor_idx").on(t.supervisorId),
  ],
);

/**
 * Append-only record of placement changes - transfers, promotions, confirmations.
 * Payroll and appraisal both need "what was true on this date", which a mutable
 * employee row cannot answer.
 */
export const employeeAssignments = pgTable(
  "employee_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    branchId: uuid("branch_id").references(() => branches.id),
    departmentId: uuid("department_id").references(() => departments.id),
    designationId: uuid("designation_id").references(() => designations.id),
    gradeId: uuid("grade_id").references(() => grades.id),
    supervisorId: uuid("supervisor_id").references(() => employees.id),
    basicSalary: numeric("basic_salary", { precision: 14, scale: 2 }),
    reason: text("reason"),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("employee_assignments_emp_idx").on(t.employeeId, t.effectiveFrom)],
);

export const employeesRelations = relations(employees, ({ one, many }) => ({
  organization: one(organizations, { fields: [employees.orgId], references: [organizations.id] }),
  branch: one(branches, { fields: [employees.branchId], references: [branches.id] }),
  department: one(departments, {
    fields: [employees.departmentId],
    references: [departments.id],
  }),
  designation: one(designations, {
    fields: [employees.designationId],
    references: [designations.id],
  }),
  employmentType: one(employmentTypes, {
    fields: [employees.employmentTypeId],
    references: [employmentTypes.id],
  }),
  grade: one(grades, { fields: [employees.gradeId], references: [grades.id] }),
  supervisor: one(employees, {
    fields: [employees.supervisorId],
    references: [employees.id],
    relationName: "employee_supervisor",
  }),
  reports: many(employees, { relationName: "employee_supervisor" }),
  assignments: many(employeeAssignments),
}));

export const employeeAssignmentsRelations = relations(employeeAssignments, ({ one }) => ({
  employee: one(employees, {
    fields: [employeeAssignments.employeeId],
    references: [employees.id],
  }),
}));
