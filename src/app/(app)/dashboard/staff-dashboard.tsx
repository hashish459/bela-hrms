import Link from "next/link";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { CalendarPlus, ClockAlert, FileText } from "lucide-react";
import { db } from "@/db/client";
import { holidays } from "@/db/schema/core";
import { employees } from "@/db/schema/hr";
import { leaveBalances, leaveRequests, leaveTypes } from "@/db/schema/leave";
import { attendanceRequests } from "@/db/schema/attendance";
import { designations } from "@/db/schema/org";
import type { Viewer } from "@/lib/session";
import { monthSheet } from "@/lib/attendance";
import { formatDuration } from "@/lib/attendance/calc";
import { adToBs, addDays, bsToAd, daysInBsMonth, formatBs, todayInNepal } from "@/lib/bs";
import { formatDays } from "@/lib/utils";
import {
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  MeterBar,
  StatTile,
  StatusBadge,
  Td,
  TableShell,
  Th,
  Tr,
} from "@/components/ui";
import { CalendarCard } from "./calendar-card";

/**
 * What an employee sees.
 *
 * Deliberately not a cut-down version of the management dashboard: somebody who
 * can only see their own record does not want organisation totals, they want
 * their own month, their own balances, and the two or three things they might
 * need to do today.
 */
export async function StaffDashboard({ viewer }: { viewer: Viewer }) {
  const employeeId = viewer.employeeId!;
  const today = todayInNepal();
  const bs = adToBs(today);
  const monthFrom = bsToAd({ year: bs.year, month: bs.month, day: 1 });
  const monthTo = bsToAd({
    year: bs.year,
    month: bs.month,
    day: daysInBsMonth(bs.year, bs.month),
  });

  const [{ summary }, balances, myLeave, myAttendanceRequests, upcomingHolidays, me] =
    await Promise.all([
      monthSheet(viewer.orgId, employeeId, monthFrom, monthTo),

      db
        .select({
          id: leaveBalances.id,
          type: leaveTypes.name,
          colour: leaveTypes.colour,
          entitled: leaveBalances.entitled,
          carried: leaveBalances.carriedForward,
          used: leaveBalances.used,
          pending: leaveBalances.pending,
        })
        .from(leaveBalances)
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
        .where(
          and(
            eq(leaveBalances.employeeId, employeeId),
            eq(leaveTypes.deductsBalance, true),
            viewer.fiscalYear ? eq(leaveBalances.fiscalYearId, viewer.fiscalYear.id) : undefined,
          ),
        )
        .orderBy(leaveTypes.name),

      db
        .select({
          id: leaveRequests.id,
          reference: leaveRequests.reference,
          type: leaveTypes.name,
          fromDateBs: leaveRequests.fromDateBs,
          toDateBs: leaveRequests.toDateBs,
          totalDays: leaveRequests.totalDays,
          status: leaveRequests.status,
        })
        .from(leaveRequests)
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
        .where(eq(leaveRequests.employeeId, employeeId))
        .orderBy(desc(leaveRequests.createdAt))
        .limit(5),

      db
        .select({
          id: attendanceRequests.id,
          reference: attendanceRequests.reference,
          dateBs: attendanceRequests.dateBs,
          requestType: attendanceRequests.requestType,
          status: attendanceRequests.status,
        })
        .from(attendanceRequests)
        .where(eq(attendanceRequests.employeeId, employeeId))
        .orderBy(desc(attendanceRequests.createdAt))
        .limit(5),

      db
        .select()
        .from(holidays)
        .where(
          and(
            eq(holidays.orgId, viewer.orgId),
            eq(holidays.isActive, true),
            gte(holidays.date, today),
            lte(holidays.date, addDays(today, 60)),
          ),
        )
        .orderBy(holidays.date)
        .limit(4),

      db
        .select({
          firstName: employees.firstName,
          designation: designations.name,
          dateOfJoin: employees.dateOfJoin,
        })
        .from(employees)
        .leftJoin(designations, eq(designations.id, employees.designationId))
        .where(eq(employees.id, employeeId))
        .limit(1),
    ]);

  const openLeave = myLeave.filter((r) => r.status === "pending").length;
  const openAttendance = myAttendanceRequests.filter((r) => r.status === "pending").length;
  const totalAvailable = balances.reduce(
    (a, b) =>
      a + (Number(b.entitled) + Number(b.carried) - Number(b.used) - Number(b.pending)),
    0,
  );

  return (
    <>
      <div className="pb-5">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Good day, {me[0]?.firstName ?? viewer.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {me[0]?.designation ? `${me[0].designation} · ` : ""}
          {formatBs(adToBs(today))} · fiscal year {viewer.fiscalYear?.code ?? "not set"}
        </p>
      </div>

      {/* the two or three things somebody might actually need to do */}
      <div className="mb-4 flex flex-wrap gap-2">
        <ButtonLink href="/leave/my">
          <CalendarPlus className="size-4" />
          Apply for leave
        </ButtonLink>
        <ButtonLink href="/attendance/requests" variant="secondary">
          <ClockAlert className="size-4" />
          Correct my attendance
        </ButtonLink>
        <ButtonLink href="/attendance/my" variant="secondary">
          <FileText className="size-4" />
          My attendance sheet
        </ButtonLink>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Leave available"
          value={formatDays(totalAvailable)}
          tone="accent"
          sub={`across ${balances.length} type${balances.length === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Payable days this month"
          value={summary.payableDays}
          sub={`${summary.present} present · ${summary.halfDay} half`}
        />
        <StatTile
          label="Late arrivals"
          value={summary.lateCount}
          tone={summary.lateCount > 3 ? "warn" : "neutral"}
          sub={`${summary.totalLateMinutes} minutes this month`}
        />
        <StatTile
          label="Awaiting a decision"
          value={openLeave + openAttendance}
          tone={openLeave + openAttendance ? "warn" : "neutral"}
          sub={
            openLeave + openAttendance
              ? `${openLeave} leave · ${openAttendance} attendance`
              : "Nothing outstanding"
          }
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="My leave"
              description="Five most recent"
              action={
                <Link href="/leave/my" className="text-xs font-medium text-accent">
                  Open
                </Link>
              }
            />
            {myLeave.length === 0 ? (
              <EmptyState title="No leave requests yet" hint="Use Apply for leave above." />
            ) : (
              <TableShell>
                <thead>
                  <tr>
                    <Th>Reference</Th>
                    <Th>Type</Th>
                    <Th>From (BS)</Th>
                    <Th>To (BS)</Th>
                    <Th className="text-right">Days</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {myLeave.map((r) => (
                    <Tr key={r.id}>
                      <Td className="font-mono text-xs text-ink-soft">{r.reference}</Td>
                      <Td>{r.type}</Td>
                      <Td className="tabular text-ink-soft">{r.fromDateBs}</Td>
                      <Td className="tabular text-ink-soft">{r.toDateBs}</Td>
                      <Td className="tabular text-right">{formatDays(r.totalDays)}</Td>
                      <Td>
                        <StatusBadge value={r.status} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Card>

          <Card>
            <CardHeader
              title="My attendance corrections"
              action={
                <Link href="/attendance/requests" className="text-xs font-medium text-accent">
                  Open
                </Link>
              }
            />
            {myAttendanceRequests.length === 0 ? (
              <EmptyState
                title="Nothing raised"
                hint="Missing punches and wrong times can be corrected within 60 days."
              />
            ) : (
              <ul className="divide-y divide-line-soft">
                {myAttendanceRequests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-ink">
                        <span className="font-mono text-xs text-ink-faint">{r.reference}</span>{" "}
                        {r.requestType.replace(/_/g, " ")}
                      </p>
                      <p className="tabular text-[11px] text-ink-faint">{r.dateBs} BS</p>
                    </div>
                    <StatusBadge value={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <CalendarCard orgId={viewer.orgId} employeeId={viewer.employeeId} />

          <Card>
            <CardHeader
              title="My balances"
              description={viewer.fiscalYear ? `Fiscal year ${viewer.fiscalYear.code}` : undefined}
            />
            {balances.length === 0 ? (
              <EmptyState title="No balances allocated" />
            ) : (
              <ul className="divide-y divide-line-soft">
                {balances.map((b) => {
                  const entitled = Number(b.entitled) + Number(b.carried);
                  const used = Number(b.used);
                  const pending = Number(b.pending);
                  const available = entitled - used - pending;
                  return (
                    <li key={b.id} className="px-4 py-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-sm text-ink">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: b.colour }}
                            aria-hidden
                          />
                          {b.type}
                        </span>
                        <span className="tabular text-sm font-semibold text-ink">
                          {formatDays(available)}
                          <span className="text-xs font-normal text-ink-faint">
                            {" "}
                            / {formatDays(entitled)}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <MeterBar
                          used={used + pending}
                          total={entitled}
                          tone={available <= 0 ? "danger" : pending > 0 ? "warn" : "accent"}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="This month" description={formatBs({ ...bs, day: 1 }).replace(/^1 /, "")} />
            <dl className="grid grid-cols-2 gap-3 p-4">
              {[
                ["Present", summary.present, ""],
                ["Half days", summary.halfDay, ""],
                ["On leave", summary.onLeave, ""],
                ["Absent", summary.absent, summary.absent ? "text-danger" : ""],
                ["Hours worked", (summary.totalWorkedMinutes / 60).toFixed(1) + "h", ""],
                ["Overtime", formatDuration(summary.totalOtMinutes), "text-info"],
              ].map(([label, value, cls]) => (
                <div key={String(label)}>
                  <dt className="text-[11px] text-ink-faint">{label}</dt>
                  <dd className={`tabular mt-0.5 text-sm font-medium text-ink ${cls}`}>{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Upcoming holidays" description="Next 60 days" />
            {upcomingHolidays.length === 0 ? (
              <EmptyState title="None scheduled" />
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
                    <p className="tabular shrink-0 text-xs text-ink-soft">{h.dateBs}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="My access" />
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
    </>
  );
}
