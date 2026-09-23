import "server-only";

import { requirePermission } from "@/lib/session";
import { todayInNepal } from "@/lib/bs";
import { offsetPage, PAGE_SIZE, sliceOffsetPage, type OffsetPage } from "@/lib/pagination";
import {
  resolveFilters,
  resolvePeriod,
  resolveSort,
  sortRows,
  type SearchParams,
  type SortState,
} from "@/lib/reports/period";
import {
  buildAttendanceReport,
  EMPLOYEE_SORT_KEYS,
  employeeSortValue,
  type AttendanceReport,
  type EmployeeReportRow,
} from "@/lib/attendance/reports";

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
  return { report, scope: scopeLine(report, filters), today };
}

/** "Bhadra 2083 · Finance · matching “ram” · 24 employees". */
export function scopeLine(
  report: AttendanceReport,
  filters: ReturnType<typeof resolveFilters>,
): string {
  const parts = [report.period.label];
  const first = report.employees[0];
  if (filters.departmentId) parts.push(first?.department ?? "Selected department");
  if (filters.branchId) parts.push(first?.branch ?? "Selected branch");
  if (filters.q) parts.push(`matching “${filters.q}”`);
  parts.push(`${report.totals.headcount} ${report.totals.headcount === 1 ? "employee" : "employees"}`);
  return parts.join(" · ");
}

const FILTER_KEYS = ["y", "m", "from", "to", "dept", "branch", "q"];

/**
 * Builds links that keep the current period and filters — to sibling reports,
 * or to an export. Extra query keys (`report=late-days`, `dept=…`) are set on top.
 */
export function carryFilters(params: SearchParams): (path: string, extra?: Record<string, string>) => string {
  return (path, extra) => {
    const query = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = params[k];
      if (typeof v === "string" && v) query.set(k, v);
    }
    // extras win, so a drill-down can replace a carried filter
    for (const [k, v] of Object.entries(extra ?? {})) query.set(k, v);
    const qs = query.toString();
    return qs ? `${path}?${qs}` : path;
  };
}

/**
 * Sorts and pages employee rows. Paging happens after sorting, over every row,
 * so page two of "most absent" continues page one rather than restarting it.
 */
export function sortedEmployeePage(
  rows: readonly EmployeeReportRow[],
  params: SearchParams,
  fallback: SortState,
): { sort: SortState; page: OffsetPage; visible: EmployeeReportRow[]; sorted: EmployeeReportRow[] } {
  const sort = resolveSort(params, EMPLOYEE_SORT_KEYS, fallback);
  const sorted = sortRows(rows, sort, employeeSortValue);
  return { sort, sorted, ...pageRows(sorted, params) };
}

/**
 * One page of rows — or all of them in print mode, because a printed report
 * that silently stops at row 25 is worse than no printout.
 */
export function pageRows<T>(rows: readonly T[], params: SearchParams): { page: OffsetPage; visible: T[] } {
  if (params.print === "1") {
    const all = offsetPage({ total: rows.length, defaultSize: PAGE_SIZE.compact });
    return {
      page: { ...all, size: rows.length, limit: rows.length, to: rows.length, pageCount: 1, hasNext: false },
      visible: [...rows],
    };
  }
  const page = offsetPage({
    page: typeof params.page === "string" ? params.page : null,
    total: rows.length,
    defaultSize: PAGE_SIZE.compact,
  });
  return { page, visible: sliceOffsetPage(rows, page) };
}
