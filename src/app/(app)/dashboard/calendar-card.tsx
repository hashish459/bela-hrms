import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { holidays } from "@/db/schema/core";
import { leaveRequests, leaveTypes } from "@/db/schema/leave";
import { addDays, todayInNepal } from "@/lib/bs";
import { NepaliCalendar, type CalendarMark } from "@/components/nepali-calendar";

/**
 * The dashboard calendar: loads a year either side of today — the holidays,
 * and for somebody with an employee record their own leave — then hands the
 * rest to the client, which navigates months without asking the server again.
 */
export async function CalendarCard({ orgId, employeeId }: { orgId: string; employeeId: string | null }) {
  const today = todayInNepal();
  const from = addDays(today, -400);
  const to = addDays(today, 400);

  const [holidayRows, leaveRows] = await Promise.all([
    db
      .select({ date: holidays.date, name: holidays.name, nameNepali: holidays.nameNepali, isHalfDay: holidays.isHalfDay })
      .from(holidays)
      .where(and(eq(holidays.orgId, orgId), eq(holidays.isActive, true), gte(holidays.date, from), lte(holidays.date, to)))
      .orderBy(holidays.date),
    employeeId
      ? db
          .select({
            fromDate: leaveRequests.fromDate,
            toDate: leaveRequests.toDate,
            status: leaveRequests.status,
            type: leaveTypes.name,
          })
          .from(leaveRequests)
          .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
          .where(
            and(
              eq(leaveRequests.employeeId, employeeId),
              inArray(leaveRequests.status, ["approved", "pending"]),
              lte(leaveRequests.fromDate, to),
              gte(leaveRequests.toDate, from),
            ),
          )
      : Promise.resolve([]),
  ]);

  const marks: CalendarMark[] = [];
  for (const r of leaveRows) {
    // a request spans at most a few weeks; the cap guards a malformed row
    for (let d = r.fromDate, i = 0; d <= r.toDate && i < 120; d = addDays(d, 1), i++) {
      marks.push({
        date: d,
        label: r.status === "approved" ? `${r.type} (approved)` : `${r.type} — awaiting approval`,
        tone: r.status === "approved" ? "leave" : "pending",
      });
    }
  }

  return <NepaliCalendar today={today} holidays={holidayRows} marks={marks} />;
}
