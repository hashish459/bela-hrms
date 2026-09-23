import Link from "next/link";
import { and, asc, count, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, onStrength } from "@/db/schema/hr";
import { departments } from "@/db/schema/org";
import { attendanceDays, shifts } from "@/db/schema/attendance";
import { requirePermission } from "@/lib/session";
import { offsetPage, PAGE_SIZE } from "@/lib/pagination";
import { OffsetPagination } from "@/components/pagination";
import {
  ATTENDANCE_STATUS_LABEL,
  formatDuration,
  holidayMap,
  leaveMap,
  shortTime,
  type AttendanceStatus,
} from "@/lib/attendance";
import { adToBs, formatBs, isSaturday, todayInNepal } from "@/lib/bs";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatTile,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { STATUS_TONE } from "../sheet";
import { DayPicker } from "./day-picker";

export const metadata = { title: "Daily register" };

export default async function RegisterPage({ searchParams }: PageProps<"/attendance/register">) {
  const viewer = await requirePermission("attendance.record.viewAll");
  const params = await searchParams;

  const today = todayInNepal();

  // Default to the latest day that actually has records rather than to today.
  // Attendance for the current day is not in yet until the readers are polled, and
  // landing on a screen of "Not marked" tells nobody anything.
  let date = typeof params.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.d) ? params.d : "";
  if (!date) {
    const [latest] = await db
      .select({ date: attendanceDays.date })
      .from(attendanceDays)
      .where(and(eq(attendanceDays.orgId, viewer.orgId), lte(attendanceDays.date, today)))
      .orderBy(desc(attendanceDays.date))
      .limit(1);
    date = latest?.date ?? today;
  }

  /*
   * Paginated by employee, with the tallies aggregated separately.
   *
   * The register is one row per employee for a single day. At the production
   * headcount that was a 1.5 MB document; the queries were fine, the payload
   * was not.
   *
   * The tiles have to keep counting the whole organisation. Deriving them from
   * the visible page would mean "Absent: 2" on page one and "Absent: 5" on page
   * two, describing nothing.
   */
  const employedFilter = and(
    eq(employees.orgId, viewer.orgId),
    onStrength(),
    sql`${employees.dateOfJoin} <= ${date}`,
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

  const pageStaff = await db
    .select({ id: employees.id })
    .from(employees)
    .where(employedFilter)
    .orderBy(asc(employees.employeeCode))
    .limit(page.limit)
    .offset(page.offset);

  const pageIds = pageStaff.map((e) => e.id);

  const [rows, hols, leaves, recordedTally] = await Promise.all([
    pageIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            employeeId: employees.id,
            code: employees.employeeCode,
            name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
            department: departments.name,
            shiftName: shifts.name,
            shiftCode: shifts.code,
            checkIn: attendanceDays.checkIn,
            checkOut: attendanceDays.checkOut,
            workedMinutes: attendanceDays.workedMinutes,
            lateMinutes: attendanceDays.lateMinutes,
            otMinutes: attendanceDays.otMinutes,
            status: attendanceDays.status,
            source: attendanceDays.source,
            remarks: attendanceDays.remarks,
          })
          .from(employees)
          .leftJoin(
            attendanceDays,
            and(eq(attendanceDays.employeeId, employees.id), eq(attendanceDays.date, date)),
          )
          .leftJoin(departments, eq(departments.id, employees.departmentId))
          .leftJoin(shifts, eq(shifts.id, attendanceDays.shiftId))
          .where(and(employedFilter, inArray(employees.id, pageIds)))
          .orderBy(asc(employees.employeeCode)),

    holidayMap(viewer.orgId, date, date),
    leaveMap(viewer.orgId, date, date, pageIds),

    // Recorded statuses across every employed person, not just this page.
    db
      .select({ status: attendanceDays.status, n: count() })
      .from(attendanceDays)
      .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
      .where(and(employedFilter, eq(attendanceDays.date, date)))
      .groupBy(attendanceDays.status),
  ]);

  const weeklyOff = isSaturday(date);
  const holidayName = hols.get(date) ?? null;

  /*
   * Organisation-wide tallies.
   *
   * Recorded statuses come from the aggregate above. Everyone with no row at
   * all falls back the same way a single row does — a weekly off, a holiday, or
   * simply not marked — so the fallback is applied once to the remainder rather
   * than per row.
   */
  const recorded = new Map(recordedTally.map((r) => [r.status as string, Number(r.n)]));
  const recordedCount = [...recorded.values()].reduce((a, b) => a + b, 0);
  const unrecorded = Math.max(0, Number(staffTotal) - recordedCount);

  const fallbackStatus: AttendanceStatus = weeklyOff
    ? "weekly_off"
    : holidayName
      ? "holiday"
      : "not_marked";

  const tally = (status: AttendanceStatus) =>
    (recorded.get(status) ?? 0) + (status === fallbackStatus ? unrecorded : 0);

  const resolved = rows.map((r) => {
    const leave = leaves.get(`${r.employeeId}:${date}`);
    const status: AttendanceStatus =
      (r.status as AttendanceStatus | null) ??
      (leave ? "on_leave" : holidayName ? "holiday" : weeklyOff ? "weekly_off" : "not_marked");
    return { ...r, status, leaveName: leave?.typeName ?? null };
  });

  const lateCount = resolved.filter((r) => (r.lateMinutes ?? 0) > 0).length;

  return (
    <>
      <PageHeader
        title="Daily register"
        description={
          holidayName
            ? `${holidayName} — organisation holiday`
            : weeklyOff
              ? "Saturday — weekly off"
              : "Everyone employed on this date"
        }
        action={<DayPicker date={date} today={today} />}
      />

      {date !== today ? (
        <p className="mb-3 rounded border border-line bg-sunk px-3 py-2 text-xs text-ink-soft">
          Showing the most recent processed day. Today&apos;s attendance appears once the
          readers have been polled.
        </p>
      ) : null}

      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className="tabular text-sm font-semibold text-ink">
          {formatBs(adToBs(date))} BS
        </span>
        <span className="tabular text-xs text-ink-faint">
          {new Date(date).toLocaleDateString("en-GB", {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Present" value={tally("present")} tone="ok" />
        <StatTile label="Half day" value={tally("half_day")} tone={tally("half_day") ? "warn" : "neutral"} />
        <StatTile label="Absent" value={tally("absent")} tone={tally("absent") ? "danger" : "neutral"} />
        <StatTile label="On leave" value={tally("on_leave")} tone="accent" />
        <StatTile
          label="Late arrivals"
          value={lateCount}
          tone={lateCount > 0 ? "warn" : "neutral"}
          sub={tally("missing_punch") ? `${tally("missing_punch")} missing punch` : undefined}
        />
      </div>

      <div className="mt-4">
        {resolved.length === 0 ? (
          <Card>
            <EmptyState title="Nobody was employed on this date" />
          </Card>
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <TableShell className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Employee</Th>
                <Th>Department</Th>
                <Th>Shift</Th>
                <Th>In</Th>
                <Th>Out</Th>
                <Th className="text-right">Worked</Th>
                <Th className="text-right">Late</Th>
                <Th className="text-right">OT</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((r) => (
                <Tr key={r.employeeId}>
                  <Td className="font-mono text-xs text-ink-soft">{r.code}</Td>
                  <Td>
                    <Link
                      href={`/hr/employees/${r.employeeId}`}
                      className="font-medium text-ink hover:text-accent"
                    >
                      {r.name}
                    </Link>
                  </Td>
                  <Td className="text-ink-soft">{r.department ?? "—"}</Td>
                  <Td className="text-xs text-ink-faint">{r.shiftCode ?? "—"}</Td>
                  <Td className="tabular">{shortTime(r.checkIn)}</Td>
                  <Td className="tabular">{shortTime(r.checkOut)}</Td>
                  <Td className="tabular text-right">{formatDuration(r.workedMinutes)}</Td>
                  <Td
                    className={`tabular text-right ${
                      (r.lateMinutes ?? 0) > 0 ? "text-warn" : "text-ink-faint"
                    }`}
                  >
                    {r.lateMinutes ? `${r.lateMinutes}m` : "—"}
                  </Td>
                  <Td
                    className={`tabular text-right ${
                      (r.otMinutes ?? 0) > 0 ? "text-info" : "text-ink-faint"
                    }`}
                  >
                    {formatDuration(r.otMinutes)}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={STATUS_TONE[r.status]}>
                        {ATTENDANCE_STATUS_LABEL[r.status]}
                      </Badge>
                      {r.leaveName ? (
                        <span className="text-[11px] text-ink-faint">{r.leaveName}</span>
                      ) : null}
                      {r.source === "request" ? (
                        <span className="text-[11px] text-ink-faint" title={r.remarks ?? ""}>
                          corrected
                        </span>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
            </TableShell>

            <OffsetPagination page={page} params={params} label="employees" />
          </div>
        )}
      </div>
    </>
  );
}
