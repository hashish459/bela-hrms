import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { departments, designations } from "@/db/schema/org";
import { approvalSteps } from "@/db/schema/leave";
import { attendanceDays, attendanceRequests, shifts } from "@/db/schema/attendance";
import { can, requirePermission } from "@/lib/session";
import { ATTENDANCE_ENTITY, REQUEST_TYPE_LABEL } from "@/lib/attendance";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { AttendanceDecisionCard } from "./decision-card";

export const metadata = { title: "Attendance approvals" };

export default async function AttendanceApprovalsPage() {
  const viewer = await requirePermission("attendance.request.approve");
  const seesEverything = can(viewer, "attendance.record.viewAll");

  const rows = await db
    .select({
      requestId: attendanceRequests.id,
      reference: attendanceRequests.reference,
      date: attendanceRequests.date,
      dateBs: attendanceRequests.dateBs,
      requestType: attendanceRequests.requestType,
      requestedCheckIn: attendanceRequests.requestedCheckIn,
      requestedCheckOut: attendanceRequests.requestedCheckOut,
      previousCheckIn: attendanceRequests.previousCheckIn,
      previousCheckOut: attendanceRequests.previousCheckOut,
      reason: attendanceRequests.reason,
      level: approvalSteps.level,
      employeeId: employees.id,
      employeeCode: employees.employeeCode,
      employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      department: departments.name,
      designation: designations.name,
      shiftName: shifts.name,
      shiftWindow: sql<string | null>`${shifts.startTime} || ' – ' || ${shifts.endTime}`,
      currentStatus: attendanceDays.status,
      currentWorked: attendanceDays.workedMinutes,
    })
    .from(approvalSteps)
    .innerJoin(attendanceRequests, eq(attendanceRequests.id, approvalSteps.entityId))
    .innerJoin(employees, eq(employees.id, attendanceRequests.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(
      attendanceDays,
      and(
        eq(attendanceDays.employeeId, attendanceRequests.employeeId),
        eq(attendanceDays.date, attendanceRequests.date),
      ),
    )
    .leftJoin(shifts, eq(shifts.id, attendanceDays.shiftId))
    .where(
      and(
        eq(approvalSteps.orgId, viewer.orgId),
        eq(approvalSteps.entityType, ATTENDANCE_ENTITY),
        eq(approvalSteps.decision, "pending"),
        eq(attendanceRequests.status, "pending"),
        eq(approvalSteps.level, attendanceRequests.currentLevel),
        seesEverything || !viewer.employeeId
          ? undefined
          : eq(approvalSteps.approverEmployeeId, viewer.employeeId),
      ),
    )
    .orderBy(asc(attendanceRequests.date));

  return (
    <>
      <PageHeader
        title="Attendance approvals"
        description={
          seesEverything
            ? "Every correction waiting on a decision"
            : "Corrections routed to you at the level they have reached"
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing waiting on you"
            hint="Approving a correction rewrites the day and recalculates lateness and overtime."
          />
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {rows.map((r) => (
            <AttendanceDecisionCard
              key={r.requestId}
              request={{
                ...r,
                typeLabel: REQUEST_TYPE_LABEL[r.requestType] ?? r.requestType,
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}
