import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { attendanceDays, shifts } from "@/db/schema/attendance";
import { approvalSteps } from "@/db/schema/leave";
import { employees } from "@/db/schema/hr";
import { requirePermission } from "@/lib/session";
import {
  ATTENDANCE_ENTITY,
  REQUEST_TYPE_LABEL,
  requestsForEmployee,
  shortTime,
} from "@/lib/attendance";
import { addDays, todayInNepal } from "@/lib/bs";
import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatusBadge,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { RequestForm } from "./request-form";

export const metadata = { title: "Attendance requests" };

export default async function AttendanceRequestsPage() {
  const viewer = await requirePermission("attendance.request.create");

  if (!viewer.employeeId) {
    return (
      <>
        <PageHeader title="My attendance requests" />
        <Card>
          <EmptyState
            title="This login is not linked to an employee record"
            hint="An administrator can link it from Administration › Users."
          />
        </Card>
      </>
    );
  }

  const today = todayInNepal();
  const windowStart = addDays(today, -60);

  const [requests, correctable, shiftRow] = await Promise.all([
    requestsForEmployee(viewer.employeeId),

    // days worth correcting: anything absent, missing a punch, or short
    db
      .select({
        date: attendanceDays.date,
        dateBs: attendanceDays.dateBs,
        checkIn: attendanceDays.checkIn,
        checkOut: attendanceDays.checkOut,
        status: attendanceDays.status,
      })
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.employeeId, viewer.employeeId),
          gte(attendanceDays.date, windowStart),
          lte(attendanceDays.date, today),
          eq(attendanceDays.isLocked, false),
        ),
      )
      .orderBy(attendanceDays.date),

    db
      .select({ startTime: shifts.startTime, endTime: shifts.endTime })
      .from(employees)
      .innerJoin(shifts, eq(shifts.isDefault, true))
      .where(eq(employees.id, viewer.employeeId))
      .limit(1),
  ]);

  const flagged = correctable.filter(
    (d) => d.status === "missing_punch" || d.status === "absent" || d.status === "half_day",
  );

  const pendingIds = requests.filter((r) => r.status === "pending").map((r) => r.id);
  const waitingOn = new Map<string, string>();
  if (pendingIds.length) {
    const steps = await db
      .select({
        entityId: approvalSteps.entityId,
        label: approvalSteps.approverLabel,
        first: employees.firstName,
        last: employees.lastName,
      })
      .from(approvalSteps)
      .leftJoin(employees, eq(employees.id, approvalSteps.approverEmployeeId))
      .where(
        and(eq(approvalSteps.entityType, ATTENDANCE_ENTITY), eq(approvalSteps.decision, "pending")),
      );
    for (const s of steps) {
      if (!waitingOn.has(s.entityId)) {
        waitingOn.set(s.entityId, s.first ? `${s.first} ${s.last}` : (s.label ?? "Unassigned"));
      }
    }
  }

  return (
    <>
      <PageHeader
        title="My attendance requests"
        description="Corrections are accepted for the last 60 days, until payroll locks the period."
      />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <RequestForm
          today={today}
          earliest={windowStart}
          flagged={flagged.map((d) => ({
            date: d.date,
            dateBs: d.dateBs,
            status: d.status,
            checkIn: d.checkIn,
            checkOut: d.checkOut,
          }))}
          defaultTimes={{
            checkIn: shiftRow[0]?.startTime?.slice(0, 5) ?? "09:00",
            checkOut: shiftRow[0]?.endTime?.slice(0, 5) ?? "17:00",
          }}
        />

        <Card>
          <CardHeader
            title="Days worth a look"
            description="Absent, missing a punch, or short of a full day in the last 60 days"
          />
          {flagged.length === 0 ? (
            <EmptyState title="Nothing flagged" hint="Your attendance is complete for this window." />
          ) : (
            <ul className="max-h-80 divide-y divide-line-soft overflow-y-auto">
              {flagged.slice(-12).reverse().map((d) => (
                <li key={d.date} className="flex items-center justify-between gap-2 px-4 py-2">
                  <div className="min-w-0">
                    <p className="tabular text-sm text-ink">{d.dateBs}</p>
                    <p className="tabular text-[11px] text-ink-faint">
                      {shortTime(d.checkIn)} – {shortTime(d.checkOut)}
                    </p>
                  </div>
                  <StatusBadge value={d.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="My requests" description="Twenty-five most recent" />
        {requests.length === 0 ? (
          <EmptyState title="No corrections raised yet" />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Date (BS)</Th>
                <Th>Type</Th>
                <Th>Requested in</Th>
                <Th>Requested out</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-mono text-xs text-ink-soft">{r.reference}</Td>
                  <Td className="tabular text-ink-soft">{r.dateBs}</Td>
                  <Td>{REQUEST_TYPE_LABEL[r.requestType] ?? r.requestType}</Td>
                  <Td className="tabular">{shortTime(r.requestedCheckIn)}</Td>
                  <Td className="tabular">{shortTime(r.requestedCheckOut)}</Td>
                  <Td className="max-w-56 truncate text-ink-soft" title={r.reason}>
                    {r.reason}
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-0.5">
                      <StatusBadge value={r.status} />
                      {r.status === "pending" && waitingOn.get(r.id) ? (
                        <span className="text-[11px] text-ink-faint">
                          with {waitingOn.get(r.id)}
                        </span>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </>
  );
}
