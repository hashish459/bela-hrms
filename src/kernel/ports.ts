/**
 * Module contracts.
 *
 * This file is the *only* thing one functional module may know about another. It
 * declares types and nothing else — no imports from `@/db`, no imports from any
 * module's internals — so importing a contract can never drag another module's
 * code, schema or failure modes into your bundle.
 *
 * The rules that make the boundary real:
 *
 *   1. A module calls another module only through `resolve(id)`, which returns
 *      `null` when that module is absent, disabled or failed to boot. Every call
 *      site must therefore have an answer to "what do I do without it".
 *   2. Ports return data, never database rows or Drizzle objects. Changing a
 *      table is then a private decision.
 *   3. A port method must not throw for an expected condition. It returns a
 *      result the caller can act on, because a thrown error crosses a module
 *      boundary and that is what takes systems down.
 *
 * Anything that is genuinely shared — organisations, fiscal years, employees,
 * the approval engine, the BS calendar — belongs to the kernel or to `core`, not
 * to a functional module. If two modules need it, it was never module-specific.
 */

/** Stable ids. Adding one here is the only registration step a module needs. */
export type ModuleId =
  | "org"
  | "calendar"
  | "people"
  | "attendance"
  | "leave"
  | "payroll"
  | "notifications";

/* ------------------------------------------------------------------ calendar */

export type DayKind = "working" | "weekly_off" | "holiday";

export type CalendarDay = {
  /** ISO date, Gregorian. */
  date: string;
  /** BS key, e.g. "2083-05-22". */
  dateBs: string;
  kind: DayKind;
  /** Holiday name when kind is "holiday". */
  label: string | null;
};

/**
 * Weekly offs and holidays. Owned by `calendar` because attendance, leave and
 * payroll all need the same answer and must never disagree about it.
 */
export interface CalendarPort {
  /** One entry per date in the range, inclusive. Never throws: an unknown date is "working". */
  days(orgId: string, from: string, to: string, scope?: CalendarScope): Promise<CalendarDay[]>;
  /** Count of working days in the range, after weekly offs and holidays. */
  workingDayCount(orgId: string, from: string, to: string, scope?: CalendarScope): Promise<number>;
}

/** Holidays can be scoped to a branch or a gender group; both are optional filters. */
export type CalendarScope = {
  branchId?: string | null;
  gender?: "male" | "female" | "other" | null;
  employeeId?: string | null;
};

/* -------------------------------------------------------------------- people */

export type SupervisorLink = {
  level: number;
  approverEmployeeId: string | null;
  label: string;
};

export type PersonSummary = {
  id: string;
  code: string;
  fullName: string;
  branchId: string | null;
  departmentId: string | null;
  employmentTypeId: string | null;
  gender: "male" | "female" | "other" | null;
  joinDate: string | null;
  isActive: boolean;
};

/** The employee master. Every module reads people; none of them may write them. */
export interface PeoplePort {
  /** Walks the reporting line. Returns a chain of the requested length, padded with nulls. */
  supervisorChain(employeeId: string, levels: number): Promise<SupervisorLink[]>;
  get(employeeId: string): Promise<PersonSummary | null>;
  list(orgId: string, filter?: { activeOnly?: boolean }): Promise<PersonSummary[]>;
}

/* ---------------------------------------------------------------- attendance */

export type LeaveDayMark = {
  employeeId: string;
  /** ISO dates the leave covers, already excluding weekly offs and holidays. */
  dates: string[];
  leaveRequestId: string;
  leaveTypeName: string;
  isHalfDay: boolean;
  /**
   * What the day is, in leave's vocabulary — "paid", "unpaid", "official_work",
   * "transit", "absent", "holiday", "substitute". Attendance maps it onto a
   * status; payroll maps it onto a pay rule. Deliberately a string rather than
   * an imported union: the two modules share a vocabulary, not a type file.
   */
  nature?: string;
  /** 0-100, what payroll pays for a day of it. Carried so payroll need not ask leave. */
  paidPercent?: number;
};

export type PortResult =
  | { ok: true; affected: number }
  | { ok: false; reason: string };

export type AttendanceSummary = {
  employeeId: string;
  present: number;
  absent: number;
  halfDays: number;
  onLeave: number;
  lateArrivals: number;
  workedMinutes: number;
  otMinutes: number;
};

/**
 * What other modules may ask of attendance. Note what is absent: no way to write
 * a punch, and no way to read the daily rows. Leave marks days and reads totals;
 * that is the whole surface.
 */
export interface AttendancePort {
  /** Stamps approved leave onto the daily record. Idempotent per leaveRequestId. */
  markLeave(orgId: string, mark: LeaveDayMark): Promise<PortResult>;
  /** Reverses a mark when leave is withdrawn or reversed. */
  clearLeave(orgId: string, leaveRequestId: string): Promise<PortResult>;
  /** Period totals, for payroll and dashboards. */
  summary(orgId: string, employeeIds: string[], from: string, to: string): Promise<AttendanceSummary[]>;
}

/* --------------------------------------------------------------------- leave */

export type LeaveDaySpan = {
  employeeId: string;
  fromDate: string;
  toDate: string;
  leaveTypeName: string;
  colour: string | null;
  isHalfDay: boolean;
};

/**
 * What other modules may ask of leave. Attendance uses this to colour the sheet
 * instead of joining `leave_requests` — the join it used to do is why a leave
 * schema change could break the attendance register.
 */
export interface LeavePort {
  /** Approved leave overlapping the range. Empty array when leave is unavailable. */
  approvedSpans(
    orgId: string,
    from: string,
    to: string,
    employeeIds?: string[],
  ): Promise<LeaveDaySpan[]>;
  /** Days consumed per employee in the range, for payroll. */
  consumedDays(
    orgId: string,
    employeeIds: string[],
    from: string,
    to: string,
  ): Promise<{ employeeId: string; paid: number; unpaid: number }[]>;
  /**
   * The pay treatment of the leave each employee took in the period.
   *
   * This is the contract payroll runs against: how many days, at what percentage
   * of which salary heads. Payroll never reads a leave table — it asks this, and
   * gets numbers it can multiply. Empty array when leave is unavailable, which a
   * payroll run must treat as "cannot proceed", not "nobody took leave".
   */
  payrollLines(
    orgId: string,
    employeeIds: string[],
    from: string,
    to: string,
  ): Promise<LeavePayrollLine[]>;
}

export type LeavePayrollLine = {
  employeeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  nature: string;
  days: number;
  /** 0-100 default for heads without an override. */
  paidPercent: number;
  /** Salary head code → percent paid. Payroll ignores codes it does not know. */
  headOverrides: Record<string, number>;
};

/* ----------------------------------------------------------------------- org */

export type OrgUnit = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  kind: OrgUnitKind;
  isActive: boolean;
};

export type OrgUnitKind =
  | "division"
  | "business_unit"
  | "sub_business_unit"
  | "functional_category"
  | "department"
  | "section"
  | "project"
  | "location"
  | "branch";

/** Structure and placement. Read-only to everyone but the org module itself. */
export interface OrgPort {
  units(orgId: string, kind: OrgUnitKind): Promise<OrgUnit[]>;
  /** Resolves a unit and its ancestors, cheapest way to answer "which branch is this under". */
  ancestry(orgId: string, unitId: string): Promise<OrgUnit[]>;
}

/* ------------------------------------------------------------------- payroll */

export interface PayrollPort {
  /** Whether a period is closed to upstream edits. Attendance and leave both ask. */
  isPeriodClosed(orgId: string, fiscalYearId: string, bsMonth: number): Promise<boolean>;
}

/* ------------------------------------------------------------------ port map */

/** The registry is typed off this, so `resolve("leave")` is `LeavePort | null`. */
/* ------------------------------------------------------------- notifications */

/**
 * What any module may ask of notifications: tell people about something, by
 * catalogue key. Reached through callPort, so a module that sends
 * notifications keeps working — silently — when notifications is switched off.
 */
export interface NotificationsPort {
  notify(
    orgId: string,
    key: string,
    input: {
      context: Record<string, string | number | null | undefined>;
      subjectEmployeeId?: string | null;
      approverEmployeeId?: string | null;
      actorUserId?: string | null;
      dedupeKey: string;
    },
  ): Promise<number>;
}

export interface PortMap {
  org: OrgPort;
  calendar: CalendarPort;
  people: PeoplePort;
  attendance: AttendancePort;
  leave: LeavePort;
  payroll: PayrollPort;
  notifications: NotificationsPort;
}
