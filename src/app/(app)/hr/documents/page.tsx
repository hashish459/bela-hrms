import Link from "next/link";
import { and, asc, count, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { CalendarClock } from "lucide-react";
import { db } from "@/db/client";
import { employees, onStrength } from "@/db/schema/hr";
import { employeeDocuments } from "@/db/schema/selfservice";
import { can, requirePermission } from "@/lib/session";
import { addDays, adToBs, formatBs, todayInNepal } from "@/lib/bs";
import { offsetPage, PAGE_SIZE } from "@/lib/pagination";
import { OffsetPagination } from "@/components/pagination";
import { Badge, Card, CardHeader, PageHeader, StatTile } from "@/components/ui";
import {
  documentDigest,
  EXPIRY_WINDOW_DAYS,
  expiringDocuments,
  expiryLabel,
  expiryState,
  daysUntilExpiry,
} from "@/modules/people/documents";
import { DocumentFilters } from "./filters";
import { DocumentTable, type DocumentRow } from "./document-table";

export const metadata = { title: "Documents" };

/**
 * The document register.
 *
 * Reverse-engineering the system this replaces, `EmpDocumentInfo` held a
 * thousand rows with issue and expiry dates on them, and the only screen that
 * read the table listed documents for one employee at a time. Nothing anywhere
 * answered "what expires next month", so the expiry dates were captured
 * diligently and never acted on.
 *
 * This page is that missing question. The tiles and the reminder card are
 * organisation-wide and computed in SQL, so they describe the organisation
 * rather than the visible page — a count that changed as you paged through
 * would be worse than no count.
 */

function bs(date: string | null) {
  return date ? formatBs(adToBs(date)) : null;
}

export default async function DocumentsPage({ searchParams }: PageProps<"/hr/documents">) {
  const viewer = await requirePermission("hr.document.manage");
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const kind = typeof params.kind === "string" ? params.kind : "";
  const status = typeof params.status === "string" ? params.status : "";
  const expiry = typeof params.expiry === "string" ? params.expiry : "";

  const today = todayInNepal();
  const horizon = addDays(today, EXPIRY_WINDOW_DAYS);

  const filters: SQL[] = [eq(employeeDocuments.orgId, viewer.orgId), isNull(employeeDocuments.deletedAt)];

  if (q) {
    const like = `%${q}%`;
    filters.push(
      or(
        ilike(employeeDocuments.title, like),
        ilike(employeeDocuments.referenceNumber, like),
        ilike(employees.firstName, like),
        ilike(employees.lastName, like),
        ilike(employees.employeeCode, like),
      )!,
    );
  }
  if (kind) {
    filters.push(eq(employeeDocuments.kind, kind as (typeof employeeDocuments.kind.enumValues)[number]));
  }
  if (status) {
    filters.push(
      eq(employeeDocuments.status, status as (typeof employeeDocuments.status.enumValues)[number]),
    );
  }

  // Expiry is a derived state, so the filter has to be expressed as the date
  // ranges that produce it rather than as a stored column.
  if (expiry === "expired") filters.push(sql`${employeeDocuments.expiresOn} < ${today}`);
  else if (expiry === "expiring") {
    filters.push(gte(employeeDocuments.expiresOn, today), lte(employeeDocuments.expiresOn, horizon));
  } else if (expiry === "none") filters.push(isNull(employeeDocuments.expiresOn));
  else if (expiry === "attention") {
    // Everything a person would actually chase: past its date, or close to it.
    filters.push(lte(employeeDocuments.expiresOn, horizon));
  }

  const where = and(...filters);

  const [[total], digest, expiringSoon] = await Promise.all([
    db
      .select({ n: count() })
      .from(employeeDocuments)
      .innerJoin(employees, eq(employees.id, employeeDocuments.employeeId))
      .where(where),
    documentDigest(viewer.orgId, today),
    expiringDocuments(viewer.orgId, 6, today),
  ]);

  const page = offsetPage({
    page: Array.isArray(params.page) ? params.page[0] : params.page,
    total: Number(total.n),
    defaultSize: PAGE_SIZE.compact,
  });

  const [records, employeeOptions] = await Promise.all([
    db
      .select({
        id: employeeDocuments.id,
        employeeId: employeeDocuments.employeeId,
        firstName: employees.firstName,
        lastName: employees.lastName,
        employeeCode: employees.employeeCode,
        photoFileId: employees.photoFileId,
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
      .innerJoin(employees, eq(employees.id, employeeDocuments.employeeId))
      .where(where)
      /*
       * Nulls last, then soonest first. A document with no expiry is not
       * urgent, and Postgres sorts nulls first ascending by default, which would
       * put every permanent certificate above everything about to lapse.
       */
      .orderBy(sql`${employeeDocuments.expiresOn} ASC NULLS LAST`, desc(employeeDocuments.createdAt))
      .limit(page.limit)
      .offset(page.offset),

    db
      .select({
        id: employees.id,
        code: employees.employeeCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .where(
        and(
          eq(employees.orgId, viewer.orgId),
          onStrength(),
        ),
      )
      .orderBy(asc(employees.employeeCode)),
  ]);

  const rows: DocumentRow[] = records.map((r) => {
    const state = expiryState(r.expiresOn, today);
    return {
      id: r.id,
      employeeId: r.employeeId,
      employeeName: `${r.firstName} ${r.lastName}`,
      employeeCode: r.employeeCode,
      photoFileId: r.photoFileId,
      kind: r.kind,
      title: r.title,
      referenceNumber: r.referenceNumber,
      issuedOn: r.issuedOn,
      issuedOnBs: bs(r.issuedOn),
      expiresOn: r.expiresOn,
      expiresOnBs: bs(r.expiresOn),
      expiryState: state,
      expiryLabel: expiryLabel(state, daysUntilExpiry(r.expiresOn, today)),
      status: r.status,
      reviewedBy: r.reviewedBy,
      reviewNote: r.reviewNote,
      isVisibleToEmployee: r.isVisibleToEmployee,
      fileId: r.fileId,
      fileUrl: r.fileUrl,
    };
  });

  const needsAttention = digest.expired + digest.expiring;

  return (
    <>
      <PageHeader
        title="Documents"
        description="Contracts, certificates and identity papers held against each employee, with the expiry dates somebody has to act on."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="On file" value={digest.total} sub="whole organisation" tone="accent" />
        <StatTile
          label="Expired"
          value={digest.expired}
          sub="past the recorded date"
          tone={digest.expired > 0 ? "danger" : "neutral"}
        />
        <StatTile
          label="Expiring"
          value={digest.expiring}
          sub={`within ${EXPIRY_WINDOW_DAYS} days`}
          tone={digest.expiring > 0 ? "warn" : "neutral"}
        />
        <StatTile
          label="Awaiting check"
          value={digest.pending}
          sub={digest.missingFile > 0 ? `${digest.missingFile} with no scan attached` : "verified against the original"}
          tone={digest.pending > 0 ? "info" : "neutral"}
        />
      </div>

      {expiringSoon.length > 0 ? (
        <Card className="mt-4 border-warn/40">
          <CardHeader
            title="Renewal reminders"
            description={`${needsAttention} document${needsAttention === 1 ? "" : "s"} expired or expiring within ${EXPIRY_WINDOW_DAYS} days`}
            action={
              <Link
                href="/hr/documents?expiry=attention"
                className="text-xs text-accent hover:underline"
              >
                See all
              </Link>
            }
          />
          <ul className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {expiringSoon.map((d) => {
              const days = daysUntilExpiry(d.expiresOn, today);
              const state = expiryState(d.expiresOn, today);
              return (
                <li
                  key={d.id}
                  className="flex items-start gap-2 rounded border border-line-soft bg-sunk/40 px-3 py-2"
                >
                  <CalendarClock
                    className={state === "expired" ? "mt-0.5 size-4 text-danger" : "mt-0.5 size-4 text-warn"}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{d.title}</p>
                    <Link
                      href={`/hr/employees/${d.employeeId}`}
                      className="block truncate text-xs text-ink-soft hover:text-accent"
                    >
                      {d.employeeName} · {d.employeeCode}
                    </Link>
                    <p className="mt-1 flex items-center gap-1.5">
                      <Badge tone={state === "expired" ? "danger" : "warn"}>
                        {expiryLabel(state, days)}
                      </Badge>
                      <span className="tabular text-[11px] text-ink-faint">{bs(d.expiresOn)}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="mt-4 mb-3">
        <DocumentFilters />
      </div>

      <Card>
        <DocumentTable
          rows={rows}
          employeeOptions={employeeOptions.map((e) => ({
            id: e.id,
            label: `${e.code} — ${e.firstName} ${e.lastName}`,
          }))}
          canManage={can(viewer, "hr.document.manage")}
          title="Register"
          description={
            page.total === 0
              ? "Nothing filed yet"
              : `${page.total} document${page.total === 1 ? "" : "s"}${q || kind || status || expiry ? " matching these filters" : ""}`
          }
          emptyHint="File a contract, a certificate or an identity document against an employee to start tracking its expiry."
        />
        <OffsetPagination page={page} params={params} label="documents" />
      </Card>
    </>
  );
}
