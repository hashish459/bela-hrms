import { requirePermission } from "@/lib/session";
import { ReportFrame } from "@/components/reports/report-frame";
import { LEAVE_REPORT_TABS } from "./tabs";
import { REPORT_PERMISSION } from "./data";

export default async function LeaveReportsLayout({ children }: LayoutProps<"/leave/reports">) {
  const viewer = await requirePermission(REPORT_PERMISSION);
  return (
    <ReportFrame
      orgId={viewer.orgId}
      title="Leave reports"
      description={`${viewer.orgName} — leave taken, balances, utilisation and approvals for any period.`}
      tabs={LEAVE_REPORT_TABS}
      clipsToToday={false}
    >
      {children}
    </ReportFrame>
  );
}
