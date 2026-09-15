import "server-only";

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { leaveRequests, leaveTypes } from "@/db/schema/leave";
import { register } from "@/kernel/registry";
import type { LeaveDaySpan, LeavePayrollLine, LeavePort } from "@/kernel/ports";
import { payEffects } from "./policy";

/**
 * The leave module's outward face.
 *
 * Note what it does not expose: balances, entitlement rules, the approval chain,
 * or anything writable. Attendance needs to know *which days somebody was on
 * leave*; payroll needs paid and unpaid day counts. Those two questions are the
 * whole contract, and everything else stays private — so the entitlement model
 * can be rewritten (and it will be, for encashment and lapse) without any other
 * module noticing.
 */

export const leavePort: LeavePort = {
  async approvedSpans(orgId, from, to, employeeIds) {
    const rows = await db
      .select({
        employeeId: leaveRequests.employeeId,
        fromDate: leaveRequests.fromDate,
        toDate: leaveRequests.toDate,
        leaveTypeName: leaveTypes.name,
        colour: leaveTypes.colour,
        portion: leaveRequests.portion,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(
        and(
          eq(leaveRequests.orgId, orgId),
          eq(leaveRequests.status, "approved"),
          lte(leaveRequests.fromDate, to),
          gte(leaveRequests.toDate, from),
          employeeIds?.length ? inArray(leaveRequests.employeeId, employeeIds) : undefined,
        ),
      );

    return rows.map(
      (r): LeaveDaySpan => ({
        employeeId: r.employeeId,
        fromDate: r.fromDate,
        toDate: r.toDate,
        leaveTypeName: r.leaveTypeName,
        colour: r.colour,
        isHalfDay: r.portion !== "full",
      }),
    );
  },

  async consumedDays(orgId, employeeIds, from, to) {
    if (employeeIds.length === 0) return [];

    const rows = await db
      .select({
        employeeId: leaveRequests.employeeId,
        days: leaveRequests.totalDays,
        isPaid: leaveTypes.isPaid,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(
        and(
          eq(leaveRequests.orgId, orgId),
          eq(leaveRequests.status, "approved"),
          inArray(leaveRequests.employeeId, employeeIds),
          lte(leaveRequests.fromDate, to),
          gte(leaveRequests.toDate, from),
        ),
      );

    const totals = new Map<string, { employeeId: string; paid: number; unpaid: number }>();
    for (const id of employeeIds) totals.set(id, { employeeId: id, paid: 0, unpaid: 0 });

    for (const row of rows) {
      const entry = totals.get(row.employeeId);
      if (!entry) continue;
      const days = Number(row.days ?? 0);
      if (row.isPaid) entry.paid += days;
      else entry.unpaid += days;
    }

    return [...totals.values()];
  },

  /**
   * The pay treatment of leave taken in a period, per employee and type.
   *
   * One query, joined to the policy, returning numbers payroll can multiply. The
   * legacy payroll re-derived this by reading `leave_requests`, `leave_types`
   * and `salary_head_relation` itself — three joins into another module's
   * tables, which is why a leave schema change used to break a payroll run.
   */
  async payrollLines(orgId, employeeIds, from, to) {
    if (employeeIds.length === 0) return [];

    const rows = await db
      .select({
        employeeId: leaveRequests.employeeId,
        leaveTypeId: leaveTypes.id,
        leaveTypeCode: leaveTypes.code,
        leaveTypeName: leaveTypes.name,
        nature: leaveTypes.nature,
        paidPercent: leaveTypes.paidPercent,
        days: leaveRequests.totalDays,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(
        and(
          eq(leaveRequests.orgId, orgId),
          eq(leaveRequests.status, "approved"),
          inArray(leaveRequests.employeeId, employeeIds),
          lte(leaveRequests.fromDate, to),
          gte(leaveRequests.toDate, from),
        ),
      );

    const effects = await payEffects(orgId);

    // Several requests of the same type in one period are one payroll line.
    const merged = new Map<string, LeavePayrollLine>();
    for (const row of rows) {
      const key = `${row.employeeId}:${row.leaveTypeId}`;
      const existing = merged.get(key);
      if (existing) {
        existing.days += Number(row.days ?? 0);
        continue;
      }
      merged.set(key, {
        employeeId: row.employeeId,
        leaveTypeCode: row.leaveTypeCode,
        leaveTypeName: row.leaveTypeName,
        nature: row.nature,
        days: Number(row.days ?? 0),
        paidPercent: Number(row.paidPercent ?? 100),
        headOverrides: effects.get(row.leaveTypeId)?.headOverrides ?? {},
      });
    }

    return [...merged.values()];
  },
};

register({
  id: "leave",
  version: "1.0.0",
  // Leave works without attendance: an approval still commits, and the day
  // marking arrives through the event queue whenever attendance comes back.
  optional: ["attendance", "calendar", "people"],
  port: () => leavePort,
});
