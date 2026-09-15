import "server-only";

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { attendanceDays } from "@/db/schema/attendance";
import { subscribe } from "@/kernel/events";
import { callPort, register } from "@/kernel/registry";
import type {
  AttendancePort,
  AttendanceSummary,
  CalendarDay,
  LeaveDayMark,
  PortResult,
} from "@/kernel/ports";
import { addDays, adToBs, formatBsKey } from "@/lib/bs";

/**
 * The attendance module's outward face, and its reactions to other modules.
 *
 * Two things happen here, and the split is the point:
 *
 *   • `attendancePort` is what others may *ask* of attendance.
 *   • the subscribers at the bottom are what attendance *does about* things that
 *     happened elsewhere.
 *
 * Leave never calls `markLeave` directly. It commits its own transaction, emits
 * `leave.request.approved`, and returns. Attendance picks the event up
 * afterwards. So an attendance fault delays the marking; it does not roll back
 * an approval the approver has already been told succeeded — which is exactly
 * what the legacy system did, and why approvals there could vanish.
 */

/** A locked day belongs to a closed payroll period and is never rewritten. */
const NOT_LOCKED = eq(attendanceDays.isLocked, false);

/**
 * The daily status a leave nature produces.
 *
 * Leave says what a day *is*; attendance decides what to write for it. Field
 * work and travel are present days — the employee worked, just not here — and
 * counting them as leave is how the legacy system produced attendance
 * percentages that field staff could never meet.
 *
 * An unrecognised nature falls back to `on_leave`: a leave type added by a
 * future release must not crash the subscriber that marks it.
 */
const STATUS_FOR_NATURE: Record<string, AttendanceStatusValue> = {
  official_work: "field_work",
  transit: "field_work",
  paid: "on_leave",
  unpaid: "on_leave",
  substitute: "on_leave",
  absent: "absent",
  holiday: "holiday",
};

type AttendanceStatusValue = (typeof attendanceDays.$inferInsert)["status"] & string;

function statusFor(nature: string | undefined, isHalfDay: boolean): AttendanceStatusValue {
  if (isHalfDay) return "half_day";
  return STATUS_FOR_NATURE[nature ?? "paid"] ?? "on_leave";
}

/**
 * Stamps approved leave onto the daily record.
 *
 * An upsert, because a day with no punch has no row yet and a day that does must
 * keep its punches while changing status. `setWhere` refuses to touch a locked
 * day, so a leave approval can never rewrite a period payroll has already run.
 *
 * Idempotent: replaying the same approval writes the same status and the same
 * remark, which is what makes at-least-once event delivery safe.
 */
async function markLeave(orgId: string, mark: LeaveDayMark): Promise<PortResult> {
  if (mark.dates.length === 0) return { ok: true, affected: 0 };

  const status = statusFor(mark.nature, mark.isHalfDay);
  const remark = `${mark.leaveTypeName} · ${mark.leaveRequestId}`;

  try {
    const affected = await db.transaction(async (tx) => {
      let count = 0;

      for (const date of mark.dates) {
        const result = await tx
          .insert(attendanceDays)
          .values({
            orgId,
            employeeId: mark.employeeId,
            date,
            dateBs: formatBsKey(adToBs(date)),
            status,
            source: "system",
            remarks: remark,
          })
          .onConflictDoUpdate({
            target: [attendanceDays.employeeId, attendanceDays.date],
            set: { status, remarks: remark, updatedAt: new Date() },
            // never overwrite a closed period
            setWhere: eq(attendanceDays.isLocked, false),
          })
          .returning({ id: attendanceDays.id });

        count += result.length;
      }

      return count;
    });

    return { ok: true, affected };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Reverses a marking. Matches on the reference embedded in `remarks` rather than
 * on a foreign key, because attendance must not hold a key into leave's tables —
 * that key is what would make a leave migration an attendance outage.
 */
async function clearLeave(orgId: string, leaveRequestId: string): Promise<PortResult> {
  try {
    const rows = await db
      .update(attendanceDays)
      .set({ status: "not_marked", remarks: null, updatedAt: new Date() })
      .where(
        and(
          eq(attendanceDays.orgId, orgId),
          NOT_LOCKED,
          sql`${attendanceDays.remarks} LIKE ${"%" + leaveRequestId}`,
        ),
      )
      .returning({ id: attendanceDays.id });

    return { ok: true, affected: rows.length };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function summary(
  orgId: string,
  employeeIds: string[],
  from: string,
  to: string,
): Promise<AttendanceSummary[]> {
  if (employeeIds.length === 0) return [];

  const rows = await db
    .select({
      employeeId: attendanceDays.employeeId,
      present: sql<number>`count(*) FILTER (WHERE ${attendanceDays.status} IN ('present','field_work'))::int`,
      absent: sql<number>`count(*) FILTER (WHERE ${attendanceDays.status} = 'absent')::int`,
      halfDays: sql<number>`count(*) FILTER (WHERE ${attendanceDays.status} = 'half_day')::int`,
      onLeave: sql<number>`count(*) FILTER (WHERE ${attendanceDays.status} = 'on_leave')::int`,
      lateArrivals: sql<number>`count(*) FILTER (WHERE ${attendanceDays.lateMinutes} > 0)::int`,
      workedMinutes: sql<number>`coalesce(sum(${attendanceDays.workedMinutes}), 0)::int`,
      otMinutes: sql<number>`coalesce(sum(${attendanceDays.otMinutes}), 0)::int`,
    })
    .from(attendanceDays)
    .where(
      and(
        eq(attendanceDays.orgId, orgId),
        inArray(attendanceDays.employeeId, employeeIds),
        gte(attendanceDays.date, from),
        lte(attendanceDays.date, to),
      ),
    )
    .groupBy(attendanceDays.employeeId);

  return rows;
}

export const attendancePort: AttendancePort = { markLeave, clearLeave, summary };

register({
  id: "attendance",
  version: "1.0.0",
  // Attendance reads the calendar and the reporting line, and degrades without
  // them: no calendar means every day is treated as a working day, which is
  // wrong but visible, rather than a crash.
  optional: ["calendar", "people", "org", "leave"],
  port: () => attendancePort,
});

/* ------------------------------------------------------------- subscriptions */

type ApprovedPayload = {
  leaveRequestId?: string;
  employeeId?: string;
  fromDate?: string;
  toDate?: string;
  leaveTypeName?: string;
  isHalfDay?: boolean;
  /** Leave's vocabulary for what the day is; mapped to a status by statusFor(). */
  nature?: string;
  paidPercent?: number;
  /** Whether the leave type charges holidays and weekly offs inside the span. */
  excludesHolidays?: boolean;
  excludesWeeklyOffs?: boolean;
};

/**
 * Expands a leave span into the days attendance will actually mark.
 *
 * Leave publishes the span and its policy; attendance decides which dates inside
 * it are working days by asking the calendar. A type that *charges* holidays or
 * weekly offs (some long home-leave schemes do) marks them too — which is why
 * the policy travels with the event rather than being assumed here.
 *
 * Without the calendar it marks every date in the span: visibly over-marking
 * rather than silently skipping, the safer failure for a figure a payroll clerk
 * will read.
 */
async function workingDatesIn(
  orgId: string,
  employeeId: string,
  from: string,
  to: string,
  policy: { excludesHolidays: boolean; excludesWeeklyOffs: boolean },
): Promise<string[]> {
  const everyDate = () => {
    const out: string[] = [];
    for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
    return out;
  };

  const days = await callPort("calendar", [] as CalendarDay[], (calendar) =>
    calendar.days(orgId, from, to, { employeeId }),
  );
  if (days.length === 0) return everyDate();

  return days
    .filter((d) => {
      if (d.kind === "holiday") return !policy.excludesHolidays;
      if (d.kind === "weekly_off") return !policy.excludesWeeklyOffs;
      return true;
    })
    .map((d) => d.date);
}

subscribe({
  id: "attendance.mark-approved-leave@1",
  module: "attendance",
  event: "leave.request.approved",
  async run(payload, orgId) {
    const p = payload as ApprovedPayload;
    if (!p.leaveRequestId || !p.employeeId || !p.fromDate || !p.toDate) return;

    const dates = await workingDatesIn(orgId, p.employeeId, p.fromDate, p.toDate, {
      excludesHolidays: p.excludesHolidays ?? true,
      excludesWeeklyOffs: p.excludesWeeklyOffs ?? true,
    });
    if (dates.length === 0) return;

    const result = await markLeave(orgId, {
      employeeId: p.employeeId,
      dates,
      leaveRequestId: p.leaveRequestId,
      leaveTypeName: p.leaveTypeName ?? "Leave",
      isHalfDay: p.isHalfDay ?? false,
      nature: p.nature,
      paidPercent: p.paidPercent,
    });

    // Throwing here is correct: it leaves the event pending so the queue retries
    // it, instead of losing the marking silently.
    if (!result.ok) throw new Error(result.reason);
  },
});

for (const event of ["leave.request.rejected", "leave.request.withdrawn"] as const) {
  subscribe({
    id: `attendance.clear-leave.${event}@1`,
    module: "attendance",
    event,
    async run(payload, orgId) {
      const p = payload as ApprovedPayload;
      if (!p.leaveRequestId) return;
      const result = await clearLeave(orgId, p.leaveRequestId);
      if (!result.ok) throw new Error(result.reason);
    },
  });
}
