import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, onStrength } from "@/db/schema/hr";
import { departments } from "@/db/schema/org";
import { leaveRequests, leaveTypes } from "@/db/schema/leave";
import { holidays } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { addDays, adToBs, BS_MONTHS, isSaturday, todayInNepal, weekdayOf } from "@/lib/bs";
import { BsMonthNav, bsMonthBounds } from "@/components/bs-month-nav";
import { PageHeader, StatTile } from "@/components/ui";
import { LeaveBoard, type BoardAbsence, type BoardDay } from "./board";

const AD_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const metadata = { title: "Leave calendar" };

/**
 * The team leave calendar: a wall-calendar month and a per-person timeline over
 * the same data, with Saturdays and public holidays marked the Nepali way.
 */
export default async function LeaveCalendarPage({ searchParams }: PageProps<"/leave/calendar">) {
  const viewer = await requirePermission("leave.request.viewAll");
  const params = await searchParams;

  const today = todayInNepal();
  const nowBs = adToBs(today);
  const month = { year: Number(params.y) || nowBs.year, month: Number(params.m) || nowBs.month };
  const { from, to } = bsMonthBounds(month);

  const [absences, hols] = await Promise.all([
    db
      .select({
        requestId: leaveRequests.id,
        reference: leaveRequests.reference,
        employeeId: employees.id,
        code: employees.employeeCode,
        name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        department: departments.name,
        fromDate: leaveRequests.fromDate,
        toDate: leaveRequests.toDate,
        status: leaveRequests.status,
        typeName: leaveTypes.name,
        colour: leaveTypes.colour,
        totalDays: leaveRequests.totalDays,
      })
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(
        and(
          eq(leaveRequests.orgId, viewer.orgId),
          sql`${leaveRequests.status} IN ('approved','pending')`,
          lte(leaveRequests.fromDate, to),
          gte(leaveRequests.toDate, from),
          onStrength(),
        ),
      )
      .orderBy(asc(employees.employeeCode)),

    db
      .select({ date: holidays.date, name: holidays.name })
      .from(holidays)
      .where(and(eq(holidays.orgId, viewer.orgId), gte(holidays.date, from), lte(holidays.date, to))),
  ]);

  const holidayByDate = new Map(hols.map((h) => [h.date, h.name]));
  const days: BoardDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const [, am, ad] = d.split("-").map(Number);
    days.push({ date: d, bsDay: adToBs(d).day, adDay: ad, adMonth: AD_MONTHS[am - 1], weekday: weekdayOf(d), holiday: holidayByDate.get(d) ?? null });
  }

  const list: BoardAbsence[] = absences.map((a) => ({
    id: a.requestId,
    reference: a.reference,
    employeeId: a.employeeId,
    code: a.code,
    name: a.name,
    department: a.department,
    from: a.fromDate,
    to: a.toDate,
    status: a.status === "approved" ? "approved" : "pending",
    typeName: a.typeName,
    colour: a.colour,
    days: String(Number(a.totalDays)),
  }));

  const awayCount = (d: string) => new Set(list.filter((a) => a.from <= d && a.to >= d).map((a) => a.employeeId)).size;
  const peak = days.map((d) => ({ d: d.date, n: awayCount(d.date) })).sort((a, b) => b.n - a.n)[0];
  const people = new Set(list.map((a) => a.employeeId)).size;
  const inMonth = today >= from && today <= to;
  const workingDays = days.filter((d) => !isSaturday(d.date) && !d.holiday).length;
  const monthLabel = BS_MONTHS[month.month - 1];

  return (
    <>
      <PageHeader
        title="Leave calendar"
        description="Who is away, and when. Click a day for the details; arrow keys move between days. Approved is solid, pending is hatched."
        action={<BsMonthNav basePath="/leave/calendar" current={month} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={inMonth ? "Away today" : "People away"}
          value={inMonth ? awayCount(today) : people}
          sub={inMonth ? `${people} away at some point this month` : `in ${monthLabel} ${month.year}`}
          tone="accent"
        />
        <StatTile
          label="Busiest day"
          value={peak?.n ?? 0}
          sub={peak?.n ? `${adToBs(peak.d).day} ${monthLabel}` : "Nobody away"}
          tone={(peak?.n ?? 0) > 3 ? "warn" : "neutral"}
        />
        <StatTile label="Public holidays" value={hols.length} sub={`${workingDays} working days`} tone="info" />
        <StatTile label="Requests" value={list.length} sub={`${list.filter((a) => a.status === "pending").length} still pending`} />
      </div>

      <LeaveBoard key={`${month.year}-${month.month}`} days={days} absences={list} today={today} monthLabel={monthLabel} />

      <p className="mt-3 text-[11px] text-ink-faint">
        Colour is the leave type — click one in the legend to hide it. Saturdays and public holidays are tinted; they are not
        deducted from anybody&apos;s balance.
      </p>
    </>
  );
}
