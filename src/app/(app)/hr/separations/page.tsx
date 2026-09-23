import { pageOf } from "@/lib/pagination";
import { OffsetPagination } from "@/components/pagination";
import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, onStrength } from "@/db/schema/hr";
import { can, requirePermission } from "@/lib/session";
import { adToBs, daysUntil, formatBs, todayInNepal } from "@/lib/bs";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/avatar";
import { Badge, Card, EmptyState, MeterBar, PageHeader, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { listSeparations, SEPARATION_LABEL } from "@/modules/people/separations";
import { InitiateSeparation } from "./initiate-form";

export const metadata = { title: "Separations" };

const VIEWS = [
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
] as const;

export default async function SeparationsPage({ searchParams }: PageProps<"/hr/separations">) {
  const viewer = await requirePermission("hr.employee.separate");
  const params = await searchParams;
  const view = VIEWS.find((v) => v.key === params.view)?.key ?? "in_progress";
  const preselect = typeof params.employee === "string" ? params.employee : null;
  const today = todayInNepal();

  const [rows, all, people] = await Promise.all([
    listSeparations(viewer.orgId, { status: view === "all" ? null : view }),
    listSeparations(viewer.orgId),
    db
      .select({
        id: employees.id,
        label: sql<string>`${employees.firstName} || ' ' || ${employees.lastName} || ' (' || ${employees.employeeCode} || ')'`,
        noticeDays: employees.noticePeriodDays,
      })
      .from(employees)
      .where(
        and(
          eq(employees.orgId, viewer.orgId),
          onStrength(),
          sql`not exists (select 1 from employee_separations s where s.employee_id = ${employees.id} and s.status = 'in_progress')`,
        ),
      )
      .orderBy(asc(employees.firstName)),
  ]);

  const open = all.filter((r) => r.status === "in_progress");
  const leavingSoon = open.filter((r) => r.lastWorkingDate >= today && daysUntil(today, r.lastWorkingDate) <= 30).length;
  const overdue = open.filter((r) => r.lastWorkingDate < today).length;
  const year = adToBs(today).year;
  const completedThisYear = all.filter((r) => r.status === "completed" && adToBs(r.lastWorkingDate).year === year).length;
  const bs = (d: string) => formatBs(adToBs(d));

  const { items: pagedRows, page: pagedRowsPage } = pageOf(rows, params, { param: "page", sizeParam: "size", sizes: [25, 50, 100] });
  return (
    <>
      <PageHeader
        title="Separations"
        description="Resignations, terminations and retirements — notice, no-dues clearance, exit interview and final settlement."
        action={can(viewer, "hr.employee.separate") ? <InitiateSeparation people={people} today={today} preselect={preselect} /> : null}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open cases" value={open.length} sub="serving notice or in clearance" tone="warn" />
        <StatTile label="Leaving within 30 days" value={leavingSoon} tone="info" />
        <StatTile label="Past last day, not closed" value={overdue} sub="clearance still open" tone={overdue ? "danger" : "neutral"} />
        <StatTile label={`Separated in ${year}`} value={completedThisYear} sub="completed this BS year" />
      </div>

      <nav className="mb-3 flex gap-1" aria-label="Filter separations">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === "in_progress" ? "/hr/separations" : `/hr/separations?view=${v.key}`}
            className={cn(
              "rounded px-2.5 py-1 text-sm",
              view === v.key ? "bg-accent-soft font-medium text-accent" : "text-ink-soft hover:bg-sunk hover:text-ink",
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="No separations here" />
        </Card>
      ) : (
        <>
        <TableShell>
          <thead>
            <tr>
              <Th>Reference</Th>
              <Th>Employee</Th>
              <Th>Kind</Th>
              <Th>Notice</Th>
              <Th>Last day</Th>
              <Th>Clearance</Th>
              <Th>Settlement</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((r) => {
              const days = daysUntil(today, r.lastWorkingDate);
              return (
                <Tr key={r.id}>
                  <Td className="font-mono text-xs">
                    <Link href={`/hr/separations/${r.id}`} className="text-accent hover:underline">
                      {r.reference}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/hr/separations/${r.id}`} className="flex items-center gap-2 text-ink hover:text-accent">
                      <Avatar
                        photoId={r.photoFileId}
                        firstName={r.employeeName.split(" ")[0] ?? "?"}
                        lastName={r.employeeName.split(" ").slice(-1)[0] ?? ""}
                        seed={r.employeeId}
                        size="xs"
                      />
                      <span>
                        <span className="block text-sm font-medium">{r.employeeName}</span>
                        <span className="block text-[10px] text-ink-faint">{r.designation ?? r.employeeCode}</span>
                      </span>
                    </Link>
                  </Td>
                  <Td>{SEPARATION_LABEL[r.kind]}</Td>
                  <Td className="tabular text-ink-soft">{bs(r.noticeDate)}</Td>
                  <Td className="tabular">
                    {bs(r.lastWorkingDate)}
                    {r.status === "in_progress" ? (
                      <span className={cn("block text-[10px]", days < 0 ? "text-danger" : "text-ink-faint")}>
                        {days < 0 ? `${-days} days ago` : days === 0 ? "today" : `in ${days} days`}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="w-40">
                    <MeterBar used={r.cleared} total={r.total} tone={r.cleared === r.total ? "ok" : "warn"} />
                    <span className="text-[10px] text-ink-faint">
                      {r.cleared} of {r.total} cleared
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={r.settlementStatus === "processed" ? "ok" : r.settlementStatus === "pending" ? "warn" : "neutral"}>
                      {r.settlementStatus.replace(/_/g, " ")}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={r.status === "completed" ? "neutral" : r.status === "in_progress" ? "warn" : "neutral"}>
                      {r.status.replace(/_/g, " ")}
                    </Badge>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableShell>
      <OffsetPagination page={pagedRowsPage} params={params} param="page" label="cases" sizes={[25, 50, 100]} sizeParam="size" className="mt-3 rounded-md border border-line bg-surface" />
        </>
      )}
    </>
  );
}
