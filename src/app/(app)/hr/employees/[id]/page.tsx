import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarClock,
  Mail,
  MapPin,
  Phone,
  ShieldAlert,
} from "lucide-react";
import { db } from "@/db/client";
import { employees, probationReviews } from "@/db/schema/hr";
import { branches, departments, designations, employmentTypes, grades } from "@/db/schema/org";
import { leaveBalances, leaveRequests, leaveTypes } from "@/db/schema/leave";
import { employeeDocuments } from "@/db/schema/selfservice";
import { can, requirePermission } from "@/lib/session";
import { adToBs, daysUntil, formatBs, todayInNepal } from "@/lib/bs";
import { formatDays, formatNpr } from "@/lib/utils";
import {
  daysToProbationEnd,
  PROBATION_TONE,
  probationLabel,
  probationState,
} from "@/modules/people/confirmation";
import { daysUntilExpiry, expiryLabel, expiryState } from "@/modules/people/documents";
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
import { Avatar } from "@/components/avatar";
import { DocumentTable, type DocumentRow } from "../../documents/document-table";
import { PhotoUpload } from "./photo-upload";

export const metadata = { title: "Employee" };

/**
 * The personal information record.
 *
 * The legacy `EmployeeInfo` table had 263 columns and the screen over it was a
 * form with every one of them, which is a data-entry surface rather than a
 * record anybody reads. This page is organised around the questions somebody
 * actually opens it to answer: who is this, where do they sit, what is
 * outstanding on them, and what is on file.
 *
 * Anything with a deadline attached — probation falling due, a document past
 * its expiry — is surfaced at the top rather than filed in a tab, because the
 * failure mode of a personnel record is not that the data is missing, it is
 * that nobody looked at it in time.
 */

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] tracking-wide text-ink-faint uppercase">{label}</dt>
      <dd className="text-sm text-ink">{value || "—"}</dd>
    </div>
  );
}

function bs(date: string | null) {
  return date ? formatBs(adToBs(date)) : null;
}

/** A contact detail, shown only when there is one. */
function Chip({ icon: Icon, children }: { icon: typeof Mail; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface/70 px-2.5 py-1 text-xs text-ink-soft ring-1 ring-line-soft">
      <Icon className="size-3.5 shrink-0 text-ink-faint" />
      <span className="truncate">{children}</span>
    </span>
  );
}

export default async function EmployeeDetailPage({ params }: PageProps<"/hr/employees/[id]">) {
  const viewer = await requirePermission("hr.employee.view");
  const { id } = await params;
  const today = todayInNepal();

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
      supervisorCode: sql<string | null>`sup.employee_code`,
      supervisorPhoto: sql<string | null>`sup.photo_file_id`,
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

  const canManageDocuments = can(viewer, "hr.document.manage");

  const [balances, requests, reports, documents, reviews] = await Promise.all([
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
          viewer.fiscalYear ? eq(leaveBalances.fiscalYearId, viewer.fiscalYear.id) : sql`true`,
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
        photoFileId: employees.photoFileId,
        designation: designations.name,
      })
      .from(employees)
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .where(eq(employees.supervisorId, id))
      .orderBy(employees.employeeCode),

    db
      .select({
        id: employeeDocuments.id,
        kind: employeeDocuments.kind,
        title: employeeDocuments.title,
        referenceNumber: employeeDocuments.referenceNumber,
        issuedOn: employeeDocuments.issuedOn,
        expiresOn: employeeDocuments.expiresOn,
        status: employeeDocuments.status,
        reviewedBy: employeeDocuments.reviewedBy,
        reviewNote: employeeDocuments.reviewNote,
        isVisibleToEmployee: employeeDocuments.isVisibleToEmployee,
        fileId: employeeDocuments.fileId,
        fileUrl: employeeDocuments.fileUrl,
      })
      .from(employeeDocuments)
      .where(
        and(eq(employeeDocuments.orgId, viewer.orgId), eq(employeeDocuments.employeeId, id)),
      )
      .orderBy(sql`${employeeDocuments.expiresOn} ASC NULLS LAST`, desc(employeeDocuments.createdAt)),

    db
      .select({
        id: probationReviews.id,
        outcome: probationReviews.outcome,
        effectiveDate: probationReviews.effectiveDate,
        newProbationEndDate: probationReviews.newProbationEndDate,
        remarks: probationReviews.remarks,
        decidedBy: probationReviews.decidedByLabel,
      })
      .from(probationReviews)
      .where(eq(probationReviews.employeeId, id))
      .orderBy(desc(probationReviews.decidedAt))
      .limit(5),
  ]);

  const showSalary = can(viewer, "hr.employee.viewSalary");
  const canEdit = can(viewer, "hr.employee.update");

  const documentRows: DocumentRow[] = documents.map((d) => {
    const state = expiryState(d.expiresOn, today);
    return {
      id: d.id,
      employeeId: id,
      employeeName: `${e.firstName} ${e.lastName}`,
      employeeCode: e.employeeCode,
      photoFileId: e.photoFileId,
      kind: d.kind,
      title: d.title,
      referenceNumber: d.referenceNumber,
      issuedOn: d.issuedOn,
      issuedOnBs: bs(d.issuedOn),
      expiresOn: d.expiresOn,
      expiresOnBs: bs(d.expiresOn),
      expiryState: state,
      expiryLabel: expiryLabel(state, daysUntilExpiry(d.expiresOn, today)),
      status: d.status,
      reviewedBy: d.reviewedBy,
      reviewNote: d.reviewNote,
      isVisibleToEmployee: d.isVisibleToEmployee,
      fileId: d.fileId,
      fileUrl: d.fileUrl,
    };
  });

  const documentAlerts = documentRows.filter(
    (d) => d.expiryState === "expired" || d.expiryState === "expiring",
  );

  const onProbation = e.status === "probation";
  const probation = probationState(e.probationEndDate, today);
  const probationDays = daysToProbationEnd(e.probationEndDate, today);
  const serviceMonths = Math.max(0, Math.floor(daysUntil(e.dateOfJoin, today) / 30));

  return (
    <>
      <Link
        href="/hr/employees"
        className="mb-3 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Employees
      </Link>

      {/* ------------------------------------------------------------- hero */}
      <Card className="overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-accent/90 via-accent to-info/70" aria-hidden />

        <div className="flex flex-wrap items-end gap-4 px-4 pb-4">
          <div className="-mt-12">
            <PhotoUpload
              employeeId={e.id}
              photoId={e.photoFileId}
              photoUrl={e.photoUrl}
              firstName={e.firstName}
              lastName={e.lastName}
              canEdit={canEdit}
            />
          </div>

          <div className="min-w-0 flex-1 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-ink">
                {e.firstName} {e.middleName ? `${e.middleName} ` : ""}
                {e.lastName}
              </h1>
              <StatusBadge value={e.status} />
              {e.confirmationDate ? (
                <Badge tone="ok">
                  <BadgeCheck className="mr-1 size-3" />
                  Confirmed {bs(e.confirmationDate)}
                </Badge>
              ) : null}
            </div>

            {e.fullNameNepali ? (
              <p className="mt-0.5 text-sm text-ink-faint">{e.fullNameNepali}</p>
            ) : null}

            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
              <span className="font-mono text-xs">{e.employeeCode}</span>
              <span aria-hidden>·</span>
              <span>{row.designation ?? "No designation"}</span>
              <span aria-hidden>·</span>
              <span>{row.department ?? "No department"}</span>
            </p>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Chip icon={Mail}>{e.workEmail}</Chip>
              <Chip icon={Phone}>{e.mobile}</Chip>
              <Chip icon={Building2}>{row.branch}</Chip>
              <Chip icon={MapPin}>{e.district}</Chip>
              <Chip icon={CalendarClock}>
                {serviceMonths >= 12
                  ? `${Math.floor(serviceMonths / 12)}y ${serviceMonths % 12}m of service`
                  : `${serviceMonths} months of service`}
              </Chip>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            {onProbation ? (
              <ButtonLink href="/hr/confirmations" variant="secondary">
                <BadgeCheck className="size-4" />
                Review probation
              </ButtonLink>
            ) : null}
            {canEdit ? (
              <ButtonLink href={`/hr/employees/${e.id}/edit`} variant="secondary">
                Edit
              </ButtonLink>
            ) : null}
          </div>
        </div>
      </Card>

      {/* -------------------------------------------------------- what is due */}
      {onProbation || documentAlerts.length > 0 ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {onProbation ? (
            <div
              className={
                probation === "overdue" || probation === "unscheduled"
                  ? "flex items-start gap-3 rounded-md border border-danger/40 bg-danger-soft/50 p-3"
                  : "flex items-start gap-3 rounded-md border border-warn/40 bg-warn-soft/50 p-3"
              }
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  On probation — {probationLabel(probation, probationDays)}
                </p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {e.probationEndDate
                    ? `Probation ends ${bs(e.probationEndDate)}. `
                    : "No probation end date has been set, so no review will ever fall due. "}
                  <Link href="/hr/confirmations" className="text-accent hover:underline">
                    Record a decision
                  </Link>
                </p>
              </div>
              <Badge tone={PROBATION_TONE[probation]}>{probation}</Badge>
            </div>
          ) : null}

          {documentAlerts.length > 0 ? (
            <div className="flex items-start gap-3 rounded-md border border-warn/40 bg-warn-soft/50 p-3">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-warn" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {documentAlerts.length} document{documentAlerts.length === 1 ? "" : "s"} need
                  attention
                </p>
                <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-soft">
                  {documentAlerts.slice(0, 4).map((d) => (
                    <li key={d.id}>
                      {d.title} — {d.expiryLabel}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Employment" />
            <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
              <Detail label="Branch" value={row.branch} />
              <Detail label="Employment type" value={row.employmentType} />
              <Detail label="Grade" value={row.grade} />
              <Detail label="Date of join" value={bs(e.dateOfJoin)} />
              <Detail label="Probation ends" value={bs(e.probationEndDate)} />
              <Detail label="Confirmed" value={bs(e.confirmationDate)} />
              <Detail
                label="Reports to"
                value={
                  row.supervisorId ? (
                    <Link
                      href={`/hr/employees/${row.supervisorId}`}
                      className="inline-flex items-center gap-1.5 text-accent hover:underline"
                    >
                      <Avatar
                        photoId={row.supervisorPhoto}
                        firstName={(row.supervisorName ?? "?").split(" ")[0] ?? "?"}
                        lastName={(row.supervisorName ?? "").split(" ").slice(-1)[0] ?? ""}
                        seed={row.supervisorId}
                        size="xs"
                      />
                      {row.supervisorName}
                    </Link>
                  ) : canEdit ? (
                    <Link href="/hr/reporting-lines" className="text-warn hover:underline">
                      Not set — assign one
                    </Link>
                  ) : null
                }
              />
              {showSalary ? <Detail label="Basic salary" value={formatNpr(e.basicSalary)} /> : null}
              {e.separationDate ? <Detail label="Separated" value={bs(e.separationDate)} /> : null}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Personal & statutory" />
            <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3">
              <Detail label="Gender" value={<span className="capitalize">{e.gender}</span>} />
              <Detail
                label="Marital status"
                value={
                  e.maritalStatus ? <span className="capitalize">{e.maritalStatus}</span> : null
                }
              />
              <Detail label="Date of birth" value={bs(e.dateOfBirth)} />
              <Detail label="Work email" value={e.workEmail} />
              <Detail label="Mobile" value={e.mobile} />
              <Detail label="District" value={e.district} />
              <Detail label="PAN" value={<span className="font-mono text-xs">{e.panNumber}</span>} />
              <Detail label="SSF" value={<span className="font-mono text-xs">{e.ssfNumber}</span>} />
              <Detail
                label="Provident fund"
                value={<span className="font-mono text-xs">{e.pfNumber}</span>}
              />
              {showSalary ? <Detail label="Bank" value={e.bankName} /> : null}
              {showSalary ? (
                <Detail
                  label="Account"
                  value={<span className="font-mono text-xs">{e.bankAccountNumber}</span>}
                />
              ) : null}
            </dl>
          </Card>

          {canManageDocuments ? (
            <Card>
              <DocumentTable
                rows={documentRows}
                fixedEmployeeId={id}
                canManage
                showEmployee={false}
                title="Documents"
                description="Contracts, certificates and identity papers held on this record."
                emptyHint="Nothing filed yet. Contracts and identity documents belong here so their expiry is tracked."
              />
            </Card>
          ) : null}

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

          {reviews.length > 0 ? (
            <Card>
              <CardHeader
                title="Probation history"
                description="Every decision taken, and by whom"
              />
              <ul className="divide-y divide-line-soft">
                {reviews.map((r) => (
                  <li key={r.id} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Badge
                        tone={
                          r.outcome === "confirmed"
                            ? "ok"
                            : r.outcome === "extended"
                              ? "warn"
                              : "danger"
                        }
                      >
                        {r.outcome}
                      </Badge>
                      <span className="tabular text-xs text-ink-soft">
                        {bs(r.effectiveDate)}
                        {r.newProbationEndDate ? ` → ${bs(r.newProbationEndDate)}` : ""}
                      </span>
                    </div>
                    {r.remarks ? (
                      <p className="mt-1 text-xs text-ink-soft">{r.remarks}</p>
                    ) : null}
                    {r.decidedBy ? (
                      <p className="mt-0.5 text-[11px] text-ink-faint">by {r.decidedBy}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Direct reports"
              description={`${reports.length} ${reports.length === 1 ? "person" : "people"}`}
              action={
                canEdit ? (
                  <Link
                    href="/hr/reporting-lines"
                    className="text-xs text-accent hover:underline"
                  >
                    Edit lines
                  </Link>
                ) : undefined
              }
            />
            {reports.length === 0 ? (
              <EmptyState title="No direct reports" />
            ) : (
              <ul className="divide-y divide-line-soft">
                {reports.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <Link
                      href={`/hr/employees/${r.id}`}
                      className="flex min-w-0 items-center gap-2 text-sm text-ink hover:text-accent"
                    >
                      <Avatar
                        photoId={r.photoFileId}
                        firstName={r.firstName}
                        lastName={r.lastName}
                        seed={r.id}
                        size="xs"
                      />
                      <span className="truncate">
                        {r.firstName} {r.lastName}
                      </span>
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
