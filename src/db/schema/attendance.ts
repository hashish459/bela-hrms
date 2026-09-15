/**
 * Attendance: shifts, the daily record, and regularisation requests.
 *
 * Modelled on what the legacy Attendance area actually did (39 controllers, 546
 * actions) minus the parts that had become one-off report scratch space. The
 * shape that matters:
 *
 *   shift            — the pattern: in, out, break, grace, what counts as a half day
 *   shift_assignment — which shift an employee is on, from when
 *   attendance_day   — exactly one row per employee per date, whatever happened
 *   attendance_request — a claim that the row is wrong, on the shared approval engine
 *
 * One row per employee per date, always — including weekly offs, holidays and
 * leave. The legacy schema only wrote rows when somebody punched, so "absent" and
 * "no record yet" were indistinguishable and every report had to guess.
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
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./core";
import { employees } from "./hr";

/**
 * What a given day amounted to. `present` covers a normal worked day even if it
 * was late; lateness is minutes on the row, not a separate status.
 */
export const attendanceStatus = pgEnum("attendance_status", [
  "present",
  "half_day",
  "absent",
  "weekly_off",
  "holiday",
  "on_leave",
  /**
   * Working, but not at a desk — a client visit, a site inspection, travel on
   * the organisation's business. It is a *present* day for pay and for
   * attendance percentage; separating it from `present` is what lets a manager
   * see who was actually in the building.
   *
   * Written from leave requests whose type has nature `official_work` or
   * `transit`. Attendance owns the status; leave only states the nature.
   */
  "field_work",
  "missing_punch",
  "not_marked",
]);

/** Where the row came from, so a manual override is never mistaken for a punch. */
export const attendanceSource = pgEnum("attendance_source", [
  "device",
  "manual",
  "request",
  "system",
]);

export const attendanceRequestType = pgEnum("attendance_request_type", [
  "missing_punch",
  "wrong_time",
  "late_excuse",
  "early_exit",
  "on_duty",
  "overtime",
]);

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameNepali: text("name_nepali"),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    /** Unpaid break, deducted from worked minutes. */
    breakMinutes: integer("break_minutes").notNull().default(60),
    /** Minutes after start before the day counts as late. */
    graceInMinutes: integer("grace_in_minutes").notNull().default(10),
    /** Minutes before end that still count as a full day. */
    graceOutMinutes: integer("grace_out_minutes").notNull().default(10),
    /** Worked minutes at or above this is a full day. */
    fullDayMinutes: integer("full_day_minutes").notNull().default(480),
    /** Worked minutes at or above this, but under full, is a half day. */
    halfDayMinutes: integer("half_day_minutes").notNull().default(240),
    /** Crosses midnight — the out punch belongs to the next calendar day. */
    isNightShift: boolean("is_night_shift").notNull().default(false),
    /** Minutes past the shift end before overtime starts accruing. */
    otAfterMinutes: integer("ot_after_minutes").notNull().default(30),
    colour: text("colour").notNull().default("#0f6e63"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("shifts_org_code_key").on(t.orgId, t.code)],
);

/**
 * Dated shift assignment. `effectiveTo` null means "still current", so a roster
 * change is a new row rather than an edit — attendance already computed against
 * the old shift stays explicable.
 */
export const shiftAssignments = pgTable(
  "shift_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "restrict" }),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    note: text("note"),
    assignedBy: text("assigned_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("shift_assignments_emp_idx").on(t.employeeId, t.effectiveFrom),
    index("shift_assignments_org_idx").on(t.orgId),
  ],
);

/** Exactly one row per employee per date. */
export const attendanceDays = pgTable(
  "attendance_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    /** Denormalised so a month can be listed without converting 30 dates. */
    dateBs: text("date_bs").notNull(),
    shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),

    checkIn: time("check_in"),
    checkOut: time("check_out"),

    /** Net of the unpaid break. */
    workedMinutes: integer("worked_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    earlyExitMinutes: integer("early_exit_minutes").notNull().default(0),
    otMinutes: integer("ot_minutes").notNull().default(0),

    status: attendanceStatus("status").notNull().default("not_marked"),
    source: attendanceSource("source").notNull().default("system"),
    remarks: text("remarks"),

    /** Set once payroll has consumed the period; edits then need a reversal. */
    isLocked: boolean("is_locked").notNull().default(false),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("attendance_days_employee_date_key").on(t.employeeId, t.date),
    index("attendance_days_org_date_idx").on(t.orgId, t.date),
    index("attendance_days_status_idx").on(t.orgId, t.status),
  ],
);

/**
 * A claim that an attendance row is wrong. Approval runs on `approval_steps`
 * with entityType "attendance_request", the same engine leave uses; on approval
 * the requested times are written onto the day and it is recomputed.
 */
export const attendanceRequests = pgTable(
  "attendance_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    dateBs: text("date_bs").notNull(),
    requestType: attendanceRequestType("request_type").notNull(),

    /** What the employee says the times should be. */
    requestedCheckIn: time("requested_check_in"),
    requestedCheckOut: time("requested_check_out"),
    /** What was on the row when they raised it, kept for the audit trail. */
    previousCheckIn: time("previous_check_in"),
    previousCheckOut: time("previous_check_out"),

    reason: text("reason").notNull(),
    /** requestStatus lives in leave.ts; reused rather than duplicated. */
    status: text("status").notNull().default("pending"),
    currentLevel: integer("current_level"),
    submittedAt: timestamp("submitted_at"),
    decidedAt: timestamp("decided_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("attendance_requests_org_reference_key").on(t.orgId, t.reference),
    unique("attendance_requests_employee_date_key").on(t.employeeId, t.date, t.requestType),
    index("attendance_requests_org_status_idx").on(t.orgId, t.status),
  ],
);

export const shiftsRelations = relations(shifts, ({ one, many }) => ({
  organization: one(organizations, { fields: [shifts.orgId], references: [organizations.id] }),
  assignments: many(shiftAssignments),
}));

export const shiftAssignmentsRelations = relations(shiftAssignments, ({ one }) => ({
  employee: one(employees, {
    fields: [shiftAssignments.employeeId],
    references: [employees.id],
  }),
  shift: one(shifts, { fields: [shiftAssignments.shiftId], references: [shifts.id] }),
}));

export const attendanceDaysRelations = relations(attendanceDays, ({ one }) => ({
  employee: one(employees, { fields: [attendanceDays.employeeId], references: [employees.id] }),
  shift: one(shifts, { fields: [attendanceDays.shiftId], references: [shifts.id] }),
}));

export const attendanceRequestsRelations = relations(attendanceRequests, ({ one }) => ({
  employee: one(employees, {
    fields: [attendanceRequests.employeeId],
    references: [employees.id],
  }),
}));
