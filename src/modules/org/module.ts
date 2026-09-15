import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { remunerationGroups } from "@/db/schema/org-structure";
import { employees } from "@/db/schema/hr";
import { register } from "@/kernel/registry";
import type { OrgPort } from "@/kernel/ports";
import { ancestryOf, listUnits } from "./structure";

/**
 * The organisation module.
 *
 * Owns structure and the policy tables that describe *classes of staff* —
 * remuneration groups above all, because attendance calculation is driven by
 * them. Attendance receives a resolved policy object rather than the row, so
 * adding a column here cannot break attendance.
 */

/** What attendance needs to know about how a person is measured. */
export type AttendancePolicy = {
  attendanceCalcType: "strict_hours" | "average_hours" | "day_wise";
  offDayPolicy: "none" | "as_overtime" | "as_present" | "as_present_and_overtime";
  maxBreakMinutes: number;
  dailyOtLimitMinutes: number | null;
  weeklyOtLimitMinutes: number | null;
  monthlyOtLimitMinutes: number | null;
  offDayOtLimitMinutes: number | null;
  isOvertimePayable: boolean;
  isAttendanceExempt: boolean;
};

/**
 * The policy applied when an employee has no remuneration group. Every field is
 * the conservative reading: strict hours, no overtime on off days, no ceilings.
 * An unconfigured organisation still calculates rather than failing.
 */
export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  attendanceCalcType: "strict_hours",
  offDayPolicy: "none",
  maxBreakMinutes: 60,
  dailyOtLimitMinutes: null,
  weeklyOtLimitMinutes: null,
  monthlyOtLimitMinutes: null,
  offDayOtLimitMinutes: null,
  isOvertimePayable: true,
  isAttendanceExempt: false,
};

/**
 * Resolves the policy for a set of employees in one query. Returns a map keyed
 * by employee id, with the default filled in for anybody unconfigured, so the
 * caller never has to handle a missing entry.
 */
export async function attendancePolicyFor(
  orgId: string,
  employeeIds: string[],
): Promise<Map<string, AttendancePolicy>> {
  const out = new Map<string, AttendancePolicy>();
  if (employeeIds.length === 0) return out;

  const rows = await db
    .select({
      employeeId: employees.id,
      attendanceCalcType: remunerationGroups.attendanceCalcType,
      offDayPolicy: remunerationGroups.offDayPolicy,
      maxBreakMinutes: remunerationGroups.maxBreakMinutes,
      dailyOtLimitMinutes: remunerationGroups.dailyOtLimitMinutes,
      weeklyOtLimitMinutes: remunerationGroups.weeklyOtLimitMinutes,
      monthlyOtLimitMinutes: remunerationGroups.monthlyOtLimitMinutes,
      offDayOtLimitMinutes: remunerationGroups.offDayOtLimitMinutes,
      isOvertimePayable: remunerationGroups.isOvertimePayable,
      isAttendanceExempt: remunerationGroups.isAttendanceExempt,
    })
    .from(employees)
    .leftJoin(remunerationGroups, eq(remunerationGroups.id, employees.remunerationGroupId))
    .where(eq(employees.orgId, orgId));

  for (const row of rows) {
    if (!employeeIds.includes(row.employeeId)) continue;
    out.set(
      row.employeeId,
      row.attendanceCalcType
        ? {
            attendanceCalcType: row.attendanceCalcType,
            offDayPolicy: row.offDayPolicy ?? "none",
            maxBreakMinutes: row.maxBreakMinutes ?? 60,
            dailyOtLimitMinutes: row.dailyOtLimitMinutes,
            weeklyOtLimitMinutes: row.weeklyOtLimitMinutes,
            monthlyOtLimitMinutes: row.monthlyOtLimitMinutes,
            offDayOtLimitMinutes: row.offDayOtLimitMinutes,
            isOvertimePayable: row.isOvertimePayable ?? true,
            isAttendanceExempt: row.isAttendanceExempt ?? false,
          }
        : DEFAULT_ATTENDANCE_POLICY,
    );
  }

  for (const id of employeeIds) if (!out.has(id)) out.set(id, DEFAULT_ATTENDANCE_POLICY);
  return out;
}

/** Remuneration groups for the setup screens. */
export async function listRemunerationGroups(orgId: string) {
  return db
    .select()
    .from(remunerationGroups)
    .where(and(eq(remunerationGroups.orgId, orgId)))
    .orderBy(remunerationGroups.code);
}

export const orgPort: OrgPort = {
  units: (orgId, kind) => listUnits(orgId, kind),
  ancestry: (orgId, unitId) => ancestryOf(orgId, unitId),
};

register({
  id: "org",
  version: "1.0.0",
  port: () => orgPort,
});
