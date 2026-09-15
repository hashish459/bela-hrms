import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { branches, departments, designations, employmentTypes, grades } from "@/db/schema/org";
import { leaveBalances, leaveRequests, leaveTypes } from "@/db/schema/leave";
import { can, requirePermission } from "@/lib/session";
import { adToBs, formatBs } from "@/lib/bs";
import { formatDays, formatNpr } from "@/lib/utils";
import {
  Badge,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  MeterBar,
  StatusBadge,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui";

export const metadata = { title: "Employee" };

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] tracking-wide text-ink-faint uppercase">{label}</dt>
      <dd className="text-sm text-ink">{value ?? "—"}</dd>
    </div>
  );
}

function bs(date: string | null) {
  return date ? formatBs(adToBs(date)) : "—";
}

export default async function EmployeeDetailPage({ params }: PageProps<"/hr/employees/[id]">) {
  const viewer = await requirePermission("hr.employee.view");
  const { id } = await params;

  const [row] = await db
    .select({
      e: employees,
      department: departments.name,
      designation: designations.name,
      branch: branches.name,
      employmentType: employmentTypes.name,
      grade: grades.name,
      supervisorName: sql<string | null>`sup.first_name || ' ' || sup.last_name`,
      supervisorId: sql<string | null>`sup.id`,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(employmentTypes, eq(employmentTypes.id, employees.employmentTypeId))
    .leftJoin(grades, eq(grades.id, employees.gradeId))
    .leftJoin(sql`employees sup`, sql`sup.id = ${employees.supervisorId}`)
    .where(and(eq(employees.id, id), eq(employees.orgId, viewer.orgId)))
    .limit(1);

  if (!row) notFound();
  const e = row.e;

  const [balances, requests, reports] = await Promise.all([
    db
      .select({
        id: leaveBalances.id,
        type: leaveTypes.name,
        colour: leaveTypes.colour,
        entitled: leaveBalances.entitled,
        carried: leaveBalances.carriedForward,
        used: leaveBalances.used,
        pending: leaveBalances.pending,
      })
      .from(leaveBalances)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
      .where(
        and(
          eq(leaveBalances.employeeId, id),
          viewer.fiscalYear
            ? eq(leaveBalances.fiscalYearId, viewer.fiscalYear.id)
            : sql`true`,
        ),
      )
      .orderBy(leaveTypes.name),

    db
      .select({
        id: leaveRequests.id,
        reference: leaveRequests.reference,
        type: leaveTypes.name,
        fromDateBs: leaveRequests.fromDateBs,
        toDateBs: leaveRequests.toDateBs,
        totalDays: leaveRequests.totalDays,
        status: leaveRequests.status,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(eq(leaveRequests.employeeId, id))
      .orderBy(desc(leaveRequests.fromDate))
      .limit(8),

    db
      .select({
        id: employees.id,
        code: employees.employeeCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
        designation: designations.name,
      })
      .from(employees)
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .where(eq(employees.supervisorId, id))
      .orderBy(employees.employeeCode),
  ]);

  const showSalary = can(viewer, "hr.employee.viewSalary");

  return (
    <>
      <Link
        href="/hr/employees"
        className="mb-3 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Employees
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div className="flex items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent-soft text-base font-semibold text-accent">
            {e.firstName[0]}
            {e.lastName[0]}
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">
              {e.firstName} {e.middleName ? `${e.middleName} ` : ""}
              {e.lastName}
            </h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              <span className="font-mono text-xs">{e.employeeCode}</span>
              <span>·</span>
              <span>{row.designation ?? "No designation"}</span>
              <span>·</span>
              <span>{row.department ?? "No department"}</span>
              <StatusBadge value={e.status} />
            </p>
            {e.fullNameNepali ? (
              <p className="mt-0.5 text-sm text-ink-faint">{e.fullNameNepali}</p>
            ) : null}
          </div>
        </div>
        {can(viewer, "hr.employee.update") ? (
          <ButtonLink href={`/hr/employees/${e.id}/edit`} variant="secondary">
            Edit
          </ButtonLink>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Employment" />
            <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
              <Detail label="Branch" value={row.branch} />
              <Detail label="Employment type" value={row.employmentType} />
              <Detail label="Grade" value={row.grade} />
              <Detail label="Date of join" value={bs(e.dateOfJoin)} />
              <Detail label="Confirmed" value={bs(e.confirmationDate)} />
              <Detail
                label="Reports to"
                value={
                  row.supervisorId ? (
                    <Link
                      href={`/hr/employees/${row.supervisorId}`}
                      className="text-accent hover:underline"
                    >
                      {row.supervisorName}
                    </Link>
                  ) : (
                    "—"
                  )
                }
              />
              {showSalary ? (
                <Detail label="Basic salary" value={formatNpr(e.basicSalary)} />
              ) : null}
              {e.separationDate ? (
                <Detail label="Separated" value={bs(e.separationDate)} />
              ) : null}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Personal & statutory" />
            <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
              <Detail label="Gender" value={<span className="capitalize">{e.gender}</span>} />
              <Detail
                label="Marital status"
                value={e.maritalStatus ? <span className="capitalize">{e.maritalStatus}</span> : null}
              />
              <Detail label="Date of birth" value={bs(e.dateOfBirth)} />
              <Detail label="Work email" value={e.workEmail} />
              <Detail label="Mobile" value={e.mobile} />
              <Detail label="District" value={e.district} />
              <Detail label="PAN" value={<span className="font-mono text-xs">{e.panNumber}</span>} />
              <Detail label="SSF" value={<span className="font-mono text-xs">{e.ssfNumber}</span>} />
              <Detail label="Provident fund" value={<span className="font-mono text-xs">{e.pfNumber}</span>} />
              {showSalary ? (
                <Detail label="Bank" value={`${e.bankName ?? "—"}`} />
              ) : null}
              {showSalary ? (
                <Detail
                  label="Account"
                  value={<span className="font-mono text-xs">{e.bankAccountNumber}</span>}
                />
              ) : null}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Recent leave" description="Most recent eight requests" />
            {requests.length === 0 ? (
              <EmptyState title="No leave requests yet" />
            ) : (
              <TableShell>
                <thead>
                  <tr>
                    <Th>Reference</Th>
                    <Th>Type</Th>
                    <Th>From (BS)</Th>
                    <Th>To (BS)</Th>
                    <Th className="text-right">Days</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <Tr key={r.id}>
                      <Td className="font-mono text-xs text-ink-soft">{r.reference}</Td>
                      <Td>{r.type}</Td>
                      <Td className="tabular text-ink-soft">{r.fromDateBs}</Td>
                      <Td className="tabular text-ink-soft">{r.toDateBs}</Td>
                      <Td className="tabular text-right">{formatDays(r.totalDays)}</Td>
                      <Td>
                        <StatusBadge value={r.status} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Leave balances"
              description={viewer.fiscalYear ? `Fiscal year ${viewer.fiscalYear.code}` : undefined}
            />
            {balances.length === 0 ? (
              <EmptyState title="No balances allocated" />
            ) : (
              <ul className="divide-y divide-line-soft">
                {balances.map((b) => {
                  const entitled = Number(b.entitled) + Number(b.carried);
                  const used = Number(b.used);
                  const pending = Number(b.pending);
                  const available = entitled - used - pending;
                  return (
                    <li key={b.id} className="px-4 py-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-sm text-ink">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: b.colour }}
                            aria-hidden
                          />
                          {b.type}
                        </span>
                        <span className="tabular text-sm font-medium text-ink">
                          {formatDays(available)}
                          <span className="text-xs font-normal text-ink-faint">
                            {" "}
                            / {formatDays(entitled)}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <MeterBar
                          used={used + pending}
                          total={entitled}
                          tone={available <= 0 ? "danger" : pending > 0 ? "warn" : "accent"}
                        />
                      </div>
                      {pending > 0 ? (
                        <p className="mt-1 text-[11px] text-warn">
                          {formatDays(pending)} awaiting approval
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Direct reports" description={`${reports.length} people`} />
            {reports.length === 0 ? (
              <EmptyState title="No direct reports" />
            ) : (
              <ul className="divide-y divide-line-soft">
                {reports.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <Link
                      href={`/hr/employees/${r.id}`}
                      className="truncate text-sm text-ink hover:text-accent"
                    >
                      {r.firstName} {r.lastName}
                    </Link>
                    <Badge>{r.designation ?? r.code}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
