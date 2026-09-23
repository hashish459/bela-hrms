import { pageOf } from "@/lib/pagination";
import { OffsetPagination } from "@/components/pagination";
import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, onStrength } from "@/db/schema/hr";
import { can, requirePermission } from "@/lib/session";
import { loadEmployeeFormOptions } from "@/lib/options";
import { adToBs, formatBs, todayInNepal } from "@/lib/bs";
import { cn, formatNpr } from "@/lib/utils";
import { Avatar } from "@/components/avatar";
import { Badge, Card, EmptyState, PageHeader, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { applyDueMovements, listMovements, MOVEMENT_LABEL } from "@/modules/people/movements";
import { CancelMovement } from "./cancel-button";
import { MovementForm, type MovablePerson } from "./movement-form";

export const metadata = { title: "Transfers & Promotions" };

const VIEWS = [
  { key: "all", label: "All" },
  { key: "scheduled", label: "Scheduled" },
  { key: "applied", label: "Applied" },
  { key: "cancelled", label: "Cancelled" },
] as const;

/**
 * The movement register: every transfer, promotion and revision, with the ones
 * still to take effect called out. Opening the page applies anything whose date
 * has arrived, so the register never shows a "scheduled" row that is already
 * true — the cron endpoint does the same for the days nobody looks.
 */
export default async function TransfersPage({ searchParams }: PageProps<"/hr/transfers">) {
  const viewer = await requirePermission("hr.employee.view");
  const params = await searchParams;
  const view = VIEWS.find((v) => v.key === params.view)?.key ?? "all";
  const preselect = typeof params.employee === "string" ? params.employee : null;
  const canEdit = can(viewer, "hr.employee.update");
  const showSalary = can(viewer, "hr.employee.viewSalary");

  await applyDueMovements(viewer.orgId);

  const [rows, options, people] = await Promise.all([
    listMovements(viewer.orgId, { status: view === "all" ? null : view }),
    canEdit ? loadEmployeeFormOptions(viewer.orgId) : null,
    canEdit
      ? db
          .select({
            id: employees.id,
            label: sql<string>`${employees.firstName} || ' ' || ${employees.lastName} || ' (' || ${employees.employeeCode} || ')'`,
            branchId: employees.branchId,
            departmentId: employees.departmentId,
            designationId: employees.designationId,
            gradeId: employees.gradeId,
            supervisorId: employees.supervisorId,
            basicSalary: employees.basicSalary,
          })
          .from(employees)
          .where(and(eq(employees.orgId, viewer.orgId), onStrength()))
          .orderBy(asc(employees.firstName))
      : [],
  ]);

  const all = view === "all" ? rows : await listMovements(viewer.orgId);
  const thisYear = adToBs(todayInNepal()).year;
  const scheduled = all.filter((r) => r.status === "scheduled").length;
  const appliedThisYear = all.filter((r) => r.status === "applied" && adToBs(r.effectiveDate).year === thisYear);
  const promotions = appliedThisYear.filter((r) => r.kind === "promotion").length;
  const transfers = appliedThisYear.filter((r) => r.kind === "transfer").length;

  const peopleForForm: MovablePerson[] = (people as MovablePerson[]).map((p) => ({
    ...p,
    basicSalary: showSalary ? p.basicSalary : null,
  }));

  const bs = (d: string) => formatBs(adToBs(d));

  const { items: pagedRows, page: pagedRowsPage } = pageOf(rows, params, { param: "page", sizeParam: "size", sizes: [25, 50, 100] });
  return (
    <>
      <PageHeader
        title="Transfers & Promotions"
        description="Dated placement changes. Each one writes the service history payroll reads for any past date."
        action={
          canEdit && options ? (
            <div className="flex flex-col items-end gap-2">
              <MovementForm
                people={peopleForForm}
                options={options}
                canSeeSalary={showSalary}
                today={todayInNepal()}
                preselect={preselect}
              />
            </div>
          ) : null
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Scheduled" value={scheduled} sub="waiting for their effective date" tone="info" />
        <StatTile label={`Promotions ${thisYear}`} value={promotions} sub="applied this BS year" tone="ok" />
        <StatTile label={`Transfers ${thisYear}`} value={transfers} sub="applied this BS year" tone="accent" />
        <StatTile label={`All movements ${thisYear}`} value={appliedThisYear.length} sub="of every kind" />
      </div>

      <nav className="mb-3 flex gap-1" aria-label="Filter movements">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === "all" ? "/hr/transfers" : `/hr/transfers?view=${v.key}`}
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
          <EmptyState
            title="No movements here"
            hint={canEdit ? "Record a transfer, promotion or salary revision with the button above." : undefined}
          />
        </Card>
      ) : (
        <>
        <TableShell>
          <thead>
            <tr>
              <Th>Reference</Th>
              <Th>Employee</Th>
              <Th>Kind</Th>
              <Th>Effective</Th>
              <Th>Change</Th>
              <Th>By</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((m) => {
              const changes = [
                m.toBranch ? ["Branch", m.fromBranch, m.toBranch] : null,
                m.toDepartment ? ["Department", m.fromDepartment, m.toDepartment] : null,
                m.toDesignation ? ["Designation", m.fromDesignation, m.toDesignation] : null,
                m.toGrade ? ["Grade", m.fromGrade, m.toGrade] : null,
                m.toSupervisor ? ["Supervisor", m.fromSupervisor, m.toSupervisor] : null,
                showSalary && m.toBasicSalary ? ["Basic", formatNpr(m.fromBasicSalary), formatNpr(m.toBasicSalary)] : null,
              ].filter((c): c is [string, string | null, string] => !!c);
              return (
                <Tr key={m.id}>
                  <Td className="font-mono text-xs text-ink-soft">
                    {m.reference}
                    {m.letterNumber ? <span className="block text-[10px] text-ink-faint">{m.letterNumber}</span> : null}
                  </Td>
                  <Td>
                    <Link href={`/hr/employees/${m.employeeId}?tab=service`} className="flex items-center gap-2 text-ink hover:text-accent">
                      <Avatar
                        photoId={m.photoFileId}
                        firstName={m.employeeName.split(" ")[0] ?? "?"}
                        lastName={m.employeeName.split(" ").slice(-1)[0] ?? ""}
                        seed={m.employeeId}
                        size="xs"
                      />
                      <span>
                        <span className="block text-sm font-medium">{m.employeeName}</span>
                        <span className="block font-mono text-[10px] text-ink-faint">{m.employeeCode}</span>
                      </span>
                    </Link>
                  </Td>
                  <Td>{MOVEMENT_LABEL[m.kind]}</Td>
                  <Td className="tabular text-ink-soft">{bs(m.effectiveDate)}</Td>
                  <Td>
                    <ul className="flex flex-col gap-0.5 text-xs">
                      {changes.map(([label, from, to]) => (
                        <li key={label}>
                          <span className="text-ink-faint">{label}:</span> <span className="text-ink-soft">{from ?? "—"}</span>
                          <span className="text-ink-faint"> → </span>
                          <span className="font-medium text-ink">{to}</span>
                        </li>
                      ))}
                      {m.reason ? <li className="text-ink-faint">“{m.reason}”</li> : null}
                    </ul>
                  </Td>
                  <Td className="text-xs text-ink-soft">{m.createdByLabel ?? "—"}</Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={m.status === "applied" ? "ok" : m.status === "scheduled" ? "info" : "neutral"}>{m.status}</Badge>
                      {m.status === "scheduled" && canEdit ? <CancelMovement id={m.id} reference={m.reference} /> : null}
                      {m.status === "cancelled" && m.cancelReason ? (
                        <span className="text-[10px] text-ink-faint">{m.cancelReason}</span>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableShell>
      <OffsetPagination page={pagedRowsPage} params={params} param="page" label="movements" sizes={[25, 50, 100]} sizeParam="size" className="mt-3 rounded-md border border-line bg-surface" />
        </>
      )}
    </>
  );
}
