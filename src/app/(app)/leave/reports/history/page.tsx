import Link from "next/link";
import { Card, EmptyState, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { OffsetPagination } from "@/components/pagination";
import { Definitions, ReportHeading } from "@/components/reports/parts";
import { ReportActions } from "@/components/reports/report-actions";
import { formatDayCount } from "@/lib/reports/buckets";
import { formatTurnaround } from "@/modules/leave/reports";
import { cn } from "@/lib/utils";
import { carryFilters, historyRows, HISTORY_STATUSES as STATUSES, loadLeaveReport, pageRows } from "../data";
import { BsSpan, LeaveStatusBadge, TypePill } from "../parts";
import { BASE } from "../tabs";

export const metadata = { title: "Leave history" };

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
        active ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-ink-soft hover:bg-sunk",
      )}
    >
      {children}
    </Link>
  );
}

export default async function LeaveHistoryPage({ searchParams }: PageProps<"/leave/reports/history">) {
  const params = await searchParams;
  const { report, scope } = await loadLeaveReport(params);
  const link = carryFilters(params);

  const status = typeof params.status === "string" ? params.status : "";
  const type = typeof params.type === "string" ? params.type : "";
  const rows = historyRows(report, params);
  const { page, visible } = pageRows(rows, params);

  const countOf = (s: string) => report.requests.filter((r) => (!s || r.status === s) && (!type || r.typeId === type)).length;
  const typesInPeriod = report.types.filter((t) => report.requests.some((r) => r.typeId === t.id));
  const shownDays = rows.reduce((n, r) => n + r.daysInPeriod, 0);

  const withFilters = (extra: Record<string, string>) => {
    const next: Record<string, string> = {};
    if (status) next.status = status;
    if (type) next.type = type;
    for (const [k, v] of Object.entries(extra)) {
      if (v) next[k] = v;
      else delete next[k];
    }
    return link(`${BASE}/history`, next);
  };

  return (
    <>
      <ReportHeading
        title="Leave history"
        description="Every leave request whose dates touch the period — approved, pending, refused or withdrawn — with how long each one took to decide."
        scope={scope}
        actions={<ReportActions exportHref={`${BASE}/export?report=history`} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Requests shown" value={rows.length} sub={`of ${report.requests.length} in the period`} tone="accent" />
        <StatTile label="Days in the period" value={formatDayCount(shownDays)} sub="for the requests shown" tone="info" />
        <StatTile label="Pending" value={countOf("pending")} sub="waiting on an approver" tone={countOf("pending") ? "warn" : "neutral"} />
        <StatTile label="Rejected" value={countOf("rejected")} sub={`${countOf("cancelled")} withdrawn`} tone={countOf("rejected") ? "danger" : "neutral"} />
      </div>

      <div className="mt-4 flex flex-col gap-2 print:hidden">
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <Chip key={s.value} href={withFilters({ status: s.value })} active={s.value === status}>
              {s.label}
              <span className="tabular text-ink-faint">{countOf(s.value)}</span>
            </Chip>
          ))}
        </div>
        {typesInPeriod.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            <Chip href={withFilters({ type: "" })} active={!type}>
              Every type
            </Chip>
            {typesInPeriod.map((t) => (
              <Chip key={t.id} href={withFilters({ type: t.id })} active={t.id === type}>
                <span className="size-2 rounded-full" style={{ background: t.colour }} aria-hidden />
                {t.name}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-3">
        {rows.length === 0 ? (
          <Card>
            <EmptyState title="No requests match" hint="Try another status or type, or widen the period." />
          </Card>
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-surface print:overflow-visible">
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Employee</Th>
                  <Th>Type</Th>
                  <Th>Dates (BS)</Th>
                  <Th className="text-right">Days</Th>
                  <Th className="text-right">In period</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Decision</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-mono text-xs text-ink-soft">{r.reference}</Td>
                    <Td className="min-w-44">
                      <Link href={`/hr/employees/${r.employeeId}`} className="font-medium text-ink hover:text-accent">
                        {r.name}
                      </Link>
                      <p className="text-[11px] text-ink-faint">
                        {r.code} · {r.department ?? "—"}
                      </p>
                    </Td>
                    <Td>
                      <TypePill name={r.typeName} colour={r.typeColour} />
                      {r.portion !== "full" ? (
                        <p className="text-[10px] text-ink-faint">{r.portion === "first_half" ? "First half" : "Second half"}</p>
                      ) : null}
                    </Td>
                    <Td className="text-xs text-ink-soft">
                      <BsSpan from={r.fromDateBs} to={r.toDateBs} />
                    </Td>
                    <Td className="tabular text-right text-sm font-medium">{formatDayCount(r.totalDays)}</Td>
                    <Td
                      className={`tabular text-right text-xs ${r.daysInPeriod < r.totalDays ? "text-info" : "text-ink-faint"}`}
                      title={r.daysInPeriod < r.totalDays ? "Part of this request falls outside the period" : undefined}
                    >
                      {formatDayCount(r.daysInPeriod)}
                    </Td>
                    <Td>
                      <LeaveStatusBadge status={r.status} />
                    </Td>
                    <Td className="text-right text-xs whitespace-nowrap">
                      {r.status === "pending" ? (
                        <span className="text-warn" title={`Waiting on ${r.awaiting}`}>
                          {r.pendingAgeDays ?? 0}d · {r.awaiting}
                        </span>
                      ) : (
                        <span className="tabular text-ink-soft">{formatTurnaround(r.turnaroundHours)}</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
            <OffsetPagination page={page} params={params} label="requests" className="print:hidden" />
          </div>
        )}
      </div>

      <Definitions
        items={[
          { term: "Days · In period", meaning: "The request's own chargeable days, and how many of them fall inside the chosen period (blue when some fall outside)." },
          { term: "Decision", meaning: "Submission to final decision for decided requests; for pending ones, days waiting and who it is waiting on." },
          { term: "Withdrawn", meaning: "Cancelled by the employee, before or after approval. Withdrawn days are returned to the balance." },
        ]}
      />
    </>
  );
}
