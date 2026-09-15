import Link from "next/link";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, EMPLOYED_STATUSES } from "@/db/schema/hr";
import { departments } from "@/db/schema/org";
import { attendanceDays, shifts } from "@/db/schema/attendance";
import { requirePermission } from "@/lib/session";
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

  const [rows, hols, leaves] = await Promise.all([
    db
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
      .where(
        and(
          eq(employees.orgId, viewer.orgId),
          sql`${employees.status} = ANY(ARRAY[${sql.join(
            EMPLOYED_STATUSES.map((s) => sql`${s}`),
            sql`, `,
          )}]::employee_status[])`,
          sql`${employees.dateOfJoin} <= ${date}`,
        ),
      )
      .orderBy(asc(employees.employeeCode)),
    holidayMap(viewer.orgId, date, date),
    leaveMap(viewer.orgId, date, date),
  ]);

  const weeklyOff = isSaturday(date);
  const holidayName = hols.get(date) ?? null;

  const resolved = rows.map((r) => {
    const leave = leaves.get(`${r.employeeId}:${date}`);
    const status: AttendanceStatus =
      (r.status as AttendanceStatus | null) ??
      (leave ? "on_leave" : holidayName ? "holiday" : weeklyOff ? "weekly_off" : "not_marked");
    return { ...r, status, leaveName: leave?.typeName ?? null };
  });

  const tally = (s: AttendanceStatus) => resolved.filter((r) => r.status === s).length;
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
          <TableShell>
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
        )}
      </div>
    </>
  );
}
