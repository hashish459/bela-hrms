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
import { and, inArray, isNull, relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { softDelete } from "./columns";
import { organizations } from "./core";
import { files } from "./files";
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
    emergencyContactRelation: text("emergency_contact_relation"),

    bloodGroup: text("blood_group"),
    nationality: text("nationality"),
    religion: text("religion"),
    passportNumber: text("passport_number"),
    /** Days of notice this person owes on resignation. Null falls back to the policy default. */
    noticePeriodDays: integer("notice_period_days"),

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

    /**
     * The passport photograph.
     *
     * `photoUrl` stays for a photograph hosted elsewhere — the legacy system
     * stored a path onto a Windows share — and `photoFileId` points at a file
     * uploaded through this product. A reader prefers the file and falls back to
     * the URL, so neither source has to be migrated before the other works.
     */
    photoFileId: uuid("photo_file_id").references(() => files.id, { onDelete: "set null" }),
    photoUrl: text("photo_url"),
    notes: text("notes"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    ...softDelete,
  },
  (t) => [
    /*
     * Unique among live records only. A duplicate entered by mistake and then
     * deleted must not hold its code hostage; restoring it checks for a clash
     * first.
     */
    uniqueIndex("employees_org_code_key").on(t.orgId, t.employeeCode).where(sql`deleted_at is null`),
    index("employees_org_status_idx").on(t.orgId, t.status).where(sql`deleted_at is null`),
    index("employees_org_dept_idx").on(t.orgId, t.departmentId),
    index("employees_org_branch_idx").on(t.orgId, t.branchId),
    index("employees_supervisor_idx").on(t.supervisorId),
    /*
     * The employee search is an ILIKE '%term%' over names, code and email. A
     * b-tree cannot serve a leading wildcard; a trigram index can, so the
     * search stays an index scan as the headcount grows.
     */
    index("employees_search_trgm_idx").using(
      "gin",
      sql`(coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || employee_code || ' ' || coalesce(work_email, '')) gin_trgm_ops`,
    ),
  ],
);

/** The predicate every list of people starts from: not in the recycle bin. */
export const liveEmployee = () => isNull(employees.deletedAt);

/** Currently employed and not deleted — "on strength", in HR's words. */
export const onStrength = () =>
  and(inArray(employees.status, [...EMPLOYED_STATUSES]), isNull(employees.deletedAt))!;

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
    /** The movement that produced this row, when it came from one. */
    movementId: uuid("movement_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("employee_assignments_emp_idx").on(t.employeeId, t.effectiveFrom),
    index("employee_assignments_org_idx").on(t.orgId, t.effectiveFrom),
  ],
);

/* -------------------------------------------------------- transfers & promotions */

export const movementKind = pgEnum("employee_movement_kind", [
  "transfer",
  "promotion",
  "demotion",
  "redesignation",
  "salary_revision",
  "supervisor_change",
]);

export const movementStatus = pgEnum("employee_movement_status", [
  /** Recorded with a future effective date; applied when the date arrives. */
  "scheduled",
  /** Written to the employee row and the assignment history. */
  "applied",
  /** Withdrawn before it took effect. */
  "cancelled",
]);

/**
 * Transfers, promotions and the other dated changes to where somebody sits.
 *
 * Each row holds the placement before and after, so a letter can be printed
 * from it and the history reads as "moved from Kathmandu to Pokhara", not as
 * two snapshots somebody has to diff. Applying one writes the employee row and
 * closes the current `employee_assignments` period, in one transaction.
 *
 * A null `to*` column means "unchanged", never "clear it".
 */
export const employeeMovements = pgTable(
  "employee_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    kind: movementKind("kind").notNull(),
    status: movementStatus("status").notNull().default("scheduled"),
    effectiveDate: date("effective_date").notNull(),

    fromBranchId: uuid("from_branch_id").references(() => branches.id, { onDelete: "set null" }),
    fromDepartmentId: uuid("from_department_id").references(() => departments.id, { onDelete: "set null" }),
    fromDesignationId: uuid("from_designation_id").references(() => designations.id, { onDelete: "set null" }),
    fromGradeId: uuid("from_grade_id").references(() => grades.id, { onDelete: "set null" }),
    fromSupervisorId: uuid("from_supervisor_id").references((): AnyPgColumn => employees.id, { onDelete: "set null" }),
    fromBasicSalary: numeric("from_basic_salary", { precision: 14, scale: 2 }),

    toBranchId: uuid("to_branch_id").references(() => branches.id, { onDelete: "set null" }),
    toDepartmentId: uuid("to_department_id").references(() => departments.id, { onDelete: "set null" }),
    toDesignationId: uuid("to_designation_id").references(() => designations.id, { onDelete: "set null" }),
    toGradeId: uuid("to_grade_id").references(() => grades.id, { onDelete: "set null" }),
    toSupervisorId: uuid("to_supervisor_id").references((): AnyPgColumn => employees.id, { onDelete: "set null" }),
    toBasicSalary: numeric("to_basic_salary", { precision: 14, scale: 2 }),

    reason: text("reason"),
    /** The office order or letter number it was issued under. */
    letterNumber: text("letter_number"),
    createdByUserId: text("created_by_user_id"),
    createdByLabel: text("created_by_label"),
    appliedAt: timestamp("applied_at"),
    cancelledAt: timestamp("cancelled_at"),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("employee_movements_ref_key").on(t.orgId, t.reference),
    index("employee_movements_employee_idx").on(t.employeeId, t.effectiveDate),
    // the scheduler reads "scheduled and due"; keep that a small index
    index("employee_movements_due_idx").on(t.orgId, t.effectiveDate).where(sql`status = 'scheduled'`),
  ],
);

/* ------------------------------------------------------------------ separations */

export const separationKind = pgEnum("separation_kind", [
  "resignation",
  "termination",
  "retirement",
  "contract_end",
  "death",
  "absconding",
]);

export const separationStatus = pgEnum("separation_status", [
  /** Recorded; notice running, clearance under way. */
  "in_progress",
  /** Clearance done and the employee record closed. */
  "completed",
  /** Withdrawn — a resignation taken back, a termination overturned. */
  "cancelled",
]);

export const settlementStatus = pgEnum("settlement_status", ["pending", "processed", "not_applicable"]);

/**
 * Leaving: resignation, termination, retirement and the rest.
 *
 * The employee row only ever held a separation date and a reason, so "who is
 * serving notice", "what have they not handed back" and "has final settlement
 * been paid" were questions for somebody's spreadsheet. This is the case file;
 * completing it is what finally changes the employee's status and closes their
 * login.
 */
export const employeeSeparations = pgTable(
  "employee_separations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    kind: separationKind("kind").notNull(),
    status: separationStatus("status").notNull().default("in_progress"),
    /** When notice was given or the decision communicated. */
    noticeDate: date("notice_date").notNull(),
    /** The last day worked; the separation date written to the employee. */
    lastWorkingDate: date("last_working_date").notNull(),
    reason: text("reason"),
    /** Exit interview notes: why they are going, what would have kept them. */
    exitInterview: text("exit_interview"),
    eligibleForRehire: boolean("eligible_for_rehire").notNull().default(true),
    settlementStatus: settlementStatus("settlement_status").notNull().default("pending"),
    settlementNote: text("settlement_note"),
    createdByUserId: text("created_by_user_id"),
    createdByLabel: text("created_by_label"),
    completedAt: timestamp("completed_at"),
    completedByLabel: text("completed_by_label"),
    cancelledAt: timestamp("cancelled_at"),
    /** The employee status before completion, so a cancellation can put it back. */
    previousStatus: text("previous_status"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("employee_separations_ref_key").on(t.orgId, t.reference),
    // one open case per person: a second resignation while one runs is a mistake
    uniqueIndex("employee_separations_open_key").on(t.employeeId).where(sql`status = 'in_progress'`),
    index("employee_separations_org_idx").on(t.orgId, t.status, t.lastWorkingDate),
  ],
);

export const clearanceStatus = pgEnum("clearance_status", ["pending", "cleared", "waived"]);

/** One line of the no-dues checklist: an owner, an item, and whether it is settled. */
export const separationClearances = pgTable(
  "separation_clearances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    separationId: uuid("separation_id")
      .notNull()
      .references(() => employeeSeparations.id, { onDelete: "cascade" }),
    /** Who signs this line off: IT, Finance, Admin, the line manager. */
    owner: text("owner").notNull(),
    item: text("item").notNull(),
    status: clearanceStatus("status").notNull().default("pending"),
    note: text("note"),
    clearedByLabel: text("cleared_by_label"),
    clearedAt: timestamp("cleared_at"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("separation_clearances_case_idx").on(t.separationId, t.sortOrder)],
);

/* ------------------------------------------------------- profile change requests */

export const profileSection = pgEnum("profile_change_section", [
  "contact",
  "address",
  "emergency",
  "personal",
  "bank",
  "family",
  "qualification",
  "experience",
]);

export const profileChangeStatus = pgEnum("profile_change_status", [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
]);

/**
 * Self-service corrections.
 *
 * An employee never writes their own record. They propose a change; HR sees
 * the before and after side by side and applies or refuses it. `proposed` is
 * the whole new value of the section, `current` what was on file when it was
 * asked for — so a reviewer can tell if the record moved underneath the
 * request, and the audit trail shows both.
 *
 * For family, qualification and experience rows, `targetId` names the row
 * being changed; null means "add a new one", and `action = remove` asks for
 * one to be taken off.
 */
export const profileChangeRequests = pgTable(
  "profile_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    section: profileSection("section").notNull(),
    action: text("action").notNull().default("update"),
    targetId: uuid("target_id"),
    proposed: jsonb("proposed").$type<Record<string, string | boolean | number | null>>().notNull(),
    current: jsonb("current").$type<Record<string, string | boolean | number | null>>(),
    /** Why the employee is asking: "married in Baisakh", "changed bank". */
    note: text("note"),
    status: profileChangeStatus("status").notNull().default("pending"),
    decidedByUserId: text("decided_by_user_id"),
    decidedByLabel: text("decided_by_label"),
    decidedAt: timestamp("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("profile_change_requests_queue_idx").on(t.orgId, t.status, t.createdAt),
    index("profile_change_requests_employee_idx").on(t.employeeId, t.createdAt),
  ],
);

/**
 * Probation outcomes.
 *
 * The legacy system recorded confirmation as two columns on the employee row —
 * `ProbationDate` and `DateOfPermanent` — which answers "is this person
 * confirmed?" and nothing else. It cannot say who decided, on what evidence, or
 * why somebody is still on probation eleven months after joining, because an
 * extension simply overwrote the date and the previous one was gone.
 *
 * This is the decision ledger behind those columns. The employee row still
 * carries the current answer, so every existing query keeps working; this table
 * carries how it got there.
 */
export const probationOutcome = pgEnum("probation_outcome", [
  /** Confirmed into the permanent establishment. */
  "confirmed",
  /** Probation runs longer; `newProbationEndDate` says until when. */
  "extended",
  /** Not confirmed — the engagement ends. */
  "terminated",
]);

export const probationReviews = pgTable(
  "probation_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),

    /** The probation end date this review was answering. */
    probationEndDate: date("probation_end_date"),
    outcome: probationOutcome("outcome").notNull(),
    /** The date the decision takes effect, which is not always the date it was made. */
    effectiveDate: date("effective_date").notNull(),
    /** Only meaningful for `extended`. */
    newProbationEndDate: date("new_probation_end_date"),

    /** Why. Required for anything other than a plain confirmation. */
    remarks: text("remarks"),

    decidedByUserId: text("decided_by_user_id"),
    decidedByLabel: text("decided_by_label"),
    decidedAt: timestamp("decided_at").notNull().defaultNow(),
  },
  (t) => [
    index("probation_reviews_employee_idx").on(t.employeeId, t.decidedAt),
    index("probation_reviews_org_idx").on(t.orgId, t.decidedAt),
  ],
);

export const probationReviewsRelations = relations(probationReviews, ({ one }) => ({
  employee: one(employees, {
    fields: [probationReviews.employeeId],
    references: [employees.id],
  }),
}));

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
  photo: one(files, { fields: [employees.photoFileId], references: [files.id] }),
  probationReviews: many(probationReviews),
}));

export const employeeAssignmentsRelations = relations(employeeAssignments, ({ one }) => ({
  employee: one(employees, {
    fields: [employeeAssignments.employeeId],
    references: [employees.id],
  }),
}));
