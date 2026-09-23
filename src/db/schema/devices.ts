/**
 * Attendance devices: the readers, who is enrolled on them, and what they push.
 *
 * Reverse-engineered from the system this replaces, where the pipeline was
 * `DeviceRawLog` (184 K rows) → `DeviceLogs` (924 K rows, 155 MB) → attendance.
 * Four things it got right and this keeps:
 *
 *   1. **The raw log is kept, unresolved.** A punch from an enrolment number
 *      nobody recognises is still a punch. Dropping it at the door is how a new
 *      starter's first week silently goes missing.
 *   2. **Deduplication on (device, enrolment, timestamp).** Readers re-send
 *      overlapping windows on every poll — `attend_sp_BulkSaveDeviceRawLog`
 *      deleted duplicates twice, once inside the batch and once against the
 *      table. Here it is a unique constraint instead, so the database enforces
 *      it rather than a procedure remembering to.
 *   3. **An enrolment number is device-scoped.** Legacy tied `AttEnrollID` to a
 *      device *group*, so "user 47" meant different people on different sets of
 *      readers. Modelling the enrolment per device keeps that and also allows
 *      one person to have different numbers on different machines, which the
 *      group model could not express.
 *   4. **Many punches a day, not two.** They pivoted up to ten (`Log1..Log10`)
 *      and took the extremes. People punch at lunch, at the gate and at the
 *      floor reader.
 *
 * What it got wrong and this does not: there was no way to tell whether a
 * reader had stopped reporting. 27 devices, no heartbeat, and a silent one looks
 * exactly like a branch where nobody came to work.
 */
import { relations } from "drizzle-orm";
import {
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./core";
import { branches } from "./org";
import { employees } from "./hr";

/** How somebody identifies themselves to the reader. */
export const deviceKind = pgEnum("attendance_device_kind", [
  "fingerprint",
  "face",
  "card",
  "mobile",
  "kiosk",
]);

/** How the server reaches the device, or the device reaches the server. */
export const deviceConnection = pgEnum("attendance_device_connection", [
  /** The server polls the reader over the network. */
  "tcp_ip",
  /** Physically attached to a machine that uploads on a schedule. */
  "usb",
  /** Serial. Still in use on older readers. */
  "serial",
  /** The device pushes to our endpoint with a token. */
  "cloud_api",
]);

/**
 * What a punch on this reader means.
 *
 * Straight from the legacy `vwDevices` mapping (In Only / Out Only / Alternate
 * InOut / System Direction). A single reader at a door is usually
 * `alternating`; a turnstile pair is one `in_only` and one `out_only`.
 */
export const deviceDirection = pgEnum("attendance_device_direction", [
  "in_only",
  "out_only",
  /** Odd punches are in, even are out, per person per day. */
  "alternating",
  /** The device says which; trust its flag. */
  "device_reported",
]);

export const deviceStatus = pgEnum("attendance_device_status", [
  "active",
  "inactive",
  "maintenance",
]);

export const attendanceDevices = pgTable(
  "attendance_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /** Short human key, quoted in support calls. Unique within the tenant. */
    code: text("code").notNull(),
    name: text("name").notNull(),

    /**
     * Where the reader physically is.
     *
     * This is the relationship that makes the register readable: a branch with
     * no working device is the explanation for a morning of absences, and
     * without the link nobody can see that.
     */
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    location: text("location"),

    kind: deviceKind("kind").notNull().default("fingerprint"),
    connection: deviceConnection("connection").notNull().default("tcp_ip"),
    direction: deviceDirection("direction").notNull().default("alternating"),
    status: deviceStatus("status").notNull().default("active"),

    /** Free text: the legacy enum froze nine models and then the tenth arrived. */
    vendor: text("vendor"),
    model: text("model"),
    serialNumber: text("serial_number"),

    ipAddress: inet("ip_address"),
    port: integer("port"),

    /**
     * How often the device is expected to report. Health is derived from this
     * and `lastSeenAt` rather than stored, so a device cannot be marked healthy
     * and then quietly stop.
     */
    syncIntervalMinutes: integer("sync_interval_minutes").notNull().default(15),
    lastSeenAt: timestamp("last_seen_at"),
    lastSyncAt: timestamp("last_sync_at"),
    /** Set when a sync fails, cleared when one succeeds. */
    lastError: text("last_error"),

    /**
     * For `cloud_api` devices, the SHA-256 of the bearer token they push with.
     *
     * The token itself is shown once, at issue, and never stored — the same
     * reason a password is not. The prefix is kept so a token can be identified
     * in a log or revoked without anybody having to produce it.
     */
    apiKeyHash: text("api_key_hash"),
    apiKeyPrefix: text("api_key_prefix"),
    apiKeyIssuedAt: timestamp("api_key_issued_at"),

    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("attendance_devices_org_code_key").on(t.orgId, t.code),
    index("attendance_devices_org_status_idx").on(t.orgId, t.status),
    index("attendance_devices_branch_idx").on(t.branchId),
  ],
);

/**
 * Which employee a device's enrolment number refers to.
 *
 * The reader does not know names. It knows that finger template 47 was
 * presented, and 47 means whoever was enrolled as 47 **on that reader**. This
 * table is the only thing that turns a punch into a person, which makes an
 * employee with punches but no enrolment row the single most common cause of
 * "the machine is not recording me".
 */
export const deviceEnrolments = pgTable(
  "attendance_device_enrolments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => attendanceDevices.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),

    /**
     * Text, not an integer, although every reader met so far uses numbers.
     * Card readers emit hex, and a leading zero is significant on some of them.
     */
    enrollNumber: text("enroll_number").notNull(),

    enrolledAt: timestamp("enrolled_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // The device cannot tell two people apart if they share a number.
    unique("device_enrolments_device_number_key").on(t.deviceId, t.enrollNumber),
    // And one person has at most one identity on a given reader.
    unique("device_enrolments_device_employee_key").on(t.deviceId, t.employeeId),
    index("device_enrolments_employee_idx").on(t.employeeId),
    index("device_enrolments_org_idx").on(t.orgId),
  ],
);

/** What happened to a raw punch once the resolver looked at it. */
export const punchStatus = pgEnum("device_punch_status", [
  /** Received, not yet resolved. */
  "pending",
  /** Matched to an employee and folded into their day. */
  "applied",
  /** No enrolment on this device for that number. Kept, and surfaced. */
  "unmatched",
  /**
   * Matched, but the day it belongs to is not ours to write — it was corrected
   * manually, or payroll has locked the period. The punch is evidence, not an
   * instruction to overwrite a decision somebody made.
   */
  "skipped",
]);

export const punchDirection = pgEnum("device_punch_direction", ["in", "out", "unknown"]);

export const devicePunches = pgTable(
  "attendance_device_punches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => attendanceDevices.id, { onDelete: "cascade" }),

    /** Exactly as the device sent it, before any lookup. */
    enrollNumber: text("enroll_number").notNull(),

    /**
     * Resolved at ingestion when possible, and left null when not.
     *
     * Nullable on purpose: a punch from an unknown number is the evidence that
     * somebody's enrolment is missing. Rejecting it would destroy the only
     * record that they were at work.
     */
    employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "set null" }),

    /** The instant of the punch, in the organisation's local wall clock. */
    punchedAt: timestamp("punched_at").notNull(),
    /**
     * The attendance day this punch belongs to.
     *
     * Stored rather than derived because a night shift's 01:00 out-punch belongs
     * to the previous day, and every query that groups punches into days would
     * otherwise have to re-derive that with the shift in hand.
     */
    punchDate: text("punch_date").notNull(),

    direction: punchDirection("direction").notNull().default("unknown"),
    status: punchStatus("status").notNull().default("pending"),

    /** Whatever else the device sent, kept verbatim for when a reader misbehaves. */
    payload: jsonb("payload"),

    receivedAt: timestamp("received_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
    note: text("note"),
  },
  (t) => [
    /*
     * The idempotency guarantee. A reader polled twice, or one that re-sends its
     * last 24 hours on every connection, must not double-count. Legacy did this
     * with two DELETE passes inside a stored procedure; a constraint cannot be
     * forgotten by the next person to write an importer.
     */
    unique("device_punches_unique_reading").on(t.deviceId, t.enrollNumber, t.punchedAt),
    index("device_punches_employee_date_idx").on(t.employeeId, t.punchDate),
    index("device_punches_org_status_idx").on(t.orgId, t.status),
    index("device_punches_device_time_idx").on(t.deviceId, t.punchedAt),
  ],
);

export const attendanceDevicesRelations = relations(attendanceDevices, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [attendanceDevices.orgId],
    references: [organizations.id],
  }),
  branch: one(branches, { fields: [attendanceDevices.branchId], references: [branches.id] }),
  enrolments: many(deviceEnrolments),
  punches: many(devicePunches),
}));

export const deviceEnrolmentsRelations = relations(deviceEnrolments, ({ one }) => ({
  device: one(attendanceDevices, {
    fields: [deviceEnrolments.deviceId],
    references: [attendanceDevices.id],
  }),
  employee: one(employees, {
    fields: [deviceEnrolments.employeeId],
    references: [employees.id],
  }),
}));

export const devicePunchesRelations = relations(devicePunches, ({ one }) => ({
  device: one(attendanceDevices, {
    fields: [devicePunches.deviceId],
    references: [attendanceDevices.id],
  }),
  employee: one(employees, {
    fields: [devicePunches.employeeId],
    references: [employees.id],
  }),
}));
