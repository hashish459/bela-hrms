/**
 * Self service — the employee's own record, and the notice board.
 *
 * The legacy Employee Desk read everything through one `HrmsApi` controller with
 * fifty untyped actions and no authorization attribute on any of them: the
 * employee id arrived as a query parameter, so `?empId=` pointed at anybody.
 * That is the failure this schema and the service above it are shaped to make
 * impossible — every table here is keyed by `employee_id`, and the service
 * resolves that id from the session, never from the request.
 *
 * The four personal tables mirror the profile tabs in the manual: Family
 * Details, Education and Skills, Documents, and the service history that
 * `employee_assignments` already carries.
 *
 * Notices are here rather than in a communications module because the notice
 * board is read from the desk and nowhere else. When a second consumer appears
 * it moves; until then, a module of its own would be a folder with one table.
 */
import { relations } from "drizzle-orm";
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
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./core";
import { branches, departments } from "./org";
import { employees } from "./hr";

export const relationshipKind = pgEnum("relationship_kind", [
  "spouse",
  "son",
  "daughter",
  "father",
  "mother",
  "brother",
  "sister",
  "father_in_law",
  "mother_in_law",
  "guardian",
  "other",
]);

/**
 * Family and dependants.
 *
 * `isDependant` and `isNominee` are separate flags on purpose: a spouse is
 * usually both, an adult child often neither, and insurance and gratuity read
 * different columns. The legacy schema had one `IsFamily` bit and every payroll
 * question about nominees had to be answered by hand.
 */
export const employeeFamily = pgTable(
  "employee_family",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    relationship: relationshipKind("relationship").notNull(),
    dateOfBirth: date("date_of_birth"),
    occupation: text("occupation"),
    contactNumber: text("contact_number"),
    /** Counts for insurance and allowance purposes. */
    isDependant: boolean("is_dependant").notNull().default(false),
    /** Named for gratuity, provident fund and death benefit. */
    isNominee: boolean("is_nominee").notNull().default(false),
    /** Percentage of a benefit this nominee receives; null when not a nominee. */
    nomineeSharePercent: integer("nominee_share_percent"),
    isEmergencyContact: boolean("is_emergency_contact").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("employee_family_employee_idx").on(t.employeeId)],
);

export const qualificationKind = pgEnum("qualification_kind", [
  "education",
  "certification",
  "training",
  "skill",
  "language",
]);

/** Education, certifications, training and skills — one shape, one screen. */
export const employeeQualifications = pgTable(
  "employee_qualifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: qualificationKind("kind").notNull(),
    /** "BSc Computer Science", "AWS Solutions Architect", "Nepali". */
    title: text("title").notNull(),
    /** Awarding body, school, or the training provider. */
    institution: text("institution"),
    /** Percentage, GPA, grade or proficiency, as awarded. */
    result: text("result"),
    completedYear: integer("completed_year"),
    /** Certifications lapse; a null date means it does not. */
    expiresOn: date("expires_on"),
    remarks: text("remarks"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("employee_qualifications_employee_idx").on(t.employeeId, t.kind)],
);

export const documentKind = pgEnum("employee_document_kind", [
  "contract",
  "citizenship",
  "passport",
  "pan",
  "certificate",
  "appraisal",
  "letter",
  "other",
]);

/**
 * Documents held against an employee.
 *
 * `isVisibleToEmployee` is the column that matters. Some documents on a
 * personnel file are for HR only — an investigation note, a reference. The desk
 * filters on it, so "visible on the employee's own profile" is a decision made
 * once when the document is filed, not an omission somebody has to remember
 * every time a screen is written.
 */
export const employeeDocuments = pgTable(
  "employee_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: documentKind("kind").notNull(),
    title: text("title").notNull(),
    /** Where the file lives. Storage is deliberately not this table's business. */
    fileUrl: text("file_url"),
    referenceNumber: text("reference_number"),
    issuedOn: date("issued_on"),
    /** Passports and contracts expire; the desk warns before they do. */
    expiresOn: date("expires_on"),
    isVisibleToEmployee: boolean("is_visible_to_employee").notNull().default(true),
    uploadedBy: text("uploaded_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("employee_documents_employee_idx").on(t.employeeId),
    index("employee_documents_expiry_idx").on(t.orgId, t.expiresOn),
  ],
);

export const noticeAudience = pgEnum("notice_audience", [
  "everyone",
  "branch",
  "department",
]);

export const noticePriority = pgEnum("notice_priority", ["normal", "important", "urgent"]);

/**
 * The notice board.
 *
 * Audience is a discriminator plus a nullable scope id rather than a join table:
 * a notice goes to everyone, to one branch, or to one department, and modelling
 * arbitrary set algebra for a board that has never needed it would be a table
 * nobody can query quickly.
 */
export const notices = pgTable(
  "notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    priority: noticePriority("priority").notNull().default("normal"),
    audience: noticeAudience("audience").notNull().default("everyone"),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "cascade" }),
    /** Shown from this date; lets HR write Friday's notice on Wednesday. */
    publishFrom: date("publish_from").notNull(),
    /** Drops off the board after this date. Null means it stays. */
    publishTo: date("publish_to"),
    /** Pinned notices sort above everything, whatever their date. */
    isPinned: boolean("is_pinned").notNull().default(false),
    attachmentUrl: text("attachment_url"),
    postedBy: text("posted_by"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("notices_org_window_idx").on(t.orgId, t.publishFrom)],
);

/**
 * Who has read what.
 *
 * A row per (notice, employee) rather than a counter, because the question HR
 * actually asks about a safety notice is *which* people have not seen it.
 */
export const noticeReads = pgTable(
  "notice_reads",
  {
    noticeId: uuid("notice_id")
      .notNull()
      .references(() => notices.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at").notNull().defaultNow(),
  },
  (t) => [
    unique("notice_reads_key").on(t.noticeId, t.employeeId),
    index("notice_reads_employee_idx").on(t.employeeId),
  ],
);

export const employeeFamilyRelations = relations(employeeFamily, ({ one }) => ({
  employee: one(employees, { fields: [employeeFamily.employeeId], references: [employees.id] }),
}));

export const employeeQualificationsRelations = relations(employeeQualifications, ({ one }) => ({
  employee: one(employees, {
    fields: [employeeQualifications.employeeId],
    references: [employees.id],
  }),
}));

export const employeeDocumentsRelations = relations(employeeDocuments, ({ one }) => ({
  employee: one(employees, { fields: [employeeDocuments.employeeId], references: [employees.id] }),
}));

export const noticesRelations = relations(notices, ({ one, many }) => ({
  organization: one(organizations, { fields: [notices.orgId], references: [organizations.id] }),
  branch: one(branches, { fields: [notices.branchId], references: [branches.id] }),
  department: one(departments, { fields: [notices.departmentId], references: [departments.id] }),
  reads: many(noticeReads),
}));

export const noticeReadsRelations = relations(noticeReads, ({ one }) => ({
  notice: one(notices, { fields: [noticeReads.noticeId], references: [notices.id] }),
  employee: one(employees, { fields: [noticeReads.employeeId], references: [employees.id] }),
}));
