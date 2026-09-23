import { Suspense } from "react";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { branches, departments } from "@/db/schema/org";
import { requirePermission } from "@/lib/session";
import { todayInNepal } from "@/lib/bs";
import { PageHeader } from "@/components/ui";
import { ReportToolbar } from "@/components/reports/report-toolbar";
import { ReportTabs } from "@/components/reports/report-tabs";
import { ATTENDANCE_REPORT_TABS } from "./tabs";

/**
 * The frame every attendance report shares: the filter bar and the tabs.
 *
 * In a layout so they survive switching tabs — the period picker does not
 * flicker, and a half-typed search is not lost. The filters themselves live in
 * the URL, which is what each page and the CSV export read.
 */
export default async function AttendanceReportsLayout({ children }: LayoutProps<"/attendance/reports">) {
  const viewer = await requirePermission("attendance.record.viewAll");

  const [deptRows, branchRows] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.orgId, viewer.orgId), eq(departments.isActive, true)))
      .orderBy(asc(departments.name)),
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(and(eq(branches.orgId, viewer.orgId), eq(branches.isActive, true)))
      .orderBy(asc(branches.name)),
  ]);

  return (
    <>
      <PageHeader
        title="Attendance reports"
        description={`${viewer.orgName} — attendance, punctuality, absence and overtime for any period.`}
      />

      <Suspense fallback={<div className="h-[5.5rem] rounded-md border border-line bg-surface" />}>
        <ReportToolbar today={todayInNepal()} departments={deptRows} branches={branchRows} />
      </Suspense>

      <div className="mt-4">
        <Suspense fallback={<div className="h-10 border-b border-line" />}>
          <ReportTabs tabs={ATTENDANCE_REPORT_TABS} />
        </Suspense>
      </div>

      {children}
    </>
  );
}
