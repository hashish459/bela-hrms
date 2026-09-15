/**
 * Attendance demo data: shifts, the roster, and two months of daily records.
 *
 * The records are generated rather than hand-written, because attendance is only
 * a convincing demo when the numbers are internally consistent — the status,
 * worked minutes, lateness and overtime on every row are produced by the same
 * `computeDay` the running application uses. Punch times are jittered from a
 * per-employee habit so some people are reliably early and some are reliably late,
 * which is what makes a late-arrival report worth looking at.
 */
import { and, eq } from "drizzle-orm";
import type { db as Database } from "./client";
import { approvalSteps } from "./schema/leave";
import { attendanceDays, attendanceRequests, shiftAssignments, shifts } from "./schema/attendance";
import { computeDay, fromMinutes, type ShiftRule } from "@/lib/attendance/calc";
import { adToBs, addDays, formatBsKey, isSaturday } from "@/lib/bs";

type Db = typeof Database;

type Employee = {
  id: string;
  employeeCode: string;
  departmentId: string | null;
  supervisorId: string | null;
  dateOfJoin: string;
};

/** Deterministic pseudo-random, so re-seeding produces the same demo. */
function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

export async function seedAttendance(opts: {
  db: Db;
  orgId: string;
  employees: Employee[];
  holidayDates: Set<string>;
  leaveDates: Set<string>;
  today: string;
  days: number;
  log: (step: string, detail?: string) => void;
}) {
  const { db, orgId, employees, holidayDates, leaveDates, today, days, log } = opts;

  // ------------------------------------------------------------- shifts
  const shiftDefs = [
    {
      code: "GEN", name: "General Shift", nameNepali: "सामान्य पालो",
      startTime: "09:00", endTime: "17:00", breakMinutes: 60,
      graceInMinutes: 10, graceOutMinutes: 10,
      fullDayMinutes: 420, halfDayMinutes: 210,
      isNightShift: false, otAfterMinutes: 30, colour: "#0f6e63", isDefault: true,
    },
    {
      code: "MORN", name: "Morning Shift (Plant)", nameNepali: "बिहान पालो",
      startTime: "06:00", endTime: "14:00", breakMinutes: 45,
      graceInMinutes: 5, graceOutMinutes: 5,
      fullDayMinutes: 435, halfDayMinutes: 215,
      isNightShift: false, otAfterMinutes: 15, colour: "#8a5b0c", isDefault: false,
    },
    {
      code: "EVE", name: "Evening Shift (Plant)", nameNepali: "साँझ पालो",
      startTime: "14:00", endTime: "22:00", breakMinutes: 45,
      graceInMinutes: 5, graceOutMinutes: 5,
      fullDayMinutes: 435, halfDayMinutes: 215,
      isNightShift: false, otAfterMinutes: 15, colour: "#2c5f8a", isDefault: false,
    },
    {
      code: "NIGHT", name: "Night Shift (Plant)", nameNepali: "रात पालो",
      startTime: "22:00", endTime: "06:00", breakMinutes: 45,
      graceInMinutes: 5, graceOutMinutes: 5,
      fullDayMinutes: 435, halfDayMinutes: 215,
      isNightShift: true, otAfterMinutes: 15, colour: "#7048a6", isDefault: false,
    },
  ];

  await db
    .insert(shifts)
    .values(shiftDefs.map((s) => ({ orgId, ...s })))
    .onConflictDoNothing();

  const shiftRows = await db.select().from(shifts).where(eq(shifts.orgId, orgId));
  const shiftByCode = new Map(shiftRows.map((s) => [s.code, s as unknown as ShiftRule]));
  log("shifts", shiftDefs.map((s) => s.code).join(", "));

  // ---------------------------------------------------------- assignments
  // Plant staff rotate across morning/evening; everybody else is on General.
  const PLANT_CODES = new Set(["EMP013", "EMP017", "EMP018", "EMP022", "EMP012", "EMP007"]);
  const rosterStart = addDays(today, -(days + 5));

  const existingAssignments = await db
    .select({ employeeId: shiftAssignments.employeeId })
    .from(shiftAssignments)
    .where(eq(shiftAssignments.orgId, orgId));
  const assigned = new Set(existingAssignments.map((a) => a.employeeId));

  const assignmentRows = employees
    .filter((e) => !assigned.has(e.id))
    .map((e, i) => {
      const code = PLANT_CODES.has(e.employeeCode)
        ? i % 2 === 0
          ? "MORN"
          : "EVE"
        : "GEN";
      return {
        orgId,
        employeeId: e.id,
        shiftId: shiftByCode.get(code)!.id,
        effectiveFrom: e.dateOfJoin > rosterStart ? e.dateOfJoin : rosterStart,
        effectiveTo: null,
        note: "Initial roster",
        assignedBy: "seed",
      };
    });

  if (assignmentRows.length) await db.insert(shiftAssignments).values(assignmentRows);
  log("shift assignments", `${assignmentRows.length} employees rostered`);

  // ------------------------------------------------------- daily records
  const shiftOf = new Map<string, ShiftRule>();
  for (const e of employees) {
    const code = PLANT_CODES.has(e.employeeCode)
      ? employees.indexOf(e) % 2 === 0
        ? "MORN"
        : "EVE"
      : "GEN";
    shiftOf.set(e.id, shiftByCode.get(code)!);
  }

  const existingDays = await db
    .select({ employeeId: attendanceDays.employeeId, date: attendanceDays.date })
    .from(attendanceDays)
    .where(eq(attendanceDays.orgId, orgId));
  const haveDay = new Set(existingDays.map((d) => `${d.employeeId}:${d.date}`));

  type Row = typeof attendanceDays.$inferInsert;
  const rows: Row[] = [];

  for (const emp of employees) {
    const shift = shiftOf.get(emp.id)!;
    const rand = seededRandom(emp.employeeCode);

    // a per-person habit: how many minutes off the shift start they usually arrive.
    // Centred so most people are inside the grace window and a few are reliably late.
    const habit = Math.round((rand() - 0.55) * 22);
    // and how reliably they turn up at all
    const absenceRate = 0.012 + rand() * 0.025;

    const shiftStart = Number(shift.startTime.slice(0, 2)) * 60 + Number(shift.startTime.slice(3, 5));
    const shiftEnd = Number(shift.endTime.slice(0, 2)) * 60 + Number(shift.endTime.slice(3, 5));
    const spanMinutes = shift.isNightShift ? shiftEnd + 1440 - shiftStart : shiftEnd - shiftStart;

    for (let i = days; i >= 1; i--) {
      const date = addDays(today, -i);
      if (date < emp.dateOfJoin) continue;
      if (haveDay.has(`${emp.id}:${date}`)) continue;

      const weeklyOff = isSaturday(date);
      const holiday = holidayDates.has(date);
      const onLeave = leaveDates.has(`${emp.id}:${date}`);

      let checkIn: string | null = null;
      let checkOut: string | null = null;
      let source: "device" | "manual" | "system" = "system";

      if (!weeklyOff && !holiday && !onLeave) {
        const roll = rand();
        if (roll > absenceRate) {
          source = "device";
          const inJitter = habit + Math.round((rand() - 0.5) * 26);
          // biased to just over the shift: a short day should be the exception,
          // because the half-day threshold is a real payroll consequence
          const stay = spanMinutes + Math.round(rand() * 75) - 4;
          checkIn = fromMinutes(shiftStart + inJitter);

          // roughly one day in forty, somebody forgets to punch out
          if (rand() > 0.975) checkOut = null;
          else checkOut = fromMinutes(shiftStart + inJitter + Math.max(120, stay));
        }
      }

      const computed = computeDay(shift, checkIn, checkOut, {
        isWeeklyOff: weeklyOff,
        isHoliday: holiday,
        isOnLeave: onLeave,
      });

      rows.push({
        orgId,
        employeeId: emp.id,
        date,
        dateBs: formatBsKey(adToBs(date)),
        shiftId: shift.id,
        checkIn,
        checkOut,
        workedMinutes: computed.workedMinutes,
        lateMinutes: computed.lateMinutes,
        earlyExitMinutes: computed.earlyExitMinutes,
        otMinutes: computed.otMinutes,
        status: computed.status,
        source,
      });
    }
  }

  // chunked so the parameter limit is never a surprise
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(attendanceDays).values(rows.slice(i, i + 500)).onConflictDoNothing();
  }
  log("attendance days", `${rows.length} rows over ${days} days`);

  // --------------------------------------------------- correction requests
  const missing = rows
    .filter((r) => r.status === "missing_punch")
    .slice(0, 4);

  const existingRefs = await db
    .select({ reference: attendanceRequests.reference })
    .from(attendanceRequests)
    .where(eq(attendanceRequests.orgId, orgId));
  let seq = existingRefs.length;

  const empById = new Map(employees.map((e) => [e.id, e]));

  for (const [index, row] of missing.entries()) {
    seq += 1;
    const emp = empById.get(row.employeeId as string)!;
    const shift = shiftOf.get(emp.id)!;
    const reference = `AT-${adToBs(row.date as string).year}-${String(seq).padStart(4, "0")}`;
    const decided = index >= 2;

    const [request] = await db
      .insert(attendanceRequests)
      .values({
        orgId,
        reference,
        employeeId: emp.id,
        date: row.date as string,
        dateBs: row.dateBs as string,
        requestType: "missing_punch",
        requestedCheckIn: row.checkIn as string | null,
        requestedCheckOut: shift.endTime.slice(0, 5),
        previousCheckIn: row.checkIn as string | null,
        previousCheckOut: null,
        reason: "Forgot to punch out — left after completing the shift.",
        status: decided ? "approved" : "pending",
        currentLevel: decided ? null : 1,
        submittedAt: new Date(),
        decidedAt: decided ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning();

    if (!request) continue;

    await db.insert(approvalSteps).values({
      orgId,
      entityType: "attendance_request",
      entityId: request.id,
      level: 1,
      approverEmployeeId: emp.supervisorId,
      approverLabel: "Reporting supervisor",
      decision: decided ? "approved" : "pending",
      decidedAt: decided ? new Date() : null,
    });

    // an approved correction must already be reflected on the day
    if (decided) {
      const computed = computeDay(shift, row.checkIn as string | null, shift.endTime.slice(0, 5), {
        isWeeklyOff: false,
        isHoliday: false,
        isOnLeave: false,
      });
      await db
        .update(attendanceDays)
        .set({
          checkOut: shift.endTime.slice(0, 5),
          workedMinutes: computed.workedMinutes,
          lateMinutes: computed.lateMinutes,
          earlyExitMinutes: computed.earlyExitMinutes,
          otMinutes: computed.otMinutes,
          status: computed.status,
          source: "request",
          remarks: `Corrected by ${reference}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(attendanceDays.employeeId, emp.id),
            eq(attendanceDays.date, row.date as string),
          ),
        );
    }
  }
  log("attendance requests", `${missing.length} raised from missing punches`);
}
