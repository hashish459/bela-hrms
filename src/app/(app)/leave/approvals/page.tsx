import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { departments, designations } from "@/db/schema/org";
import { approvalSteps, leaveBalances, leaveRequests, leaveTypes } from "@/db/schema/leave";
import { can, requirePermission } from "@/lib/session";
import { LEAVE_ENTITY } from "@/lib/leave";
import { formatDays } from "@/lib/utils";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { DecisionCard } from "./decision-card";

export const metadata = { title: "Leave approvals" };

export default async function ApprovalsPage() {
  const viewer = await requirePermission("leave.request.approve");
  const seesEverything = can(viewer, "leave.request.viewAll");

  // A supervisor sees only what is routed to them at the level currently
  // outstanding. HR sees the whole queue.
  const rows = await db
    .select({
      requestId: leaveRequests.id,
      reference: leaveRequests.reference,
      fromDate: leaveRequests.fromDate,
      toDate: leaveRequests.toDate,
      fromDateBs: leaveRequests.fromDateBs,
      toDateBs: leaveRequests.toDateBs,
      totalDays: leaveRequests.totalDays,
      portion: leaveRequests.portion,
      reason: leaveRequests.reason,
      contact: leaveRequests.contactDuringLeave,
      submittedAt: leaveRequests.submittedAt,
      level: approvalSteps.level,
      approverLabel: approvalSteps.approverLabel,
      employeeId: employees.id,
      employeeCode: employees.employeeCode,
      employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      department: departments.name,
      designation: designations.name,
      leaveType: leaveTypes.name,
      leaveColour: leaveTypes.colour,
      leaveTypeId: leaveTypes.id,
      deducts: leaveTypes.deductsBalance,
    })
    .from(approvalSteps)
    .innerJoin(leaveRequests, eq(leaveRequests.id, approvalSteps.entityId))
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(
      and(
        eq(approvalSteps.orgId, viewer.orgId),
        eq(approvalSteps.entityType, LEAVE_ENTITY),
        eq(approvalSteps.decision, "pending"),
        eq(leaveRequests.status, "pending"),
        eq(approvalSteps.level, leaveRequests.currentLevel),
        seesEverything || !viewer.employeeId
          ? undefined
          : eq(approvalSteps.approverEmployeeId, viewer.employeeId),
      ),
    )
    .orderBy(asc(leaveRequests.fromDate));

  // balance context, so an approver can see what they are spending
  const balances = new Map<string, { available: number; entitled: number }>();
  if (rows.length && viewer.fiscalYear) {
    const balanceRows = await db
      .select({
        employeeId: leaveBalances.employeeId,
        leaveTypeId: leaveBalances.leaveTypeId,
        entitled: leaveBalances.entitled,
        carried: leaveBalances.carriedForward,
        used: leaveBalances.used,
        pending: leaveBalances.pending,
      })
      .from(leaveBalances)
      .where(eq(leaveBalances.fiscalYearId, viewer.fiscalYear.id));

    for (const b of balanceRows) {
      const entitled = Number(b.entitled) + Number(b.carried);
      balances.set(`${b.employeeId}:${b.leaveTypeId}`, {
        entitled,
        available: entitled - Number(b.used) - Number(b.pending),
      });
    }
  }

  return (
    <>
      <PageHeader
        title="Leave approvals"
        description={
          seesEverything
            ? "Every request waiting on a decision"
            : "Requests routed to you at the level they have reached"
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing waiting on you"
            hint="Requests appear here as soon as they reach your level of the approval chain."
          />
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {rows.map((r) => (
            <DecisionCard
              key={r.requestId}
              request={{
                ...r,
                submittedAt: r.submittedAt?.toISOString() ?? null,
                totalDays: formatDays(r.totalDays),
              }}
              balance={r.deducts ? (balances.get(`${r.employeeId}:${r.leaveTypeId}`) ?? null) : null}
            />
          ))}
        </div>
      )}
    </>
  );
}
