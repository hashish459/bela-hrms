import type { NextRequest } from "next/server";
import { can, getViewer } from "@/lib/session";
import { todayInNepal } from "@/lib/bs";
import { csvResponse, toCsv, type CsvColumn } from "@/lib/reports/csv";
import { resolveFilters, resolvePeriod, resolveSort, sortRows } from "@/lib/reports/period";
import {
  buildLeaveReport,
  LEAVE_STATUS_LABEL,
  leaveEmployeeSortValue,
  type BalanceCell,
  type DepartmentLeaveRow,
  type EmployeeLeaveRow,
  type LeaveDay,
  type LeaveTypeInfo,
  type RequestRow,
  type TypeLeaveRow,
} from "@/modules/leave/reports";
import { balanceSortKeys, historyRows, REPORT_PERMISSION } from "../data";

/**
 * CSV export for every leave report. Same URL as the screen, so the same
 * period, filters and sort — every row, raw numbers, BS and AD dates both.
 */

const d2 = (n: number) => Math.round(n * 100) / 100;
const pct = (r: number | null) => (r === null ? null : Math.round(r * 10000) / 100);
const hours = (h: number | null) => (h === null ? null : Math.round(h * 10) / 10);

const REQUESTS: CsvColumn<RequestRow>[] = [
  { header: "Reference", value: (r) => r.reference },
  { header: "Employee code", value: (r) => r.code },
  { header: "Employee", value: (r) => r.name },
  { header: "Department", value: (r) => r.department },
  { header: "Leave type", value: (r) => r.typeName },
  { header: "From (BS)", value: (r) => r.fromDateBs },
  { header: "To (BS)", value: (r) => r.toDateBs },
  { header: "From (AD)", value: (r) => r.fromDate },
  { header: "To (AD)", value: (r) => r.toDate },
  { header: "Portion", value: (r) => r.portion },
  { header: "Days", value: (r) => d2(r.totalDays) },
  { header: "Days in period", value: (r) => d2(r.daysInPeriod) },
  { header: "Status", value: (r) => LEAVE_STATUS_LABEL[r.status] },
  { header: "Submitted", value: (r) => r.submittedAt },
  { header: "Decided", value: (r) => r.decidedAt },
  { header: "Decision hours", value: (r) => hours(r.turnaroundHours) },
  { header: "Waiting days", value: (r) => r.pendingAgeDays },
  { header: "Waiting on", value: (r) => r.awaiting },
  { header: "Reason", value: (r) => r.reason },
];

type BalanceLine = { e: EmployeeLeaveRow; type: LeaveTypeInfo; c: BalanceCell };

const BALANCES: CsvColumn<BalanceLine>[] = [
  { header: "Employee code", value: (l) => l.e.code },
  { header: "Employee", value: (l) => l.e.name },
  { header: "Department", value: (l) => l.e.department },
  { header: "Leave type", value: (l) => l.type.name },
  { header: "Entitled", value: (l) => d2(l.c.entitled) },
  { header: "Carried forward", value: (l) => d2(l.c.carried) },
  { header: "Used", value: (l) => d2(l.c.used) },
  { header: "Pending", value: (l) => d2(l.c.pending) },
  { header: "Encashed", value: (l) => d2(l.c.encashed) },
  { header: "Available", value: (l) => d2(l.c.available) },
  { header: "At risk of lapsing", value: (l) => d2(l.c.atRisk) },
  { header: "Utilisation %", value: (l) => pct(l.c.utilisation) },
];

const TYPES: CsvColumn<TypeLeaveRow>[] = [
  { header: "Code", value: (r) => r.type.code },
  { header: "Leave type", value: (r) => r.type.name },
  { header: "Nature", value: (r) => r.type.nature },
  { header: "Paid", value: (r) => (r.type.isPaid ? "yes" : "no") },
  { header: "Requests", value: (r) => r.requests },
  { header: "Approved", value: (r) => r.approved },
  { header: "Rejected", value: (r) => r.rejected },
  { header: "Withdrawn", value: (r) => r.cancelled },
  { header: "Pending", value: (r) => r.pending },
  { header: "Days taken in period", value: (r) => d2(r.byType[r.type.id] ?? 0) },
  { header: "People", value: (r) => r.takers },
  { header: "Rejection %", value: (r) => pct(r.rejectionRate) },
  { header: "Entitled (FY)", value: (r) => d2(r.entitled) },
  { header: "Used (FY)", value: (r) => d2(r.used) },
  { header: "Reserved (FY)", value: (r) => d2(r.pendingBalance) },
  { header: "Available (FY)", value: (r) => d2(r.available) },
  { header: "At risk (FY)", value: (r) => d2(r.atRisk) },
  { header: "Utilisation %", value: (r) => pct(r.utilisation) },
];

const DEPARTMENTS: CsvColumn<DepartmentLeaveRow>[] = [
  { header: "Department", value: (d) => d.name },
  { header: "People", value: (d) => d.headcount },
  { header: "People on leave", value: (d) => d.peopleOnLeave },
  { header: "Leave days", value: (d) => d2(d.takenDays) },
  { header: "Days per head", value: (d) => d2(d.daysPerHead) },
  { header: "Unpaid days", value: (d) => d2(d.unpaidDays) },
  { header: "Field work days", value: (d) => d2(d.workingDays) },
  { header: "Pending requests", value: (d) => d.pending },
  { header: "Pending days", value: (d) => d2(d.pendingDays) },
  { header: "Rejected", value: (d) => d.rejected },
];

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Not found", { status: 404 });
  if (!can(viewer, REPORT_PERMISSION)) return new Response("Forbidden", { status: 403 });

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const kind = params.report ?? "balances";
  const period = resolvePeriod(params, todayInNepal());
  const report = await buildLeaveReport(viewer.orgId, period, resolveFilters(params));
  const file = (name: string) => `leave-${name}-${period.slug}.csv`;

  switch (kind) {
    case "balances": {
      const employees = sortRows(
        report.employees,
        resolveSort(params, balanceSortKeys(report), { key: "code", dir: "asc" }),
        leaveEmployeeSortValue,
      );
      const lines: BalanceLine[] = [];
      for (const e of employees) {
        for (const type of report.types) {
          const c = e.balances[type.id];
          if (c) lines.push({ e, type, c });
        }
      }
      return csvResponse(toCsv(lines, BALANCES), file(`balances-fy${report.fiscalYear?.code.replace("/", "-") ?? ""}`));
    }

    case "history":
      return csvResponse(toCsv(historyRows(report, params), REQUESTS), file("history"));

    case "approvals":
      return csvResponse(
        toCsv(
          report.requests.filter((r) => r.status !== "draft"),
          REQUESTS,
        ),
        file("approvals"),
      );

    case "types":
      return csvResponse(toCsv(report.byType, TYPES), file("by-type"));

    case "departments":
      return csvResponse(toCsv(report.departments, DEPARTMENTS), file("departments"));

    case "daily": {
      const typeColumns: CsvColumn<LeaveDay>[] = report.types
        .filter((t) => (report.totals.byType[t.id] ?? 0) > 0)
        .map((t) => ({ header: t.name, value: (d: LeaveDay) => d2(d.byType[t.id] ?? 0) }));
      const DAILY: CsvColumn<LeaveDay>[] = [
        { header: "Date (BS)", value: (d) => d.dateBs },
        { header: "Date (AD)", value: (d) => d.date },
        { header: "Working day", value: (d) => (d.isOff ? "no" : "yes") },
        { header: "People on leave", value: (d) => d.onLeave },
        ...typeColumns,
      ];
      return csvResponse(toCsv(report.days, DAILY), file("daily"));
    }

    default:
      return new Response("Unknown report", { status: 400 });
  }
}
