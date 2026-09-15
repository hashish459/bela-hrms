import "server-only";

import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { holidays } from "@/db/schema/core";
import { employees } from "@/db/schema/hr";
import { approvalSteps } from "@/db/schema/approvals";
import {
  attendanceDays,
  attendanceRequests,
  shiftAssignments,
  shifts,
} from "@/db/schema/attendance";
import { adToBs, addDays, formatBsKey, isSaturday, todayInNepal } from "@/lib/bs";
import { computeDay, toMinutes, type AttendanceStatus, type ShiftRule } from "./calc";
import { resolveChain } from "@/kernel/approvals";
import { callPort } from "@/kernel/registry";
import type { LeaveDaySpan } from "@/kernel/ports";

export * from "./calc";

export const ATTENDANCE_ENTITY = "attendance_request";

export class AttendanceError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "AttendanceError";
  }
}

/* ----------------------------------------------------------------- lookups */

/** The shift each employee is on for a date, from the dated assignments. */
export async function shiftsForDate(
  orgId: string,
  date: string,
  employeeIds?: string[],
): Promise<Map<string, ShiftRule>> {
  const rows = await db
    .select({
      employeeId: shiftAssignments.employeeId,
      effectiveFrom: shiftAssignments.effectiveFrom,
      shift: shifts,
    })
    .from(shiftAssignments)
    .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
    .where(
      and(
        eq(shiftAssignments.orgId, orgId),
        lte(shiftAssignments.effectiveFrom, date),
        or(isNull(shiftAssignments.effectiveTo), gte(shiftAssignments.effectiveTo, date)),
        employeeIds?.length ? inArray(shiftAssignments.employeeId, employeeIds) : undefined,
      ),
    )
    .orderBy(asc(shiftAssignments.employeeId), asc(shiftAssignments.effectiveFrom));

  // later assignments overwrite earlier ones, so the last row per employee wins
  const out = new Map<string, ShiftRule>();
  for (const r of rows) out.set(r.employeeId, r.shift as ShiftRule);
  return out;
}

export async function defaultShift(orgId: string): Promise<ShiftRule | null> {
  const [row] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.orgId, orgId), eq(shifts.isDefault, true), eq(shifts.isActive, true)))
    .limit(1);
  return (row as ShiftRule) ?? null;
}

/** Holiday dates in a window. */
export async function holidayMap(orgId: string, from: string, to: string) {
  const rows = await db
    .select({ date: holidays.date, name: holidays.name })
    .from(holidays)
    .where(
      and(
        eq(holidays.orgId, orgId),
        eq(holidays.isActive, true),
        gte(holidays.date, from),
        lte(holidays.date, to),
      ),
    );
  return new Map(rows.map((r) => [r.date, r.name]));
}

/**
 * Approved leave in a window, per employee and date.
 *
 * Reached through the leave port, not a join. Attendance used to
 * `innerJoin(leave_types)` here, which meant a change to the leave schema broke
 * the attendance register and neither module could be deployed alone.
 *
 * When leave is unavailable the map is empty: the sheet renders without leave
 * colouring rather than failing. A month sheet that is missing a colour is a
 * cosmetic problem; a month sheet that will not load is an operational one.
 */
export async function leaveMap(orgId: string, from: string, to: string, employeeIds?: string[]) {
  const spans = await callPort("leave", [] as LeaveDaySpan[], (leave) =>
    leave.approvedSpans(orgId, from, to, employeeIds),
  );

  const map = new Map<string, { typeName: string; colour: string }>();
  for (const span of spans) {
    for (let d = span.fromDate; d <= span.toDate; d = addDays(d, 1)) {
      map.set(`${span.employeeId}:${d}`, {
        typeName: span.leaveTypeName,
        colour: span.colour ?? "#64748b",
      });
    }
  }
  return map;
}

/* ------------------------------------------------------------- month sheet */

export type MonthDay = {
  date: string;
  dateBs: string;
  weekday: number;
  isWeeklyOff: boolean;
  holidayName: string | null;
  leaveName: string | null;
  leaveColour: string | null;
  record: {
    checkIn: string | null;
    checkOut: string | null;
    workedMinutes: number;
    lateMinutes: number;
    earlyExitMinutes: number;
    otMinutes: number;
    status: AttendanceStatus;
    source: string;
    remarks: string | null;
  } | null;
  shiftName: string | null;
};

export type MonthSummary = {
  present: number;
  halfDay: number;
  absent: number;
  onLeave: number;
  weeklyOff: number;
  holiday: number;
  missingPunch: number;
  lateCount: number;
  totalLateMinutes: number;
  totalOtMinutes: number;
  totalWorkedMinutes: number;
  payableDays: number;
};

/** Every day in a range for one employee, with whatever explains each one. */
export async function monthSheet(
  orgId: string,
  employeeId: string,
  from: string,
  to: string,
): Promise<{ days: MonthDay[]; summary: MonthSummary }> {
  const [records, hols, leaves, shiftMap] = await Promise.all([
    db
      .select({
        day: attendanceDays,
        shiftName: shifts.name,
      })
      .from(attendanceDays)
      .leftJoin(shifts, eq(shifts.id, attendanceDays.shiftId))
      .where(
        and(
          eq(attendanceDays.employeeId, employeeId),
          gte(attendanceDays.date, from),
          lte(attendanceDays.date, to),
        ),
      ),
    holidayMap(orgId, from, to),
    leaveMap(orgId, from, to, [employeeId]),
    shiftsForDate(orgId, to, [employeeId]),
  ]);

  const byDate = new Map(records.map((r) => [r.day.date, r]));
  const fallbackShift = shiftMap.get(employeeId)?.name ?? null;

  const days: MonthDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const rec = byDate.get(d);
    const leave = leaves.get(`${employeeId}:${d}`);
    days.push({
      date: d,
      dateBs: formatBsKey(adToBs(d)),
      weekday: new Date(d).getUTCDay(),
      isWeeklyOff: isSaturday(d),
      holidayName: hols.get(d) ?? null,
      leaveName: leave?.typeName ?? null,
      leaveColour: leave?.colour ?? null,
      shiftName: rec?.shiftName ?? fallbackShift,
      record: rec
        ? {
            checkIn: rec.day.checkIn,
            checkOut: rec.day.checkOut,
            workedMinutes: rec.day.workedMinutes,
            lateMinutes: rec.day.lateMinutes,
            earlyExitMinutes: rec.day.earlyExitMinutes,
            otMinutes: rec.day.otMinutes,
            status: rec.day.status as AttendanceStatus,
            source: rec.day.source,
            remarks: rec.day.remarks,
          }
        : null,
    });
  }

  const summary: MonthSummary = {
    present: 0, halfDay: 0, absent: 0, onLeave: 0, weeklyOff: 0, holiday: 0,
    missingPunch: 0, lateCount: 0, totalLateMinutes: 0, totalOtMinutes: 0,
    totalWorkedMinutes: 0, payableDays: 0,
  };

  for (const d of days) {
    const status: AttendanceStatus =
      d.record?.status ??
      (d.leaveName ? "on_leave" : d.holidayName ? "holiday" : d.isWeeklyOff ? "weekly_off" : "not_marked");

    switch (status) {
      case "present": summary.present++; summary.payableDays += 1; break;
      case "half_day": summary.halfDay++; summary.payableDays += 0.5; break;
      case "absent": summary.absent++; break;
      case "on_leave": summary.onLeave++; summary.payableDays += 1; break;
      case "weekly_off": summary.weeklyOff++; summary.payableDays += 1; break;
      case "holiday": summary.holiday++; summary.payableDays += 1; break;
      case "missing_punch": summary.missingPunch++; break;
    }
    if (d.record) {
      summary.totalWorkedMinutes += d.record.workedMinutes;
      summary.totalOtMinutes += d.record.otMinutes;
      summary.totalLateMinutes += d.record.lateMinutes;
      if (d.record.lateMinutes > 0) summary.lateCount++;
    }
  }

  return { days, summary };
}

/** The Bikram Sambat month containing a date, as a Gregorian range. */
export async function bsMonthRange(dateIso: string) {
  const { bsToAd, daysInBsMonth } = await import("@/lib/bs");
  const bs = adToBs(dateIso);
  const from = bsToAd({ year: bs.year, month: bs.month, day: 1 });
  const to = bsToAd({ year: bs.year, month: bs.month, day: daysInBsMonth(bs.year, bs.month) });
  return { from, to, bsYear: bs.year, bsMonth: bs.month };
}

/* -------------------------------------------------------------- requests */

export type AttendanceRequestInput = {
  orgId: string;
  employeeId: string;
  date: string;
  requestType: "missing_punch" | "wrong_time" | "late_excuse" | "early_exit" | "on_duty" | "overtime";
  requestedCheckIn: string | null;
  requestedCheckOut: string | null;
  reason: string;
};

/** Raises a regularisation request and its approval chain in one transaction. */
export async function submitAttendanceRequest(
  input: AttendanceRequestInput,
): Promise<{ id: string; reference: string }> {
  const today = todayInNepal();
  if (input.date > today) {
    throw new AttendanceError("Attendance cannot be corrected for a future date.", "date");
  }
  if (input.date < addDays(today, -60)) {
    throw new AttendanceError("Corrections are only accepted within 60 days.", "date");
  }

  const needsTimes = input.requestType !== "late_excuse" && input.requestType !== "on_duty";
  if (needsTimes && !input.requestedCheckIn && !input.requestedCheckOut) {
    throw new AttendanceError("Give at least one corrected time.", "requestedCheckIn");
  }
  if (
    input.requestedCheckIn &&
    input.requestedCheckOut &&
    toMinutes(input.requestedCheckOut)! <= toMinutes(input.requestedCheckIn)!
  ) {
    // a night shift is the exception, and it is handled when the day recomputes
    const [existing] = await db
      .select({ shiftId: attendanceDays.shiftId })
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, input.employeeId), eq(attendanceDays.date, input.date)))
      .limit(1);
    const isNight = existing?.shiftId
      ? (await db.select({ n: shifts.isNightShift }).from(shifts).where(eq(shifts.id, existing.shiftId)).limit(1))[0]?.n
      : false;
    if (!isNight) {
      throw new AttendanceError("Check-out must be after check-in.", "requestedCheckOut");
    }
  }

  const [day] = await db
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, input.employeeId), eq(attendanceDays.date, input.date)))
    .limit(1);

  if (day?.isLocked) {
    throw new AttendanceError("That period is locked — payroll has already used it.", "date");
  }

  const duplicate = await db
    .select({ reference: attendanceRequests.reference })
    .from(attendanceRequests)
    .where(
      and(
        eq(attendanceRequests.employeeId, input.employeeId),
        eq(attendanceRequests.date, input.date),
        eq(attendanceRequests.requestType, input.requestType),
        eq(attendanceRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (duplicate.length) {
    throw new AttendanceError(
      `Request ${duplicate[0].reference} for that date is already awaiting a decision.`,
      "date",
    );
  }

  const approvers = await resolveChain(input.employeeId, 1);

  return db.transaction(async (tx) => {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(attendanceRequests)
      .where(eq(attendanceRequests.orgId, input.orgId));
    const reference = `AT-${adToBs(input.date).year}-${String(Number(n) + 1).padStart(4, "0")}`;

    const [request] = await tx
      .insert(attendanceRequests)
      .values({
        orgId: input.orgId,
        reference,
        employeeId: input.employeeId,
        date: input.date,
        dateBs: formatBsKey(adToBs(input.date)),
        requestType: input.requestType,
        requestedCheckIn: input.requestedCheckIn,
        requestedCheckOut: input.requestedCheckOut,
        previousCheckIn: day?.checkIn ?? null,
        previousCheckOut: day?.checkOut ?? null,
        reason: input.reason,
        status: "pending",
        currentLevel: 1,
        submittedAt: new Date(),
      })
      .returning({ id: attendanceRequests.id, reference: attendanceRequests.reference });

    await tx.insert(approvalSteps).values(
      approvers.map((a) => ({
        orgId: input.orgId,
        entityType: ATTENDANCE_ENTITY,
        entityId: request.id,
        level: a.level,
        approverEmployeeId: a.approverEmployeeId,
        approverLabel: a.label,
        decision: "pending" as const,
      })),
    );

    return request;
  });
}

/**
 * Records a decision. Approving writes the corrected times onto the day and
 * recomputes it, in the same transaction — so an approved correction can never
 * be visible while the attendance row still shows the old figures.
 */
export async function decideAttendanceRequest(opts: {
  orgId: string;
  requestId: string;
  decision: "approved" | "rejected";
  comment?: string | null;
  approverEmployeeId: string | null;
  decidedByUserId: string;
  canApproveAnything: boolean;
}): Promise<{ reference: string; finalStatus: string }> {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(attendanceRequests)
      .where(
        and(eq(attendanceRequests.id, opts.requestId), eq(attendanceRequests.orgId, opts.orgId)),
      )
      .limit(1);

    if (!request) throw new AttendanceError("That request no longer exists.");
    if (request.status !== "pending") {
      throw new AttendanceError(`This request is already ${request.status}.`);
    }

    const [step] = await tx
      .select()
      .from(approvalSteps)
      .where(
        and(
          eq(approvalSteps.entityType, ATTENDANCE_ENTITY),
          eq(approvalSteps.entityId, request.id),
          eq(approvalSteps.level, request.currentLevel ?? 1),
        ),
      )
      .limit(1);
    if (!step) throw new AttendanceError("No approval step is outstanding for this request.");

    const isNamedApprover =
      opts.approverEmployeeId !== null && step.approverEmployeeId === opts.approverEmployeeId;
    if (!isNamedApprover && !opts.canApproveAnything) {
      throw new AttendanceError("This request is waiting on somebody else.");
    }

    await tx
      .update(approvalSteps)
      .set({
        decision: opts.decision,
        comment: opts.comment ?? null,
        decidedByUserId: opts.decidedByUserId,
        decidedAt: new Date(),
      })
      .where(eq(approvalSteps.id, step.id));

    if (opts.decision === "rejected") {
      await tx
        .update(attendanceRequests)
        .set({ status: "rejected", currentLevel: null, decidedAt: new Date(), updatedAt: new Date() })
        .where(eq(attendanceRequests.id, request.id));
      return { reference: request.reference, finalStatus: "rejected" };
    }

    const [nextStep] = await tx
      .select({ level: approvalSteps.level })
      .from(approvalSteps)
      .where(
        and(
          eq(approvalSteps.entityType, ATTENDANCE_ENTITY),
          eq(approvalSteps.entityId, request.id),
          eq(approvalSteps.decision, "pending"),
        ),
      )
      .orderBy(asc(approvalSteps.level))
      .limit(1);

    if (nextStep) {
      await tx
        .update(attendanceRequests)
        .set({ currentLevel: nextStep.level, updatedAt: new Date() })
        .where(eq(attendanceRequests.id, request.id));
      return { reference: request.reference, finalStatus: "pending" };
    }

    // apply the correction
    const [day] = await tx
      .select()
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.employeeId, request.employeeId),
          eq(attendanceDays.date, request.date),
        ),
      )
      .limit(1);

    const checkIn = request.requestedCheckIn ?? day?.checkIn ?? null;
    const checkOut = request.requestedCheckOut ?? day?.checkOut ?? null;

    const shiftMap = await shiftsForDate(opts.orgId, request.date, [request.employeeId]);
    const shift = shiftMap.get(request.employeeId) ?? null;
    const hols = await holidayMap(opts.orgId, request.date, request.date);
    const leaves = await leaveMap(opts.orgId, request.date, request.date, [request.employeeId]);

    const computed = computeDay(shift, checkIn, checkOut, {
      isWeeklyOff: isSaturday(request.date),
      isHoliday: hols.has(request.date),
      isOnLeave: leaves.has(`${request.employeeId}:${request.date}`),
    });

    const values = {
      checkIn,
      checkOut,
      shiftId: shift?.id ?? day?.shiftId ?? null,
      workedMinutes: computed.workedMinutes,
      lateMinutes: request.requestType === "late_excuse" ? 0 : computed.lateMinutes,
      earlyExitMinutes: computed.earlyExitMinutes,
      otMinutes: computed.otMinutes,
      status: computed.status,
      source: "request" as const,
      remarks: `Corrected by ${request.reference}`,
      updatedAt: new Date(),
    };

    if (day) {
      await tx.update(attendanceDays).set(values).where(eq(attendanceDays.id, day.id));
    } else {
      await tx.insert(attendanceDays).values({
        orgId: opts.orgId,
        employeeId: request.employeeId,
        date: request.date,
        dateBs: formatBsKey(adToBs(request.date)),
        ...values,
      });
    }

    await tx
      .update(attendanceRequests)
      .set({ status: "approved", currentLevel: null, decidedAt: new Date(), updatedAt: new Date() })
      .where(eq(attendanceRequests.id, request.id));

    return { reference: request.reference, finalStatus: "approved" };
  });
}

/** Requests raised by one employee, most recent first. */
export async function requestsForEmployee(employeeId: string, limit = 25) {
  return db
    .select({
      id: attendanceRequests.id,
      reference: attendanceRequests.reference,
      date: attendanceRequests.date,
      dateBs: attendanceRequests.dateBs,
      requestType: attendanceRequests.requestType,
      requestedCheckIn: attendanceRequests.requestedCheckIn,
      requestedCheckOut: attendanceRequests.requestedCheckOut,
      reason: attendanceRequests.reason,
      status: attendanceRequests.status,
    })
    .from(attendanceRequests)
    .where(eq(attendanceRequests.employeeId, employeeId))
    .orderBy(desc(attendanceRequests.createdAt))
    .limit(limit);
}

export { employees };
