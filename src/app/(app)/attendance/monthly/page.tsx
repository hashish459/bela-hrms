import Link from "next/link";
import { and, asc, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, EMPLOYED_STATUSES } from "@/db/schema/hr";
import { departments } from "@/db/schema/org";
import { attendanceDays } from "@/db/schema/attendance";
import { requirePermission } from "@/lib/session";
import {
  ATTENDANCE_STATUS_CODE,
  ATTENDANCE_STATUS_LABEL,
  holidayMap,
  leaveMap,
  type AttendanceStatus,
} from "@/lib/attendance";
import { addDays, adToBs, isSaturday, todayInNepal } from "@/lib/bs";
import { offsetPage, PAGE_SIZE } from "@/lib/pagination";
import { OffsetPagination } from "@/components/pagination";
import { BsMonthNav, bsMonthBounds } from "@/components/bs-month-nav";
import { Card, EmptyState, PageHeader, StatTile } from "@/components/ui";
import { AttendanceLegend } from "../sheet";

export const metadata = { title: "Monthly sheet" };

/** Cell colour per status. Kept literal so both themes stay legible. */
const CELL: Record<AttendanceStatus, string> = {
  present: "bg-ok-soft text-ok",
  half_day: "bg-warn-soft text-warn",
  absent: "bg-danger-soft text-danger",
  weekly_off: "bg-sunk text-ink-faint",
  holiday: "bg-info-soft text-info",
  on_leave: "bg-accent-soft text-accent",
  missing_punch: "bg-warn-soft text-warn",
  not_marked: "text-ink-faint",
};

export default async function MonthlySheetPage({ searchParams }: PageProps<"/attendance/monthly">) {
  const viewer = await requirePermission("attendance.record.viewAll");
  const params = await searchParams;

  const today = todayInNepal();
  const nowBs = adToBs(today);
  const month = { year: Number(params.y) || nowBs.year, month: Number(params.m) || nowBs.month };
  const { from, to } = bsMonthBounds(month);

  /*
   * Paginated by employee.
   *
   * This sheet renders one cell per employee per day. Unpaginated at the
   * production headcount that is 459 x 31 = 14,229 cells and a 7.2 MB HTML
   * document — measured, not estimated — and it grows linearly: 15 MB at a
   * thousand staff. The queries were never the problem; the payload was.
   *
   * Two consequences the implementation has to respect:
   *
   *   - the attendance rows are fetched only for the employees on this page,
   *     which turns a 14,000-row read into a few hundred;
   *   - the tiles above the table stay ORGANISATION-wide. Summing the visible
   *     page would make "absent days" change as you page through, which is the
   *     classic way a paginated report starts lying.
   */
  const employedFilter = and(
    eq(employees.orgId, viewer.orgId),
    sql`${employees.status} = ANY(ARRAY[${sql.join(
      EMPLOYED_STATUSES.map((s) => sql`${s}`),
      sql`, `,
    )}]::employee_status[])`,
    lte(employees.dateOfJoin, to),
  );

  const [{ n: staffTotal }] = await db
    .select({ n: count() })
    .from(employees)
    .where(employedFilter);

  const page = offsetPage({
    page: Array.isArray(params.page) ? params.page[0] : params.page,
    total: Number(staffTotal),
    defaultSize: PAGE_SIZE.compact,
  });

  const staff = await db
    .select({
      id: employees.id,
      code: employees.employeeCode,
      name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      department: departments.name,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(employedFilter)
    .orderBy(asc(employees.employeeCode))
    .limit(page.limit)
    .offset(page.offset);

  const staffIds = staff.map((s) => s.id);

  const [records, hols, leaves, [orgTotals]] = await Promise.all([
    staffIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            employeeId: attendanceDays.employeeId,
            date: attendanceDays.date,
            status: attendanceDays.status,
            lateMinutes: attendanceDays.lateMinutes,
            otMinutes: attendanceDays.otMinutes,
            workedMinutes: attendanceDays.workedMinutes,
          })
          .from(attendanceDays)
          .where(
            and(
              eq(attendanceDays.orgId, viewer.orgId),
              gte(attendanceDays.date, from),
              lte(attendanceDays.date, to),
              inArray(attendanceDays.employeeId, staffIds),
            ),
          ),

    holidayMap(viewer.orgId, from, to),
    leaveMap(viewer.orgId, from, to, staffIds),

    // Aggregated in the database over every employee, so the tiles describe the
    // month rather than the page.
    db
      .select({
        absent: sql<number>`count(*) FILTER (WHERE ${attendanceDays.status} = 'absent')::int`,
        late: sql<number>`count(*) FILTER (WHERE ${attendanceDays.lateMinutes} > 0)::int`,
        ot: sql<number>`coalesce(sum(${attendanceDays.otMinutes}), 0)::int`,
      })
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.orgId, viewer.orgId),
          gte(attendanceDays.date, from),
          lte(attendanceDays.date, to),
        ),
      ),
  ]);

  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);

  const byKey = new Map(records.map((r) => [`${r.employeeId}:${r.date}`, r]));

  const rows = staff.map((s) => {
    const cells = dates.map((d) => {
      const rec = byKey.get(`${s.id}:${d}`);
      const leave = leaves.get(`${s.id}:${d}`);
      const status: AttendanceStatus =
        (rec?.status as AttendanceStatus | undefined) ??
        (leave ? "on_leave" : hols.has(d) ? "holiday" : isSaturday(d) ? "weekly_off" : "not_marked");
      return { date: d, status, late: rec?.lateMinutes ?? 0, ot: rec?.otMinutes ?? 0 };
    });

    const count = (s: AttendanceStatus) => cells.filter((c) => c.status === s).length;
    return {
      ...s,
      cells,
      present: count("present"),
      halfDay: count("half_day"),
      absent: count("absent"),
      leaveDays: count("on_leave"),
      lateDays: cells.filter((c) => c.late > 0).length,
      otMinutes: cells.reduce((a, c) => a + c.ot, 0),
      payable: count("present") + count("half_day") * 0.5 + count("on_leave") + count("weekly_off") + count("holiday"),
    };
  });


  return (
    <>
      <PageHeader
        title="Monthly sheet"
        description="One column per day of the Bikram Sambat month. Hover a cell for the detail."
        action={<BsMonthNav basePath="/attendance/monthly" current={month} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Employees"
          value={staffTotal}
          sub={page.pageCount > 1 ? `showing ${page.from}-${page.to}` : undefined}
          tone="accent"
        />
        <StatTile
          label="Absent days"
          value={orgTotals?.absent ?? 0}
          sub="whole organisation"
          tone={(orgTotals?.absent ?? 0) > 0 ? "danger" : "neutral"}
        />
        <StatTile
          label="Late arrivals"
          value={orgTotals?.late ?? 0}
          sub="whole organisation"
          tone={(orgTotals?.late ?? 0) > 0 ? "warn" : "neutral"}
        />
        <StatTile
          label="Overtime"
          value={`${((orgTotals?.ot ?? 0) / 60).toFixed(1)}h`}
          sub="whole organisation"
          tone="info"
        />
      </div>

      <div className="mt-4">
        {rows.length === 0 ? (
          <Card>
            <EmptyState title="No employees in this period" />
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
                    const bs = adToBs(d);
                    const off = isSaturday(d) || hols.has(d);
                    return (
                      <th
                        key={d}
                        title={hols.get(d) ?? undefined}
                        className={`border-b border-line px-0 py-2 text-center text-[10px] font-medium ${
                          off ? "bg-sunk text-ink-faint" : "bg-sunk text-ink-soft"
                        }`}
                      >
                        <span className="tabular block w-6">{bs.day}</span>
                      </th>
                    );
                  })}
                  <th className="border-b border-line bg-sunk px-2 py-2 text-right text-[11px] font-medium tracking-wide text-ink-faint uppercase">
                    P
                  </th>
                  <th className="border-b border-line bg-sunk px-2 py-2 text-right text-[11px] font-medium tracking-wide text-ink-faint uppercase">
                    A
                  </th>
                  <th className="border-b border-line bg-sunk px-2 py-2 text-right text-[11px] font-medium tracking-wide text-ink-faint uppercase">
                    L
                  </th>
                  <th className="border-b border-line bg-sunk px-2 py-2 text-right text-[11px] font-medium tracking-wide text-ink-faint uppercase whitespace-nowrap">
                    Payable
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-sunk/40">
                    <td className="sticky left-0 z-10 border-b border-line-soft bg-surface px-3 py-1.5 whitespace-nowrap">
                      <Link
                        href={`/hr/employees/${r.id}`}
                        className="text-sm font-medium text-ink hover:text-accent"
                      >
                        {r.name}
                      </Link>
                      <span className="ml-1.5 font-mono text-[11px] text-ink-faint">{r.code}</span>
                    </td>
                    {r.cells.map((c) => (
                      <td
                        key={c.date}
                        title={`${c.date} — ${ATTENDANCE_STATUS_LABEL[c.status]}${
                          c.late > 0 ? `, ${c.late}m late` : ""
                        }${c.ot > 0 ? `, ${c.ot}m OT` : ""}`}
                        className={`border-b border-line-soft p-0 text-center ${CELL[c.status]}`}
                      >
                        <span className="tabular block w-6 py-1.5 font-mono text-[11px]">
                          {ATTENDANCE_STATUS_CODE[c.status]}
                        </span>
                      </td>
                    ))}
                    <td className="tabular border-b border-line-soft px-2 py-1.5 text-right text-xs text-ok">
                      {r.present}
                    </td>
                    <td
                      className={`tabular border-b border-line-soft px-2 py-1.5 text-right text-xs ${
                        r.absent > 0 ? "text-danger" : "text-ink-faint"
                      }`}
                    >
                      {r.absent}
                    </td>
                    <td className="tabular border-b border-line-soft px-2 py-1.5 text-right text-xs text-accent">
                      {r.leaveDays}
                    </td>
                    <td className="tabular border-b border-line-soft px-2 py-1.5 text-right text-xs font-medium text-ink">
                      {r.payable}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <OffsetPagination page={page} params={params} label="employees" />
          </div>
        )}
      </div>

      <AttendanceLegend />
    </>
  );
}
