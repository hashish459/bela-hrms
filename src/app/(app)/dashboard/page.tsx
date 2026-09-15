import Link from "next/link";
import { and, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, EMPLOYED_STATUSES } from "@/db/schema/hr";
import { departments } from "@/db/schema/org";
import { leaveRequests, leaveTypes } from "@/db/schema/leave";
import { holidays } from "@/db/schema/core";
import { attendanceDays } from "@/db/schema/attendance";
import { leaveBalances } from "@/db/schema/leave";
import { requireViewer, can } from "@/lib/session";
import { adToBs, formatBs, todayInNepal, addDays } from "@/lib/bs";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  StatusBadge,
  Td,
  TableShell,
  Th,
  Tr,
} from "@/components/ui";

import { DonutChart, StackedBarChart, WaffleChart } from "@/components/charts";
import { bsMonthRange } from "@/lib/attendance";

import { StaffDashboard } from "./staff-dashboard";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const viewer = await requireViewer();

  // Somebody who can only see their own record gets a personal workspace, not a
  // cut-down management view with every panel empty.
  const managesPeople =
    can(viewer, "leave.request.viewAll") ||
    can(viewer, "attendance.record.viewAll") ||
    can(viewer, "hr.employee.view");

  if (!managesPeople && viewer.employeeId) {
    return <StaffDashboard viewer={viewer} />;
  }

  const today = todayInNepal();
  const orgId = viewer.orgId;

  // Somebody who cannot see the whole register only ever sees their own requests.
  const seesAllLeave =
    can(viewer, "leave.request.viewAll") || can(viewer, "leave.request.approve");
  const ownRequestsOnly =
    seesAllLeave || !viewer.employeeId
      ? undefined
      : eq(leaveRequests.employeeId, viewer.employeeId);

  const [[headcount], [pendingCount], [onLeaveToday], byDepartment, pendingQueue, upcomingHolidays] =
    await Promise.all([
      db
        .select({ n: count() })
        .from(employees)
        .where(and(eq(employees.orgId, orgId), inArray(employees.status, [...EMPLOYED_STATUSES]))),

      db
        .select({ n: count() })
        .from(leaveRequests)
        .where(
          and(eq(leaveRequests.orgId, orgId), eq(leaveRequests.status, "pending"), ownRequestsOnly),
        ),

      db
        .select({ n: count() })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.orgId, orgId),
            eq(leaveRequests.status, "approved"),
            lte(leaveRequests.fromDate, today),
            gte(leaveRequests.toDate, today),
          ),
        ),

      db
        .select({
          department: departments.name,
          n: count(employees.id),
        })
        .from(departments)
        .leftJoin(
          employees,
          and(
            eq(employees.departmentId, departments.id),
            inArray(employees.status, [...EMPLOYED_STATUSES]),
          ),
        )
        .where(eq(departments.orgId, orgId))
        .groupBy(departments.name)
        .orderBy(desc(count(employees.id))),

      db
        .select({
          id: leaveRequests.id,
          reference: leaveRequests.reference,
          fromDate: leaveRequests.fromDate,
          toDate: leaveRequests.toDate,
          fromDateBs: leaveRequests.fromDateBs,
          totalDays: leaveRequests.totalDays,
          status: leaveRequests.status,
          employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
          employeeCode: employees.employeeCode,
          leaveType: leaveTypes.name,
          colour: leaveTypes.colour,
        })
        .from(leaveRequests)
        .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
        .where(
          and(eq(leaveRequests.orgId, orgId), eq(leaveRequests.status, "pending"), ownRequestsOnly),
        )
        .orderBy(leaveRequests.fromDate)
        .limit(6),

      db
        .select()
        .from(holidays)
        .where(
          and(
            eq(holidays.orgId, orgId),
            gte(holidays.date, today),
            lte(holidays.date, addDays(today, 90)),
          ),
        )
        .orderBy(holidays.date)
        .limit(5),
    ]);

  const maxDept = Math.max(1, ...byDepartment.map((d) => Number(d.n)));

  /* ----------------------------------------------------------------- charts
   *
   * Three questions a table answers badly, in the order a manager asks them:
   * what did this month look like, which team is the problem, and how much
   * leave is still outstanding. Everything else on this page stays a table,
   * because a table answers it better.
   *
   * All three are scoped to the current Bikram Sambat month — a Gregorian month
   * would split a Nepali payroll period across two charts.
   */
  const month = await bsMonthRange(today);

  const [monthMix, deptMix, [leaveUse]] = await Promise.all([
    db
      .select({ status: attendanceDays.status, n: count() })
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.orgId, orgId),
          gte(attendanceDays.date, month.from),
          lte(attendanceDays.date, month.to),
        ),
      )
      .groupBy(attendanceDays.status),

    db
      .select({
        department: departments.name,
        status: attendanceDays.status,
        n: count(),
      })
      .from(attendanceDays)
      .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(
        and(
          eq(attendanceDays.orgId, orgId),
          gte(attendanceDays.date, month.from),
          lte(attendanceDays.date, month.to),
          // weekly offs and holidays are not a team's doing, and including them
          // would make every department look identical
          inArray(attendanceDays.status, ["present", "field_work", "half_day", "absent", "on_leave"]),
        ),
      )
      .groupBy(departments.name, attendanceDays.status),

    db
      .select({
        entitled: sql<number>`coalesce(sum(${leaveBalances.entitled} + ${leaveBalances.carriedForward}), 0)::float`,
        used: sql<number>`coalesce(sum(${leaveBalances.used}), 0)::float`,
        pending: sql<number>`coalesce(sum(${leaveBalances.pending}), 0)::float`,
      })
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.orgId, orgId),
          viewer.fiscalYear ? eq(leaveBalances.fiscalYearId, viewer.fiscalYear.id) : undefined,
        ),
      ),
  ]);

  const countOf = (...statuses: string[]) =>
    monthMix.filter((r) => statuses.includes(r.status)).reduce((a, r) => a + Number(r.n), 0);

  const worked = countOf("present");
  const fieldWork = countOf("field_work");
  const onLeave = countOf("on_leave");
  const halfDays = countOf("half_day");
  const absent = countOf("absent");
  const nonWorking = countOf("weekly_off", "holiday");
  const workingDayRows = worked + fieldWork + onLeave + halfDays + absent;

  const departmentRows = [...new Set(deptMix.map((r) => r.department))]
    .map((department) => {
      const forDept = deptMix.filter((r) => r.department === department);
      const get = (...statuses: string[]) =>
        forDept.filter((r) => statuses.includes(r.status)).reduce((a, r) => a + Number(r.n), 0);
      const rowTotal = forDept.reduce((a, r) => a + Number(r.n), 0);
      const attended = get("present", "field_work");
      return {
        label: department,
        rowTotal,
        segments: [
          { key: "worked", value: attended },
          { key: "half", value: get("half_day") },
          { key: "leave", value: get("on_leave") },
          { key: "absent", value: get("absent") },
        ],
        // Ranked by the figure the chart exists to surface, not alphabetically:
        // the department with the worst attendance rate is the one to look at.
        rate: rowTotal === 0 ? 1 : attended / rowTotal,
      };
    })
    .filter((r) => r.rowTotal > 0)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 8);

  const entitled = Number(leaveUse?.entitled ?? 0);
  const used = Number(leaveUse?.used ?? 0);
  const reserved = Number(leaveUse?.pending ?? 0);
  const availableDays = Math.max(0, entitled - used - reserved);


  return (
    <>
      <PageHeader
        title={`Good day, ${viewer.name.split(" ")[0]}`}
        description={`${viewer.orgName} · ${formatBs(adToBs(today))} · fiscal year ${
          viewer.fiscalYear?.code ?? "not set"
        }`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active headcount" value={headcount.n} tone="accent" />
        <StatTile
          label="Leave awaiting approval"
          value={pendingCount.n}
          tone={pendingCount.n > 0 ? "warn" : "neutral"}
          sub={pendingCount.n > 0 ? "Needs a decision" : "Nothing outstanding"}
        />
        <StatTile label="On leave today" value={onLeaveToday.n} tone="info" />
        <StatTile
          label="Departments"
          value={byDepartment.length}
          sub={`${upcomingHolidays.length} holidays in 90 days`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader
            title="Leave awaiting approval"
            description={seesAllLeave ? "Across the organisation" : "Your own requests"}
            action={
              <Link href={seesAllLeave ? "/leave/approvals" : "/leave/my"} className="text-xs font-medium text-accent">
                {seesAllLeave ? "Open queue" : "My leave"}
              </Link>
            }
          />
          {pendingQueue.length === 0 ? (
            <EmptyState title="Nothing waiting" hint="Approved and rejected requests move to the register." />
          ) : (
            <TableShell>
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Employee</Th>
                  <Th>Type</Th>
                  <Th>From (BS)</Th>
                  <Th className="text-right">Days</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {pendingQueue.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-mono text-xs text-ink-soft">{r.reference}</Td>
                    <Td>
                      <span className="font-medium text-ink">{r.employeeName}</span>
                      <span className="ml-1.5 font-mono text-[11px] text-ink-faint">
                        {r.employeeCode}
                      </span>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: r.colour }}
                          aria-hidden
                        />
                        {r.leaveType}
                      </span>
                    </Td>
                    <Td className="tabular text-ink-soft">{r.fromDateBs}</Td>
                    <Td className="tabular text-right">{r.totalDays}</Td>
                    <Td>
                      <StatusBadge value={r.status} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          {/*
            The month, as one shape. A donut earns its place here because the
            statuses genuinely partition the month and the centre can carry the
            number the reader came for — the attendance rate.
          */}
          <Card>
            <CardHeader
              title="This month at a glance"
              description={`${formatBs(adToBs(month.from))} — working days only`}
            />
            <div className="p-4">
              {workingDayRows === 0 ? (
                <EmptyState title="No attendance recorded this month yet" />
              ) : (
                <DonutChart
                  centreValue={`${Math.round(((worked + fieldWork) / workingDayRows) * 100)}%`}
                  centreLabel="at work"
                  slices={[
                    { label: "Present", value: worked, colour: "var(--color-ok)" },
                    { label: "Field work", value: fieldWork, colour: "var(--color-info)" },
                    { label: "On leave", value: onLeave, colour: "var(--color-accent)" },
                    { label: "Half day", value: halfDays, colour: "var(--color-warn)" },
                    { label: "Absent", value: absent, colour: "var(--color-danger)" },
                  ]}
                />
              )}
              {nonWorking > 0 ? (
                <p className="mt-3 border-t border-line-soft pt-2 text-[11px] text-ink-faint">
                  {nonWorking} weekly off and holiday days are excluded — they are nobody&rsquo;s
                  attendance.
                </p>
              ) : null}
            </div>
          </Card>

          {/*
            Leave outstanding. A waffle, not a bar: it is one proportion, and the
            reader is deciding whether a year-end encashment or lapse run is
            coming, which is a counting question.
          */}
          <Card>
            <CardHeader
              title="Leave across the organisation"
              description={`Fiscal year ${viewer.fiscalYear?.code ?? "—"} · ${entitled.toFixed(0)} days entitled in total`}
            />
            <div className="p-4">
              {entitled === 0 ? (
                <EmptyState title="No leave allocated for this fiscal year" />
              ) : (
                <WaffleChart
                  slices={[
                    {
                      label: "Taken",
                      value: used,
                      colour: "var(--color-accent)",
                      hint: `${used.toFixed(1)} days approved and consumed`,
                    },
                    {
                      label: "Reserved",
                      value: reserved,
                      colour: "var(--color-warn)",
                      hint: `${reserved.toFixed(1)} days held by undecided requests`,
                    },
                    {
                      label: "Available",
                      value: availableDays,
                      colour: "var(--color-sunk-strong, var(--color-line))",
                      hint: `${availableDays.toFixed(1)} days still open`,
                    },
                  ]}
                />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Headcount by department" />
            <div className="flex flex-col gap-2 p-4">
              {byDepartment.map((d) => (
                <div key={d.department} className="grid grid-cols-[7rem_1fr_2rem] items-center gap-2">
                  <span className="truncate text-xs text-ink-soft">{d.department}</span>
                  <span className="h-3 rounded-sm bg-sunk">
                    <span
                      className="block h-full rounded-sm bg-accent"
                      style={{ width: `${(Number(d.n) / maxDept) * 100}%` }}
                    />
                  </span>
                  <span className="tabular text-right text-xs text-ink-soft">{Number(d.n)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Upcoming holidays" description="Next 90 days" />
            {upcomingHolidays.length === 0 ? (
              <EmptyState title="No holidays scheduled" />
            ) : (
              <ul className="divide-y divide-line-soft">
                {upcomingHolidays.map((h) => (
                  <li key={h.id} className="flex items-baseline justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{h.name}</p>
                      {h.nameNepali ? (
                        <p className="truncate text-xs text-ink-faint">{h.nameNepali}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-xs text-ink-soft">{h.dateBs}</p>
                      <p className="text-[11px] text-ink-faint">
                        {new Date(h.date).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Your access" description="Granted by role, checked on every request" />
            <div className="flex flex-wrap gap-1.5 p-4">
              {viewer.roleNames.map((r) => (
                <Badge key={r} tone="accent">
                  {r}
                </Badge>
              ))}
              <Badge tone="neutral">{viewer.permissions.size} permissions</Badge>
            </div>
          </Card>
        </div>
      </div>

      {/*
        Composition across teams, normalised to 100%.
        A stacked bar is the right shape here and a grouped bar is not: the
        question is "which department has the absence problem", and normalising
        removes headcount from the comparison so a team of six and a team of
        sixty can be read against each other. Sorted worst-first for the same
        reason — the row somebody needs to act on is at the top.
      */}
      {departmentRows.length > 0 ? (
        <Card className="mt-4">
          <CardHeader
            title="Attendance composition by department"
            description="Share of working days this Bikram Sambat month. Weekly offs and holidays excluded; worst attendance rate first."
          />
          <div className="p-4">
            <StackedBarChart
              rows={departmentRows.map((r) => ({
                label: r.label,
                segments: r.segments,
                trailing: `${Math.round(r.rate * 100)}%`,
              }))}
              keys={[
                { key: "worked", label: "At work", colour: "var(--color-ok)" },
                { key: "half", label: "Half day", colour: "var(--color-warn)" },
                { key: "leave", label: "On leave", colour: "var(--color-accent)" },
                { key: "absent", label: "Absent", colour: "var(--color-danger)" },
              ]}
            />
          </div>
        </Card>
      ) : null}
    </>
  );
}
