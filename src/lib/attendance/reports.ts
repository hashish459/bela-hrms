import "server-only";

import { and, asc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, EMPLOYED_STATUSES } from "@/db/schema/hr";
import { branches, departments, designations } from "@/db/schema/org";
import { attendanceDays, shifts } from "@/db/schema/attendance";
import { addDays, adToBs, BS_MONTHS, formatBsKey, todayInNepal, weekdayOf } from "@/lib/bs";
import type { ReportFilters, ReportPeriod } from "@/lib/reports/period";
import { holidayMap, leaveMap } from "./index";
import { toMinutes, type AttendanceStatus } from "./calc";

/**
 * The attendance reporting engine.
 *
 * Every report — muster roll, lateness, absenteeism, overtime, exceptions, the
 * department comparison — is a different projection of one thing: the resolved
 * status of every employee on every day of the period. So that is computed once,
 * here, and each screen picks what it needs. Two reports that each did their
 * own counting would eventually disagree about how many days somebody was
 * absent, and a report that disagrees with another report is worse than none.
 *
 * A day with no row resolves exactly the way the monthly sheet resolves it:
 * approved leave, then a holiday, then the weekly off, otherwise "not marked".
 * Days before somebody joined, after they left, and after today are not counted
 * at all — they are nobody's attendance.
 */

/** The database enum has `field_work`; the calculation type predates it. */
export type ReportStatus = AttendanceStatus | "field_work";

export const REPORT_STATUSES: readonly ReportStatus[] = [
  "present",
  "field_work",
  "half_day",
  "absent",
  "on_leave",
  "missing_punch",
  "not_marked",
  "weekly_off",
  "holiday",
];

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  present: "Present",
  field_work: "Field work",
  half_day: "Half day",
  absent: "Absent",
  on_leave: "On leave",
  missing_punch: "Missing punch",
  not_marked: "Not marked",
  weekly_off: "Weekly off",
  holiday: "Holiday",
};

/** One colour per status, as theme tokens, shared by every chart. */
export const REPORT_STATUS_COLOUR: Record<ReportStatus, string> = {
  present: "var(--color-ok)",
  // teal, next to present's green: field work is time at work
  field_work: "var(--color-accent)",
  half_day: "var(--color-warn)",
  absent: "var(--color-danger)",
  // blue, well away from green: the theme's accent and ok are too close to
  // tell apart in a stacked bar, and leave-versus-present is the comparison
  on_leave: "var(--color-info)",
  missing_punch: "var(--color-ink-faint)",
  not_marked: "var(--color-line)",
  weekly_off: "var(--color-sunk)",
  holiday: "var(--color-sunk)",
};

const OFF_DAY: ReadonlySet<ReportStatus> = new Set(["weekly_off", "holiday"]);

/* -------------------------------------------------------------------- types */

export type StatusCounts = Record<ReportStatus, number>;

/** The figures every level of the report shares — employee, department, organisation. */
export type AttendanceMetrics = {
  counts: StatusCounts;
  /** Days in the employment window that were not weekly offs or holidays. */
  scheduledDays: number;
  /**
   * Scheduled days on which the person was expected at work: less approved
   * leave, and less days with no record at all (unknown is not absent).
   */
  expectedDays: number;
  /** Present + field work + half of each half day. */
  attendedDays: number;
  /** What payroll pays for: attended, plus leave, weekly offs and holidays. */
  payableDays: number;
  workedMinutes: number;
  lateDays: number;
  lateMinutes: number;
  earlyExitDays: number;
  earlyExitMinutes: number;
  otDays: number;
  otMinutes: number;
  /** Overtime worked on a weekly off or holiday — usually paid at a higher rate. */
  offDayOtMinutes: number;
  attendanceRate: number | null;
  absenteeismRate: number | null;
  punctualityRate: number | null;
};

export type EmployeeReportRow = AttendanceMetrics & {
  id: string;
  code: string;
  name: string;
  departmentId: string | null;
  department: string | null;
  branchId: string | null;
  branch: string | null;
  designation: string | null;
  /** Calendar days of the period this person was employed for. */
  windowDays: number;
  maxLateMinutes: number;
  /** Separate runs of consecutive absence; off days inside a run do not break it. */
  absenceSpells: number;
  longestAbsence: number;
  /** S² × D — frequent short absences weigh more than one long one. */
  bradford: number;
  avgCheckIn: number | null;
  avgCheckOut: number | null;
  /** Worked minutes per day actually at work. */
  avgWorkedMinutes: number | null;
};

export type DepartmentReportRow = AttendanceMetrics & {
  id: string | null;
  name: string;
  headcount: number;
  employeesLate: number;
  employeesAbsent: number;
  avgBradford: number;
};

export type DailyPoint = {
  date: string;
  dateBs: string;
  weekday: number;
  holidayName: string | null;
  isWeeklyOff: boolean;
  /** People employed on this date. */
  headcount: number;
  counts: StatusCounts;
  lateCount: number;
  otMinutes: number;
  attendanceRate: number | null;
};

export type TrendBucket = {
  label: string;
  sublabel: string;
  from: string;
  to: string;
  /** True when every day in the bucket is a weekly off or holiday. */
  isOff: boolean;
  counts: StatusCounts;
  lateCount: number;
  otMinutes: number;
  attendanceRate: number | null;
};

export type DayInstance = {
  employeeId: string;
  code: string;
  name: string;
  department: string | null;
  date: string;
  dateBs: string;
  status: ReportStatus;
  checkIn: string | null;
  checkOut: string | null;
  shiftCode: string | null;
  lateMinutes: number;
  earlyExitMinutes: number;
  otMinutes: number;
  remarks: string | null;
};

export type AttendanceReport = {
  period: ReportPeriod;
  generatedAt: string;
  totals: AttendanceMetrics & {
    headcount: number;
    employeesLate: number;
    employeesAbsent: number;
    employeesWithOt: number;
  };
  employees: EmployeeReportRow[];
  departments: DepartmentReportRow[];
  daily: DailyPoint[];
  trend: TrendBucket[];
  trendGranularity: "day" | "week" | "month";
  /** Every late arrival in the period, latest first. */
  lateInstances: DayInstance[];
  /** Missing punches and unrecorded working days, excluding today. */
  exceptions: DayInstance[];
  /** Late arrivals per weekday, Sunday first. */
  lateByWeekday: number[];
  /** Late arrivals by how late: ≤15m, 16–30m, 31–60m, over an hour. */
  lateBySeverity: { label: string; count: number }[];
};

/* ------------------------------------------------------------------ helpers */

function emptyCounts(): StatusCounts {
  return {
    present: 0,
    field_work: 0,
    half_day: 0,
    absent: 0,
    on_leave: 0,
    missing_punch: 0,
    not_marked: 0,
    weekly_off: 0,
    holiday: 0,
  };
}

function emptyMetrics(): AttendanceMetrics {
  return {
    counts: emptyCounts(),
    scheduledDays: 0,
    expectedDays: 0,
    attendedDays: 0,
    payableDays: 0,
    workedMinutes: 0,
    lateDays: 0,
    lateMinutes: 0,
    earlyExitDays: 0,
    earlyExitMinutes: 0,
    otDays: 0,
    otMinutes: 0,
    offDayOtMinutes: 0,
    attendanceRate: null,
    absenteeismRate: null,
    punctualityRate: null,
  };
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** Derives the day totals and rates from the raw counts. Mutates and returns. */
function finalise<T extends AttendanceMetrics>(m: T): T {
  const c = m.counts;
  m.scheduledDays =
    c.present + c.field_work + c.half_day + c.absent + c.on_leave + c.missing_punch + c.not_marked;
  m.expectedDays = m.scheduledDays - c.on_leave - c.not_marked;
  m.attendedDays = c.present + c.field_work + c.half_day * 0.5;
  m.payableDays = m.attendedDays + c.on_leave + c.weekly_off + c.holiday;
  m.attendanceRate = ratio(m.attendedDays, m.expectedDays);
  m.absenteeismRate = ratio(c.absent, m.expectedDays);

  // Punctuality is about the days somebody punched in. Field work has no punch
  // to be late for, so it is not in the denominator.
  const punchedIn = c.present + c.half_day;
  m.punctualityRate = ratio(Math.max(0, punchedIn - m.lateDays), punchedIn);
  return m;
}

function addMetrics(into: AttendanceMetrics, from: AttendanceMetrics) {
  for (const s of REPORT_STATUSES) into.counts[s] += from.counts[s];
  into.workedMinutes += from.workedMinutes;
  into.lateDays += from.lateDays;
  into.lateMinutes += from.lateMinutes;
  into.earlyExitDays += from.earlyExitDays;
  into.earlyExitMinutes += from.earlyExitMinutes;
  into.otDays += from.otDays;
  into.otMinutes += from.otMinutes;
  into.offDayOtMinutes += from.offDayOtMinutes;
}

function mean(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

/* ------------------------------------------------------------------- engine */

/**
 * Builds every attendance report for a period and a set of filters.
 *
 * Three reads — the people, their rows for the period, and the holiday and
 * leave calendars — then everything else is arithmetic in memory. At the
 * production headcount a full month is about fourteen thousand employee-days,
 * which is milliseconds; a full year is under two hundred thousand, which is
 * why periods are capped at MAX_REPORT_DAYS.
 */
export async function buildAttendanceReport(
  orgId: string,
  period: ReportPeriod,
  filters: ReportFilters,
): Promise<AttendanceReport> {
  const { from } = period;
  const to = period.effectiveTo;
  const today = todayInNepal();

  const empty: AttendanceReport = {
    period,
    generatedAt: new Date().toISOString(),
    totals: {
      ...finalise(emptyMetrics()),
      headcount: 0,
      employeesLate: 0,
      employeesAbsent: 0,
      employeesWithOt: 0,
    },
    employees: [],
    departments: [],
    daily: [],
    trend: [],
    trendGranularity: "day",
    lateInstances: [],
    exceptions: [],
    lateByWeekday: [0, 0, 0, 0, 0, 0, 0],
    lateBySeverity: [],
  };
  if (!period.hasElapsed) return empty;

  /*
   * Who is in scope: anybody employed for at least one day of the period.
   * That includes people who have since left — a report on Shrawan has to show
   * the person who resigned in Bhadra, or Shrawan's absence total changes
   * depending on when you run it.
   */
  const like = filters.q ? `%${filters.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
  const staff = await db
    .select({
      id: employees.id,
      code: employees.employeeCode,
      name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      dateOfJoin: employees.dateOfJoin,
      separationDate: employees.separationDate,
      departmentId: employees.departmentId,
      department: departments.name,
      branchId: employees.branchId,
      branch: branches.name,
      designation: designations.name,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(
      and(
        eq(employees.orgId, orgId),
        lte(employees.dateOfJoin, to),
        or(isNull(employees.separationDate), gte(employees.separationDate, from)),
        or(
          inArray(employees.status, [...EMPLOYED_STATUSES]),
          gte(employees.separationDate, from),
        ),
        filters.departmentId ? eq(employees.departmentId, filters.departmentId) : undefined,
        filters.branchId ? eq(employees.branchId, filters.branchId) : undefined,
        like
          ? or(
              ilike(employees.employeeCode, like),
              ilike(sql`${employees.firstName} || ' ' || ${employees.lastName}`, like),
            )
          : undefined,
      ),
    )
    .orderBy(asc(employees.employeeCode));

  if (staff.length === 0) return empty;
  const staffIds = staff.map((s) => s.id);

  const [records, hols, leaves] = await Promise.all([
    db
      .select({
        employeeId: attendanceDays.employeeId,
        date: attendanceDays.date,
        status: attendanceDays.status,
        checkIn: attendanceDays.checkIn,
        checkOut: attendanceDays.checkOut,
        workedMinutes: attendanceDays.workedMinutes,
        lateMinutes: attendanceDays.lateMinutes,
        earlyExitMinutes: attendanceDays.earlyExitMinutes,
        otMinutes: attendanceDays.otMinutes,
        remarks: attendanceDays.remarks,
        shiftCode: shifts.code,
      })
      .from(attendanceDays)
      .leftJoin(shifts, eq(shifts.id, attendanceDays.shiftId))
      .where(
        and(
          eq(attendanceDays.orgId, orgId),
          gte(attendanceDays.date, from),
          lte(attendanceDays.date, to),
          inArray(attendanceDays.employeeId, staffIds),
        ),
      ),
    holidayMap(orgId, from, to),
    leaveMap(orgId, from, to, staffIds),
  ]);

  const byKey = new Map(records.map((r) => [`${r.employeeId}:${r.date}`, r]));

  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);

  const daily: DailyPoint[] = dates.map((date) => ({
    date,
    dateBs: formatBsKey(adToBs(date)),
    weekday: weekdayOf(date),
    holidayName: hols.get(date) ?? null,
    isWeeklyOff: weekdayOf(date) === 6,
    headcount: 0,
    counts: emptyCounts(),
    lateCount: 0,
    otMinutes: 0,
    attendanceRate: null,
  }));

  const lateInstances: DayInstance[] = [];
  const exceptions: DayInstance[] = [];
  const lateByWeekday = [0, 0, 0, 0, 0, 0, 0];
  const severity = [0, 0, 0, 0];

  const rows: EmployeeReportRow[] = staff.map((s) => {
    const m = emptyMetrics();
    const start = s.dateOfJoin > from ? s.dateOfJoin : from;
    const end = s.separationDate && s.separationDate < to ? s.separationDate : to;

    let maxLate = 0;
    let spells = 0;
    let run = 0;
    let longest = 0;
    let windowDays = 0;
    const checkIns: number[] = [];
    const checkOuts: number[] = [];

    dates.forEach((date, i) => {
      if (date < start || date > end) return;
      windowDays++;

      const rec = byKey.get(`${s.id}:${date}`);
      const leave = leaves.get(`${s.id}:${date}`);
      const status: ReportStatus =
        (rec?.status as ReportStatus | undefined) ??
        (leave ? "on_leave" : hols.has(date) ? "holiday" : daily[i].isWeeklyOff ? "weekly_off" : "not_marked");

      // Today's punches arrive as the readers are polled. Until they do, an
      // empty today is a day not yet over — not a data gap — so it is left out
      // like a future day rather than counted as "not marked" for everybody.
      if (!rec && status === "not_marked" && date >= today) return;

      m.counts[status]++;
      const point = daily[i];
      point.headcount++;
      point.counts[status]++;

      // absence spells: off days inside a run neither extend nor break it
      if (status === "absent") {
        if (run === 0) spells++;
        run++;
        longest = Math.max(longest, run);
      } else if (!OFF_DAY.has(status)) {
        run = 0;
      }

      if (!rec) {
        if (status === "not_marked" && date < today) {
          exceptions.push(instance(s, date, status, null));
        }
        return;
      }

      m.workedMinutes += rec.workedMinutes;
      if (rec.otMinutes > 0) {
        m.otDays++;
        m.otMinutes += rec.otMinutes;
        point.otMinutes += rec.otMinutes;
        if (OFF_DAY.has(status)) m.offDayOtMinutes += rec.otMinutes;
      }
      if (rec.earlyExitMinutes > 0) {
        m.earlyExitDays++;
        m.earlyExitMinutes += rec.earlyExitMinutes;
      }
      if (rec.lateMinutes > 0) {
        m.lateDays++;
        m.lateMinutes += rec.lateMinutes;
        maxLate = Math.max(maxLate, rec.lateMinutes);
        point.lateCount++;
        lateByWeekday[point.weekday]++;
        severity[rec.lateMinutes <= 15 ? 0 : rec.lateMinutes <= 30 ? 1 : rec.lateMinutes <= 60 ? 2 : 3]++;
        lateInstances.push(instance(s, date, status, rec));
      }

      if (!OFF_DAY.has(status)) {
        const inMin = toMinutes(rec.checkIn);
        const outMin = toMinutes(rec.checkOut);
        if (inMin !== null) checkIns.push(inMin);
        if (outMin !== null) checkOuts.push(outMin);
      }

      if ((status === "missing_punch" || status === "not_marked") && date < today) {
        exceptions.push(instance(s, date, status, rec));
      }
    });

    finalise(m);
    const daysAtWork = m.counts.present + m.counts.half_day;

    return {
      ...m,
      id: s.id,
      code: s.code,
      name: s.name,
      departmentId: s.departmentId,
      department: s.department,
      branchId: s.branchId,
      branch: s.branch,
      designation: s.designation,
      windowDays,
      maxLateMinutes: maxLate,
      absenceSpells: spells,
      longestAbsence: longest,
      bradford: spells * spells * m.counts.absent,
      avgCheckIn: mean(checkIns),
      avgCheckOut: mean(checkOuts),
      avgWorkedMinutes: daysAtWork > 0 ? Math.round(m.workedMinutes / daysAtWork) : null,
    };
  });

  function instance(
    s: (typeof staff)[number],
    date: string,
    status: ReportStatus,
    rec: (typeof records)[number] | null,
  ): DayInstance {
    return {
      employeeId: s.id,
      code: s.code,
      name: s.name,
      department: s.department,
      date,
      dateBs: formatBsKey(adToBs(date)),
      status,
      checkIn: rec?.checkIn ?? null,
      checkOut: rec?.checkOut ?? null,
      shiftCode: rec?.shiftCode ?? null,
      lateMinutes: rec?.lateMinutes ?? 0,
      earlyExitMinutes: rec?.earlyExitMinutes ?? 0,
      otMinutes: rec?.otMinutes ?? 0,
      remarks: rec?.remarks ?? null,
    };
  }

  for (const point of daily) {
    const c = point.counts;
    const expected = c.present + c.field_work + c.half_day + c.absent + c.missing_punch;
    point.attendanceRate = ratio(c.present + c.field_work + c.half_day * 0.5, expected);
  }

  /* --------------------------------------------------------- departments */

  const byDept = new Map<string, DepartmentReportRow>();
  for (const r of rows) {
    const key = r.departmentId ?? "none";
    let d = byDept.get(key);
    if (!d) {
      d = {
        ...emptyMetrics(),
        id: r.departmentId,
        name: r.department ?? "No department",
        headcount: 0,
        employeesLate: 0,
        employeesAbsent: 0,
        avgBradford: 0,
      };
      byDept.set(key, d);
    }
    addMetrics(d, r);
    d.headcount++;
    if (r.lateDays > 0) d.employeesLate++;
    if (r.counts.absent > 0) d.employeesAbsent++;
    d.avgBradford += r.bradford;
  }
  const departmentRows = [...byDept.values()].map((d) => {
    finalise(d);
    d.avgBradford = d.headcount ? Math.round(d.avgBradford / d.headcount) : 0;
    return d;
  });

  /* -------------------------------------------------------------- totals */

  const totals = {
    ...emptyMetrics(),
    headcount: rows.length,
    employeesLate: rows.filter((r) => r.lateDays > 0).length,
    employeesAbsent: rows.filter((r) => r.counts.absent > 0).length,
    employeesWithOt: rows.filter((r) => r.otMinutes > 0).length,
  };
  for (const r of rows) addMetrics(totals, r);
  finalise(totals);

  const { trend, granularity } = bucketTrend(daily);

  lateInstances.sort((a, b) => (a.date === b.date ? b.lateMinutes - a.lateMinutes : a.date < b.date ? 1 : -1));
  exceptions.sort((a, b) => (a.date === b.date ? a.code.localeCompare(b.code) : a.date < b.date ? 1 : -1));

  return {
    period,
    generatedAt: new Date().toISOString(),
    totals,
    employees: rows,
    departments: departmentRows,
    daily,
    trend,
    trendGranularity: granularity,
    lateInstances,
    exceptions,
    lateByWeekday,
    lateBySeverity: [
      { label: "Up to 15 min", count: severity[0] },
      { label: "16–30 min", count: severity[1] },
      { label: "31–60 min", count: severity[2] },
      { label: "Over an hour", count: severity[3] },
    ],
  };
}

/**
 * Axis abbreviations. Not a three-letter slice: Ashadh and Ashwin would both
 * read "Ash", and a 90-day trend spans both of them.
 */
const BS_MONTH_SHORT = ["Bai", "Jes", "Asr", "Shr", "Bha", "Asw", "Kar", "Man", "Pou", "Mag", "Fal", "Cha"];

/**
 * Groups the daily points so a trend chart stays readable: a column per day up
 * to two months, a column per week up to about four, then one per BS month.
 */
function bucketTrend(daily: DailyPoint[]): {
  trend: TrendBucket[];
  granularity: "day" | "week" | "month";
} {
  const granularity = daily.length <= 62 ? "day" : daily.length <= 126 ? "week" : "month";

  const groups: DailyPoint[][] = [];
  if (granularity === "day") {
    for (const p of daily) groups.push([p]);
  } else if (granularity === "week") {
    for (let i = 0; i < daily.length; i += 7) groups.push(daily.slice(i, i + 7));
  } else {
    let current: DailyPoint[] = [];
    let key = "";
    for (const p of daily) {
      const k = p.dateBs.slice(0, 7);
      if (k !== key && current.length) {
        groups.push(current);
        current = [];
      }
      key = k;
      current.push(p);
    }
    if (current.length) groups.push(current);
  }

  const trend = groups.map((g) => {
    const counts = emptyCounts();
    let lateCount = 0;
    let otMinutes = 0;
    for (const p of g) {
      for (const s of REPORT_STATUSES) counts[s] += p.counts[s];
      lateCount += p.lateCount;
      otMinutes += p.otMinutes;
    }
    const expected = counts.present + counts.field_work + counts.half_day + counts.absent + counts.missing_punch;
    const firstBs = adToBs(g[0].date);

    let label: string;
    let sublabel: string;
    if (granularity === "day") {
      label = String(firstBs.day);
      sublabel = g[0].date;
    } else if (granularity === "week") {
      label = `${firstBs.day} ${BS_MONTH_SHORT[firstBs.month - 1]}`;
      sublabel = `${g[0].date} – ${g[g.length - 1].date}`;
    } else {
      label = BS_MONTH_SHORT[firstBs.month - 1];
      sublabel = `${BS_MONTHS[firstBs.month - 1]} ${firstBs.year}`;
    }

    return {
      label,
      sublabel,
      from: g[0].date,
      to: g[g.length - 1].date,
      isOff: g.every((p) => p.isWeeklyOff || p.holidayName !== null),
      counts,
      lateCount,
      otMinutes,
      attendanceRate: ratio(counts.present + counts.field_work + counts.half_day * 0.5, expected),
    };
  });

  return { trend, granularity };
}

/* -------------------------------------------------------------- formatting */

/** "92.4%", or "—" when there is nothing to divide by. */
export function formatRate(rate: number | null, digits = 1): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(digits)}%`;
}

/** Minutes as decimal hours, the unit payroll works in: "12.5". */
export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

/** Minutes since midnight as "09:07". */
export function formatClock(minutes: number | null): string {
  if (minutes === null) return "—";
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Half days make fractional totals; show them without a trailing ".0". */
export function formatDayCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Bradford bands, as most UK-derived HR policies set them. They are prompts for
 * a conversation, not triggers for action, and the screen says so.
 */
export function bradfordBand(score: number): { label: string; tone: "ok" | "info" | "warn" | "danger" } {
  if (score >= 400) return { label: "Review", tone: "danger" };
  if (score >= 125) return { label: "Concern", tone: "warn" };
  if (score >= 50) return { label: "Watch", tone: "info" };
  return { label: "Normal", tone: "ok" };
}

/** Tone for an attendance-style rate, where higher is better. */
export function rateTone(rate: number | null): "ok" | "warn" | "danger" | "neutral" {
  if (rate === null) return "neutral";
  if (rate >= 0.95) return "ok";
  if (rate >= 0.85) return "warn";
  return "danger";
}

/* ----------------------------------------------------------------- sorting */

/**
 * Sort keys for employee rows, shared by the screens and the CSV export so the
 * file comes out in the order the table was showing.
 */
export const EMPLOYEE_SORT_KEYS = [
  "code", "name", "department",
  "present", "field", "half", "absent", "leave", "missing", "notMarked", "off",
  "payable", "worked", "rate", "absenteeism", "punctuality",
  "late", "lateMinutes", "maxLate", "avgLate", "early", "earlyMinutes", "avgIn", "avgOut",
  "ot", "otDays", "offDayOt", "avgWorked",
  "bradford", "spells", "longest",
] as const;

export function employeeSortValue(r: EmployeeReportRow, key: string): string | number | null {
  switch (key) {
    case "code": return r.code;
    case "name": return r.name;
    case "department": return r.department;
    case "present": return r.counts.present;
    case "field": return r.counts.field_work;
    case "half": return r.counts.half_day;
    case "absent": return r.counts.absent;
    case "leave": return r.counts.on_leave;
    case "missing": return r.counts.missing_punch;
    case "notMarked": return r.counts.not_marked;
    case "off": return r.counts.weekly_off + r.counts.holiday;
    case "payable": return r.payableDays;
    case "worked": return r.workedMinutes;
    case "rate": return r.attendanceRate;
    case "absenteeism": return r.absenteeismRate;
    case "punctuality": return r.punctualityRate;
    case "late": return r.lateDays;
    case "lateMinutes": return r.lateMinutes;
    case "maxLate": return r.maxLateMinutes;
    case "avgLate": return r.lateDays ? r.lateMinutes / r.lateDays : null;
    case "early": return r.earlyExitDays;
    case "earlyMinutes": return r.earlyExitMinutes;
    case "avgIn": return r.avgCheckIn;
    case "avgOut": return r.avgCheckOut;
    case "ot": return r.otMinutes;
    case "otDays": return r.otDays;
    case "offDayOt": return r.offDayOtMinutes;
    case "avgWorked": return r.avgWorkedMinutes;
    case "bradford": return r.bradford;
    case "spells": return r.absenceSpells;
    case "longest": return r.longestAbsence;
    default: return null;
  }
}

/** Tone for an absence rate, where lower is better. */
export function absenteeismTone(rate: number | null): "ok" | "warn" | "danger" | "neutral" {
  if (rate === null) return "neutral";
  if (rate >= 0.1) return "danger";
  if (rate >= 0.04) return "warn";
  return "ok";
}

export const DEPARTMENT_SORT_KEYS = [
  "name", "headcount", "rate", "absenteeism", "punctuality", "absent", "leave", "late", "ot", "bradford",
] as const;

export function departmentSortValue(d: DepartmentReportRow, key: string): string | number | null {
  switch (key) {
    case "name": return d.name;
    case "headcount": return d.headcount;
    case "rate": return d.attendanceRate;
    case "absenteeism": return d.absenteeismRate;
    case "punctuality": return d.punctualityRate;
    case "absent": return d.counts.absent;
    case "leave": return d.counts.on_leave;
    case "late": return d.lateDays;
    case "ot": return d.otMinutes;
    case "bradford": return d.avgBradford;
    default: return null;
  }
}

/** The departments report opens worst attendance first. */
export const DEPARTMENT_DEFAULT_SORT = { key: "rate", dir: "asc" } as const;
