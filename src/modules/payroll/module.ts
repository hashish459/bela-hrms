import "server-only";

import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { periodLocks } from "@/db/schema/core";
import { register, callPort } from "@/kernel/registry";
import type {
  AttendanceSummary,
  LeavePayrollLine,
  PayrollPort,
} from "@/kernel/ports";

/**
 * Payroll — the period authority, and the worked example of consuming other
 * modules through their contracts.
 *
 * The salary engine itself is not built yet. What is built is the part that
 * matters architecturally: `payableDays()` produces the figures a run needs by
 * asking attendance and leave through their ports, and never touching a table
 * belonging to either.
 *
 * The legacy payroll did the opposite. It joined `attendance_days`,
 * `leave_requests`, `leave_types` and `salary_head_relation` directly, so a
 * change to any of the four broke the monthly run — and the run is the one job
 * that cannot be late.
 */

/** Whether a module's period is closed. Attendance and leave both ask before writing. */
async function isPeriodClosed(
  orgId: string,
  fiscalYearId: string,
  bsMonth: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: periodLocks.id })
    .from(periodLocks)
    .where(
      and(
        eq(periodLocks.orgId, orgId),
        eq(periodLocks.fiscalYearId, fiscalYearId),
        eq(periodLocks.module, "payroll"),
        // a null month locks the whole year
        or(isNull(periodLocks.bsMonth), eq(periodLocks.bsMonth, bsMonth)),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/** One employee's month, as payroll sees it. */
export type PayableMonth = {
  employeeId: string;
  /** Days actually at work, including field work. */
  presentDays: number;
  /** Days absent without approved leave — unpaid, and visible. */
  absentDays: number;
  /** Paid leave days, weighted by the leave type's pay percentage. */
  paidLeaveDays: number;
  /** Unpaid leave days. Deducted in full. */
  unpaidLeaveDays: number;
  /** Overtime minutes, before any ceiling payroll chooses to apply. */
  otMinutes: number;
  /** The lines behind `paidLeaveDays`, so a payslip can itemise them. */
  leaveLines: LeavePayrollLine[];
  /** True when a figure is missing because a module was unavailable. */
  incomplete: boolean;
};

/**
 * The month's payable figures for a set of employees.
 *
 * `incomplete` is the important field. A payroll run that quietly treats an
 * attendance outage as "nobody came to work" pays nobody; one that treats a
 * leave outage as "nobody took leave" overpays everybody. Neither is acceptable,
 * so the shape of the answer says when it cannot be trusted and the caller
 * refuses to post.
 */
export async function payableDays(
  orgId: string,
  employeeIds: string[],
  from: string,
  to: string,
): Promise<PayableMonth[]> {
  if (employeeIds.length === 0) return [];

  const MISSING = Symbol("unavailable");

  const [attendance, leaveLines] = await Promise.all([
    callPort<"attendance", AttendanceSummary[] | typeof MISSING>(
      "attendance",
      MISSING,
      (port) => port.summary(orgId, employeeIds, from, to),
      orgId,
    ),
    callPort<"leave", LeavePayrollLine[] | typeof MISSING>(
      "leave",
      MISSING,
      (port) => port.payrollLines(orgId, employeeIds, from, to),
      orgId,
    ),
  ]);

  const attendanceOk = attendance !== MISSING;
  const leaveOk = leaveLines !== MISSING;

  const byEmployee = new Map<string, AttendanceSummary>();
  if (attendanceOk) for (const row of attendance) byEmployee.set(row.employeeId, row);

  const linesByEmployee = new Map<string, LeavePayrollLine[]>();
  if (leaveOk) {
    for (const line of leaveLines) {
      linesByEmployee.set(line.employeeId, [...(linesByEmployee.get(line.employeeId) ?? []), line]);
    }
  }

  return employeeIds.map((employeeId): PayableMonth => {
    const summary = byEmployee.get(employeeId);
    const lines = linesByEmployee.get(employeeId) ?? [];

    let paid = 0;
    let unpaid = 0;
    for (const line of lines) {
      // A pay percentage is what makes half-pay study leave a single number
      // rather than a special case in the salary engine.
      if (line.nature === "unpaid" || line.nature === "absent") unpaid += line.days;
      else paid += line.days * (line.paidPercent / 100);
    }

    return {
      employeeId,
      presentDays: summary ? summary.present : 0,
      absentDays: summary ? summary.absent : 0,
      paidLeaveDays: Number(paid.toFixed(2)),
      unpaidLeaveDays: Number(unpaid.toFixed(2)),
      otMinutes: summary ? summary.otMinutes : 0,
      leaveLines: lines,
      incomplete: !attendanceOk || !leaveOk,
    };
  });
}

export const payrollPort: PayrollPort = { isPeriodClosed };

register({
  id: "payroll",
  version: "0.1.0",
  // Both are optional: the period authority answers with no dependencies at all,
  // and payableDays degrades to an explicitly incomplete answer.
  optional: ["attendance", "leave", "people"],
  port: () => payrollPort,
});
