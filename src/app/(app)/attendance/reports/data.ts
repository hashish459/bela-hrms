import "server-only";

import { requirePermission } from "@/lib/session";
import { todayInNepal } from "@/lib/bs";
import { resolveFilters, resolvePeriod, type SearchParams, type SortState } from "@/lib/reports/period";
import { scopeLine, sortedPage } from "@/lib/reports/paging";
import {
  buildAttendanceReport,
  EMPLOYEE_SORT_KEYS,
  employeeSortValue,
  type AttendanceReport,
  type EmployeeReportRow,
} from "@/lib/attendance/reports";

export { carryFilters, pageRows } from "@/lib/reports/paging";

export const REPORT_PERMISSION = "attendance.record.viewAll";

/**
 * Everything an attendance report page needs, from its search params.
 *
 * The permission check is repeated here rather than trusted to the layout: a
 * layout does not re-run on every navigation, and the page is what holds data.
 */
export async function loadAttendanceReport(params: SearchParams): Promise<{
  report: AttendanceReport;
  scope: string;
  today: string;
}> {
  const viewer = await requirePermission(REPORT_PERMISSION);
  const today = todayInNepal();
  const period = resolvePeriod(params, today);
  const filters = resolveFilters(params);
  const report = await buildAttendanceReport(viewer.orgId, period, filters);
  const first = report.employees[0];
  return {
    report,
    scope: scopeLine(report.period.label, filters, report.totals.headcount, {
      department: first?.department,
      branch: first?.branch,
    }),
    today,
  };
}

/** Sorts and pages employee rows with the attendance sort keys. */
export function sortedEmployeePage(rows: readonly EmployeeReportRow[], params: SearchParams, fallback: SortState) {
  return sortedPage(rows, params, EMPLOYEE_SORT_KEYS, employeeSortValue, fallback);
}
