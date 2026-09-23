import { Suspense } from "react";
import { requirePermission } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { ReportTabs } from "@/components/reports/report-tabs";

const TABS = [
  { href: "/admin/notifications", label: "Rules & overview", icon: "SlidersHorizontal" },
  { href: "/admin/notifications/announcements", label: "Announcements", icon: "Megaphone" },
  { href: "/admin/notifications/log", label: "Delivery log", icon: "ScrollText" },
];

export default async function NotificationsAdminLayout({ children }: LayoutProps<"/admin/notifications">) {
  await requirePermission("admin.notifications.manage");
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Which events notify whom, by which channel and in what words — and what was actually delivered."
      />
      <Suspense fallback={<div className="h-10 border-b border-line" />}>
        <ReportTabs tabs={TABS} />
      </Suspense>
      <div className="mt-5">{children}</div>
    </>
  );
}
