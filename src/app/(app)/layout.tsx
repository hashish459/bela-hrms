import { and, count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalSteps, leaveRequests } from "@/db/schema/leave";
import { attendanceRequests } from "@/db/schema/attendance";
import { AppShell } from "@/components/app-shell";
import { can, requireViewer, type Viewer } from "@/lib/session";
import { visibleNavigation } from "@/modules/registry";
import { ATTENDANCE_ENTITY } from "@/lib/attendance";
import { LEAVE_ENTITY } from "@/lib/leave";
import { adToBs, formatBs, todayInNepal } from "@/lib/bs";
// Registers every functional module with the kernel. Importing it here is the
// whole of installation — see src/kernel/boot.ts.
import { loadModuleStates } from "@/kernel/boot";
import { switchableRoles } from "./admin/act-as/actions";
import { bellSummaryFor, sweepInBackground } from "@/modules/notifications/service";

/**
 * Counts shown against nav items, so somebody can see there is work waiting
 * without opening the queue. Scoped the same way the queue itself is: a
 * supervisor's badge counts only what is routed to them.
 */
async function approvalCounts(viewer: Viewer): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  const canApproveLeave = can(viewer, "leave.request.approve");
  const canApproveAttendance = can(viewer, "attendance.request.approve");
  if (!canApproveLeave && !canApproveAttendance) return counts;

  const routedToMe = (entityType: string, seesAll: boolean) =>
    and(
      eq(approvalSteps.orgId, viewer.orgId),
      eq(approvalSteps.entityType, entityType),
      eq(approvalSteps.decision, "pending"),
      seesAll || !viewer.employeeId
        ? undefined
        : eq(approvalSteps.approverEmployeeId, viewer.employeeId),
    );

  const [leave, attendance] = await Promise.all([
    canApproveLeave
      ? db
          .select({ n: count() })
          .from(approvalSteps)
          .innerJoin(leaveRequests, eq(leaveRequests.id, approvalSteps.entityId))
          .where(
            and(
              routedToMe(LEAVE_ENTITY, can(viewer, "leave.request.viewAll")),
              eq(leaveRequests.status, "pending"),
            ),
          )
      : Promise.resolve([{ n: 0 }]),

    canApproveAttendance
      ? db
          .select({ n: count() })
          .from(approvalSteps)
          .innerJoin(attendanceRequests, eq(attendanceRequests.id, approvalSteps.entityId))
          .where(
            and(
              routedToMe(ATTENDANCE_ENTITY, can(viewer, "attendance.record.viewAll")),
              eq(attendanceRequests.status, "pending"),
            ),
          )
      : Promise.resolve([{ n: 0 }]),
  ]);

  if (Number(leave[0]?.n)) counts["leave.approvals"] = Number(leave[0].n);
  if (Number(attendance[0]?.n)) counts["attendance.approvals"] = Number(attendance[0].n);
  return counts;
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const viewer = await requireViewer();

  // Applies this organisation's module switches before the navigation is built,
  // so a module switched off disappears from the menu rather than 403-ing when
  // somebody clicks it.
  await loadModuleStates(viewer.orgId);

  const modules = visibleNavigation(viewer.permissions);
  const [counts, notifications] = await Promise.all([approvalCounts(viewer), bellSummaryFor(viewer.userId)]);

  // Reminders have no event to trigger them. Throttled to once per half hour
  // per organisation, so a deployment without a scheduler still gets them.
  sweepInBackground(viewer.orgId);

  // Only a system administrator has anything to switch to; everybody else gets
  // an empty list and the control does not render.
  const roles = viewer.isSystemAdmin ? await switchableRoles() : [];
  const today = todayInNepal();

  return (
    <AppShell
      modules={modules}
      counts={counts}
      notifications={notifications}
      viewer={{
        name: viewer.name,
        email: viewer.email,
        orgName: viewer.orgName,
        roleNames: viewer.roleNames,
        isSystemAdmin: viewer.isSystemAdmin,
        actingAs: viewer.actingAs,
        switchableRoles: roles,
        fiscalYear: viewer.fiscalYear?.code ?? null,
        todayBs: formatBs(adToBs(today)),
        todayAd: new Date(today).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
      }}
    >
      {children}
    </AppShell>
  );
}
