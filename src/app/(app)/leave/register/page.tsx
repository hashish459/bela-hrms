import Link from "next/link";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { departments } from "@/db/schema/org";
import { leaveRequests, leaveTypes } from "@/db/schema/leave";
import { requirePermission } from "@/lib/session";
import { offsetPage, PAGE_SIZE } from "@/lib/pagination";
import { OffsetPagination } from "@/components/pagination";
import { formatDays } from "@/lib/utils";
import {
  Card,
  EmptyState,
  PageHeader,
  StatTile,
  StatusBadge,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui";

export const metadata = { title: "Leave register" };

const STATUSES = ["all", "pending", "approved", "rejected", "cancelled"] as const;

export default async function LeaveRegisterPage({ searchParams }: PageProps<"/leave/register">) {
  const viewer = await requirePermission("leave.request.viewAll");
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "all";

  const filters: SQL[] = [eq(leaveRequests.orgId, viewer.orgId)];
  if (status !== "all" && (STATUSES as readonly string[]).includes(status)) {
    filters.push(eq(leaveRequests.status, status as "pending"));
  }

  /*
   * Offset, not keyset. The register is browsed deliberately — somebody filters
   * to "rejected" and wants page 3 of 9, or the last page — and the set is
   * bounded by the fiscal year, so walking a few hundred rows costs nothing.
   * The audit log makes the opposite trade for the opposite reasons; see
   * lib/pagination.ts.
   *
   * The count runs first so the page number can be clamped into range: a stale
   * `?page=8` after switching to a narrower filter must land on the last page,
   * not on an empty table that reads as "no requests".
   */
  const [total] = await db
    .select({ n: count() })
    .from(leaveRequests)
    .where(and(...filters));

  const page = offsetPage({
    page: Array.isArray(params.page) ? params.page[0] : params.page,
    total: Number(total.n),
    defaultSize: PAGE_SIZE.compact,
  });

  const [rows, tallies] = await Promise.all([
    db
      .select({
        id: leaveRequests.id,
        reference: leaveRequests.reference,
        employeeId: employees.id,
        employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        employeeCode: employees.employeeCode,
        department: departments.name,
        type: leaveTypes.name,
        colour: leaveTypes.colour,
        fromDateBs: leaveRequests.fromDateBs,
        toDateBs: leaveRequests.toDateBs,
        totalDays: leaveRequests.totalDays,
        status: leaveRequests.status,
        submittedAt: leaveRequests.submittedAt,
      })
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(and(...filters))
      // Tie-broken by id: two requests created in the same millisecond would
      // otherwise straddle a page boundary and one would never be listed.
      .orderBy(desc(leaveRequests.createdAt), desc(leaveRequests.id))
      .limit(page.limit)
      .offset(page.offset),

    db
      .select({ status: leaveRequests.status, n: count(), days: sql<string>`sum(${leaveRequests.totalDays})` })
      .from(leaveRequests)
      .where(eq(leaveRequests.orgId, viewer.orgId))
      .groupBy(leaveRequests.status),
  ]);

  const tally = (s: string) => tallies.find((t) => t.status === s);

  return (
    <>
      <PageHeader
        title="Leave register"
        description={`Fiscal year ${viewer.fiscalYear?.code ?? "—"} · showing up to 100 most recent`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Pending"
          value={tally("pending")?.n ?? 0}
          tone="warn"
          sub={`${formatDays(tally("pending")?.days ?? 0)} days reserved`}
        />
        <StatTile
          label="Approved"
          value={tally("approved")?.n ?? 0}
          tone="ok"
          sub={`${formatDays(tally("approved")?.days ?? 0)} days taken`}
        />
        <StatTile label="Rejected" value={tally("rejected")?.n ?? 0} tone="danger" />
        <StatTile label="Withdrawn" value={tally("cancelled")?.n ?? 0} />
      </div>

      <nav className="mt-4 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={s === "all" ? "/leave/register" : `/leave/register?status=${s}`}
            className={`rounded border px-2.5 py-1 text-xs capitalize ${
              status === s
                ? "border-accent bg-accent-soft font-medium text-accent"
                : "border-line text-ink-soft hover:bg-sunk"
            }`}
          >
            {s}
          </Link>
        ))}
      </nav>

      <div className="mt-3">
        {rows.length === 0 ? (
          <Card>
            <EmptyState title="No requests match this filter" />
          </Card>
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-surface">
          <TableShell className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Employee</Th>
                <Th>Department</Th>
                <Th>Type</Th>
                <Th>From (BS)</Th>
                <Th>To (BS)</Th>
                <Th className="text-right">Days</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-mono text-xs text-ink-soft">{r.reference}</Td>
                  <Td>
                    <Link
                      href={`/hr/employees/${r.employeeId}`}
                      className="font-medium text-ink hover:text-accent"
                    >
                      {r.employeeName}
                    </Link>
                    <span className="ml-1.5 font-mono text-[11px] text-ink-faint">
                      {r.employeeCode}
                    </span>
                  </Td>
                  <Td className="text-ink-soft">{r.department ?? "—"}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: r.colour }}
                        aria-hidden
                      />
                      {r.type}
                    </span>
                  </Td>
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

          <OffsetPagination page={page} params={params} label="requests" />
          </div>
        )}
      </div>
    </>
  );
}
