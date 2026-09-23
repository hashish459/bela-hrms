import { Suspense, type ReactNode } from "react";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { branches, departments } from "@/db/schema/org";
import { todayInNepal } from "@/lib/bs";
import { PageHeader } from "@/components/ui";
import { ReportToolbar } from "./report-toolbar";
import { ReportTabs, type ReportTab } from "./report-tabs";

/**
 * The frame a family of reports shares: title, the filter bar and the tabs.
 *
 * Used from a route's layout so the bar and tabs survive switching tabs — the
 * period picker does not flicker and a half-typed search is not lost. The
 * filters themselves live in the URL, which each page and export reads.
 */
export async function ReportFrame({
  orgId,
  title,
  description,
  tabs,
  clipsToToday = true,
  children,
}: {
  orgId: string;
  clipsToToday?: boolean;
  title: string;
  description: string;
  tabs: ReportTab[];
  children: ReactNode;
}) {
  const [deptRows, branchRows] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.orgId, orgId), eq(departments.isActive, true)))
      .orderBy(asc(departments.name)),
    db
      .select({ id: branches.id, name: branches.name })
      .from(branches)
      .where(and(eq(branches.orgId, orgId), eq(branches.isActive, true)))
      .orderBy(asc(branches.name)),
  ]);

  return (
    <>
      <PageHeader title={title} description={description} />

      <Suspense fallback={<div className="h-[5.5rem] rounded-md border border-line bg-surface" />}>
        <ReportToolbar
          today={todayInNepal()}
          departments={deptRows}
          branches={branchRows}
          clipsToToday={clipsToToday}
        />
      </Suspense>

      <div className="mt-4">
        <Suspense fallback={<div className="h-10 border-b border-line" />}>
          <ReportTabs tabs={tabs} />
        </Suspense>
      </div>

      {children}
    </>
  );
}
