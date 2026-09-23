import Link from "next/link";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, onStrength } from "@/db/schema/hr";
import { departments } from "@/db/schema/org";
import { leaveRequests, leaveTypes } from "@/db/schema/leave";
import { holidays } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { addDays, adToBs, isSaturday, todayInNepal } from "@/lib/bs";
import { BsMonthNav, bsMonthBounds } from "@/components/bs-month-nav";
import { Card, EmptyState, PageHeader, StatTile } from "@/components/ui";

export const metadata = { title: "Leave calendar" };

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

  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const holidayByDate = new Map(hols.map((h) => [h.date, h.name]));

  // one row per person who is away at all this month
  const people = new Map<
    string,
    {
      code: string;
      name: string;
      department: string | null;
      days: Map<string, { colour: string; typeName: string; status: string; reference: string }>;
    }
  >();

  for (const a of absences) {
    let p = people.get(a.employeeId);
    if (!p) {
      p = { code: a.code, name: a.name, department: a.department, days: new Map() };
      people.set(a.employeeId, p);
    }
    const start = a.fromDate > from ? a.fromDate : from;
    const end = a.toDate < to ? a.toDate : to;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      p.days.set(d, {
        colour: a.colour,
        typeName: a.typeName,
        status: a.status,
        reference: a.reference,
      });
    }
  }

  const rows = [...people.entries()];
  const peakDay = dates
    .map((d) => ({ d, n: rows.filter(([, p]) => p.days.has(d)).length }))
    .sort((a, b) => b.n - a.n)[0];

  return (
    <>
      <PageHeader
        title="Leave calendar"
        description="Who is away, and when — approved in solid, pending hatched."
        action={<BsMonthNav basePath="/leave/calendar" current={month} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="People away this month" value={rows.length} tone="accent" />
        <StatTile
          label="Busiest day"
          value={peakDay?.n ?? 0}
          sub={peakDay?.n ? `${adToBs(peakDay.d).day} ${monthName(month.month)} away` : "Nobody away"}
          tone={(peakDay?.n ?? 0) > 3 ? "warn" : "neutral"}
        />
        <StatTile label="Holidays" value={hols.length} tone="info" />
        <StatTile
          label="Absence entries"
          value={absences.length}
          sub={`${absences.filter((a) => a.status === "pending").length} still pending`}
        />
      </div>

      <div className="mt-4">
        {rows.length === 0 ? (
          <Card>
            <EmptyState title="Nobody is on leave this month" />
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border-b border-line bg-sunk px-3 py-2 text-left text-[11px] font-medium tracking-wide text-ink-faint uppercase">
                    Employee
                  </th>
                  {dates.map((d) => {
                    const off = isSaturday(d) || holidayByDate.has(d);
                    return (
                      <th
                        key={d}
                        title={holidayByDate.get(d) ?? undefined}
                        className={`border-b border-line px-0 py-2 text-center text-[10px] font-medium ${
                          off ? "bg-sunk text-ink-faint" : "bg-sunk text-ink-soft"
                        }`}
                      >
                        <span className="tabular block w-6">{adToBs(d).day}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map(([id, p]) => (
                  <tr key={id} className="hover:bg-sunk/40">
                    <td className="sticky left-0 z-10 border-b border-line-soft bg-surface px-3 py-1.5 whitespace-nowrap">
                      <Link
                        href={`/hr/employees/${id}`}
                        className="text-sm font-medium text-ink hover:text-accent"
                      >
                        {p.name}
                      </Link>
                      <span className="ml-1.5 font-mono text-[11px] text-ink-faint">{p.code}</span>
                    </td>
                    {dates.map((d) => {
                      const cell = p.days.get(d);
                      const off = isSaturday(d) || holidayByDate.has(d);
                      return (
                        <td
                          key={d}
                          title={
                            cell
                              ? `${cell.typeName} · ${cell.status} · ${cell.reference}`
                              : holidayByDate.get(d) ?? undefined
                          }
                          className={`border-b border-line-soft p-0 ${off && !cell ? "bg-sunk" : ""}`}
                        >
                          <span
                            className="block h-6 w-6"
                            style={
                              cell
                                ? cell.status === "approved"
                                  ? { background: cell.colour }
                                  : {
                                      backgroundImage: `repeating-linear-gradient(45deg, ${cell.colour}, ${cell.colour} 3px, transparent 3px, transparent 6px)`,
                                    }
                                : undefined
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] text-ink-faint">
        Colour is the leave type. Grey columns are Saturdays and public holidays — they are not
        deducted from anybody&apos;s balance.
      </p>
    </>
  );
}

function monthName(m: number) {
  return [
    "Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin",
    "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
  ][m - 1];
}
