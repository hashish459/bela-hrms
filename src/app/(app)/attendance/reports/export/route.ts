import type { NextRequest } from "next/server";
import { can, getViewer } from "@/lib/session";
import { todayInNepal } from "@/lib/bs";
import { csvResponse, toCsv, type CsvColumn } from "@/lib/reports/csv";
import { resolveFilters, resolvePeriod, resolveSort, sortRows } from "@/lib/reports/period";
import {
  buildAttendanceReport,
  DEPARTMENT_DEFAULT_SORT,
  DEPARTMENT_SORT_KEYS,
  departmentSortValue,
  EMPLOYEE_SORT_KEYS,
  employeeSortValue,
  formatClock,
  REPORT_STATUS_LABEL,
  type DailyPoint,
  type DayInstance,
  type DepartmentReportRow,
  type EmployeeReportRow,
} from "@/lib/attendance/reports";
import { REPORT_PERMISSION } from "../data";

/**
 * CSV export for every attendance report.
 *
 * Reads the same URL the screen does, so the file holds exactly the period,
 * filters and sort order the reader was looking at — but every row, not one
 * page. Numbers are written raw (decimal hours, fractions, not "92.4%") so a
 * spreadsheet can add them up.
 *
 * A route handler, not a server action: a download is a GET somebody can
 * repeat, bookmark, or fetch from a script with their session cookie.
 */

const rate = (r: number | null) => (r === null ? null : Math.round(r * 10000) / 100);
const hours = (m: number) => Math.round((m / 60) * 100) / 100;
const clock = (m: number | null) => (m === null ? null : formatClock(m));

const IDENTITY: CsvColumn<EmployeeReportRow>[] = [
  { header: "Employee code", value: (r) => r.code },
  { header: "Employee", value: (r) => r.name },
  { header: "Department", value: (r) => r.department },
  { header: "Designation", value: (r) => r.designation },
  { header: "Branch", value: (r) => r.branch },
];

const MUSTER: CsvColumn<EmployeeReportRow>[] = [
  ...IDENTITY,
  { header: "Days employed", value: (r) => r.windowDays },
  { header: "Present", value: (r) => r.counts.present },
  { header: "Field work", value: (r) => r.counts.field_work },
  { header: "Half day", value: (r) => r.counts.half_day },
  { header: "Absent", value: (r) => r.counts.absent },
  { header: "On leave", value: (r) => r.counts.on_leave },
  { header: "Missing punch", value: (r) => r.counts.missing_punch },
  { header: "Not marked", value: (r) => r.counts.not_marked },
  { header: "Weekly off", value: (r) => r.counts.weekly_off },
  { header: "Holiday", value: (r) => r.counts.holiday },
  { header: "Expected days", value: (r) => r.expectedDays },
  { header: "Attended days", value: (r) => r.attendedDays },
  { header: "Payable days", value: (r) => r.payableDays },
  { header: "Worked hours", value: (r) => hours(r.workedMinutes) },
  { header: "Late days", value: (r) => r.lateDays },
  { header: "Late minutes", value: (r) => r.lateMinutes },
  { header: "Early exit days", value: (r) => r.earlyExitDays },
  { header: "OT hours", value: (r) => hours(r.otMinutes) },
  { header: "Attendance %", value: (r) => rate(r.attendanceRate) },
];

const LATE: CsvColumn<EmployeeReportRow>[] = [
  ...IDENTITY,
  { header: "Late days", value: (r) => r.lateDays },
  { header: "Late minutes", value: (r) => r.lateMinutes },
  { header: "Average late minutes", value: (r) => (r.lateDays ? Math.round(r.lateMinutes / r.lateDays) : null) },
  { header: "Worst late minutes", value: (r) => r.maxLateMinutes },
  { header: "Early exit days", value: (r) => r.earlyExitDays },
  { header: "Early exit minutes", value: (r) => r.earlyExitMinutes },
  { header: "Average check-in", value: (r) => clock(r.avgCheckIn) },
  { header: "Average check-out", value: (r) => clock(r.avgCheckOut) },
  { header: "Punctuality %", value: (r) => rate(r.punctualityRate) },
];

const ABSENCE: CsvColumn<EmployeeReportRow>[] = [
  ...IDENTITY,
  { header: "Absent days", value: (r) => r.counts.absent },
  { header: "Absence spells", value: (r) => r.absenceSpells },
  { header: "Longest run (days)", value: (r) => r.longestAbsence },
  { header: "Half days", value: (r) => r.counts.half_day },
  { header: "Leave days", value: (r) => r.counts.on_leave },
  { header: "Missing punch", value: (r) => r.counts.missing_punch },
  { header: "Expected days", value: (r) => r.expectedDays },
  { header: "Absenteeism %", value: (r) => rate(r.absenteeismRate) },
  { header: "Bradford factor", value: (r) => r.bradford },
];

const OVERTIME: CsvColumn<EmployeeReportRow>[] = [
  ...IDENTITY,
  { header: "OT days", value: (r) => r.otDays },
  { header: "OT hours", value: (r) => hours(r.otMinutes) },
  { header: "OT hours on days off", value: (r) => hours(r.offDayOtMinutes) },
  { header: "OT hours on working days", value: (r) => hours(r.otMinutes - r.offDayOtMinutes) },
  { header: "Worked hours", value: (r) => hours(r.workedMinutes) },
  { header: "Average day (hours)", value: (r) => (r.avgWorkedMinutes === null ? null : hours(r.avgWorkedMinutes)) },
];

const DEPARTMENTS: CsvColumn<DepartmentReportRow>[] = [
  { header: "Department", value: (d) => d.name },
  { header: "People", value: (d) => d.headcount },
  { header: "Present", value: (d) => d.counts.present },
  { header: "Field work", value: (d) => d.counts.field_work },
  { header: "Half day", value: (d) => d.counts.half_day },
  { header: "Absent", value: (d) => d.counts.absent },
  { header: "People absent", value: (d) => d.employeesAbsent },
  { header: "On leave", value: (d) => d.counts.on_leave },
  { header: "Missing punch", value: (d) => d.counts.missing_punch },
  { header: "Not marked", value: (d) => d.counts.not_marked },
  { header: "Expected days", value: (d) => d.expectedDays },
  { header: "Late days", value: (d) => d.lateDays },
  { header: "People late", value: (d) => d.employeesLate },
  { header: "OT hours", value: (d) => hours(d.otMinutes) },
  { header: "Attendance %", value: (d) => rate(d.attendanceRate) },
  { header: "Absenteeism %", value: (d) => rate(d.absenteeismRate) },
  { header: "Punctuality %", value: (d) => rate(d.punctualityRate) },
  { header: "Average Bradford", value: (d) => d.avgBradford },
];

const DAILY: CsvColumn<DailyPoint>[] = [
  { header: "Date (BS)", value: (d) => d.dateBs },
  { header: "Date (AD)", value: (d) => d.date },
  { header: "Day", value: (d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.weekday] },
  { header: "Holiday", value: (d) => d.holidayName ?? (d.isWeeklyOff ? "Weekly off" : null) },
  { header: "Headcount", value: (d) => d.headcount },
  { header: "Present", value: (d) => d.counts.present },
  { header: "Field work", value: (d) => d.counts.field_work },
  { header: "Half day", value: (d) => d.counts.half_day },
  { header: "Absent", value: (d) => d.counts.absent },
  { header: "On leave", value: (d) => d.counts.on_leave },
  { header: "Missing punch", value: (d) => d.counts.missing_punch },
  { header: "Not marked", value: (d) => d.counts.not_marked },
  { header: "Late arrivals", value: (d) => d.lateCount },
  { header: "OT hours", value: (d) => hours(d.otMinutes) },
  { header: "Attendance %", value: (d) => rate(d.attendanceRate) },
];

const INSTANCES: CsvColumn<DayInstance>[] = [
  { header: "Date (BS)", value: (i) => i.dateBs },
  { header: "Date (AD)", value: (i) => i.date },
  { header: "Employee code", value: (i) => i.code },
  { header: "Employee", value: (i) => i.name },
  { header: "Department", value: (i) => i.department },
  { header: "Status", value: (i) => REPORT_STATUS_LABEL[i.status] },
  { header: "Shift", value: (i) => i.shiftCode },
  { header: "Check-in", value: (i) => i.checkIn?.slice(0, 5) ?? null },
  { header: "Check-out", value: (i) => i.checkOut?.slice(0, 5) ?? null },
  { header: "Late minutes", value: (i) => i.lateMinutes },
  { header: "Early exit minutes", value: (i) => i.earlyExitMinutes },
  { header: "Remarks", value: (i) => i.remarks },
];

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  // 404 rather than 403 without a session, like the file route: an export URL
  // should not confirm to a stranger that it exists.
  if (!viewer) return new Response("Not found", { status: 404 });
  if (!can(viewer, REPORT_PERMISSION)) return new Response("Forbidden", { status: 403 });

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const kind = params.report ?? "muster";

  const period = resolvePeriod(params, todayInNepal());
  const report = await buildAttendanceReport(viewer.orgId, period, resolveFilters(params));
  const file = (name: string) => `attendance-${name}-${period.slug}.csv`;

  const employees = (rows: EmployeeReportRow[], fallback: { key: string; dir: "asc" | "desc" }) =>
    sortRows(rows, resolveSort(params, EMPLOYEE_SORT_KEYS, fallback), employeeSortValue);

  switch (kind) {
    case "muster":
      return csvResponse(toCsv(employees(report.employees, { key: "code", dir: "asc" }), MUSTER), file("muster-roll"));

    case "late": {
      const rows = report.employees.filter((e) => e.lateDays > 0 || e.earlyExitDays > 0);
      return csvResponse(toCsv(employees(rows, { key: "late", dir: "desc" }), LATE), file("late-early"));
    }

    case "late-days":
      return csvResponse(toCsv(report.lateInstances, INSTANCES), file("late-arrivals"));

    case "absence": {
      const rows = report.employees.filter((e) => e.counts.absent > 0 || e.counts.half_day > 0);
      return csvResponse(toCsv(employees(rows, { key: "bradford", dir: "desc" }), ABSENCE), file("absenteeism"));
    }

    case "overtime": {
      const rows = report.employees.filter((e) => e.otMinutes > 0);
      return csvResponse(toCsv(employees(rows, { key: "ot", dir: "desc" }), OVERTIME), file("overtime"));
    }

    case "exceptions": {
      const type = params.type;
      const rows =
        type === "missing_punch" || type === "not_marked"
          ? report.exceptions.filter((e) => e.status === type)
          : report.exceptions;
      return csvResponse(toCsv(rows, INSTANCES), file("exceptions"));
    }

    case "departments":
      return csvResponse(
        toCsv(
          sortRows(report.departments, resolveSort(params, DEPARTMENT_SORT_KEYS, DEPARTMENT_DEFAULT_SORT), departmentSortValue),
          DEPARTMENTS,
        ),
        file("departments"),
      );

    case "daily":
      return csvResponse(toCsv(report.daily, DAILY), file("daily-summary"));

    default:
      return new Response("Unknown report", { status: 400 });
  }
}
