import { requirePermission } from "@/lib/session";
import { ReportFrame } from "@/components/reports/report-frame";
import { ATTENDANCE_REPORT_TABS } from "./tabs";
import { REPORT_PERMISSION } from "./data";

export default async function AttendanceReportsLayout({ children }: LayoutProps<"/attendance/reports">) {
  const viewer = await requirePermission(REPORT_PERMISSION);
  return (
    <ReportFrame
      orgId={viewer.orgId}
      title="Attendance reports"
      description={`${viewer.orgName} — attendance, punctuality, absence and overtime for any period.`}
      tabs={ATTENDANCE_REPORT_TABS}
    >
      {children}
    </ReportFrame>
  );
}
