import "server-only";

import { requirePermission } from "@/lib/session";
import { todayInNepal } from "@/lib/bs";
import { resolveFilters, resolvePeriod, type SearchParams, type SortState } from "@/lib/reports/period";
import { scopeLine, sortedPage } from "@/lib/reports/paging";
import {
  buildLeaveReport,
  type LeaveStatus,
  type RequestRow,
  LEAVE_EMPLOYEE_SORT_KEYS,
  leaveEmployeeSortValue,
  type EmployeeLeaveRow,
  type LeaveReport,
} from "@/modules/leave/reports";

export { carryFilters, pageRows } from "@/lib/reports/paging";

export const REPORT_PERMISSION = "leave.request.viewAll";

/**
 * Everything a leave report page needs, from its search params. The
 * permission is checked here as well as in the layout: the page holds the data.
 */
export async function loadLeaveReport(params: SearchParams): Promise<{
  report: LeaveReport;
  scope: string;
  today: string;
}> {
  const viewer = await requirePermission(REPORT_PERMISSION);
  const today = todayInNepal();
  const period = resolvePeriod(params, today);
  const filters = resolveFilters(params);
  const report = await buildLeaveReport(viewer.orgId, period, filters);
  const first = report.employees[0];
  return {
    report,
    scope: scopeLine(report.period.label, filters, report.headcount, {
      department: first?.department,
      branch: first?.branch,
    }),
    today,
  };
}

/** Sort keys for the balance matrix: the fixed ones, plus one per leave type. */
export function balanceSortKeys(report: LeaveReport): string[] {
  return [...LEAVE_EMPLOYEE_SORT_KEYS, ...report.types.map((t) => `type:${t.id}`)];
}

export function sortedLeaveEmployees(
  rows: readonly EmployeeLeaveRow[],
  params: SearchParams,
  keys: readonly string[],
  fallback: SortState,
) {
  return sortedPage(rows, params, keys, leaveEmployeeSortValue, fallback);
}

/** Leave types that carry a balance worth a column: entitlement, and not field work. */
export function balanceTypes(report: LeaveReport) {
  return report.types.filter(
    (t) => !t.isWorking && report.employees.some((e) => (e.balances[t.id]?.entitled ?? 0) + (e.balances[t.id]?.carried ?? 0) > 0),
  );
}

export const HISTORY_STATUSES: { value: "" | LeaveStatus; label: string }[] = [
  { value: "", label: "All" },
  { value: "approved", label: "Approved" },
  { value: "pending", label: "Pending" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Withdrawn" },
];

/** The history's own filters (`status`, `type`) on top of the shared period and people filters. */
export function historyRows(report: LeaveReport, params: SearchParams): RequestRow[] {
  const status = HISTORY_STATUSES.find((s) => s.value && s.value === params.status)?.value;
  const type = typeof params.type === "string" && report.types.some((t) => t.id === params.type) ? params.type : null;
  return report.requests.filter((r) => (!status || r.status === status) && (!type || r.typeId === type));
}
