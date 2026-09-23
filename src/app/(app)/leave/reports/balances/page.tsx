import Link from "next/link";
import { Badge, Card, EmptyState, StatTile, TableShell, Td, Tr } from "@/components/ui";
import { OffsetPagination } from "@/components/pagination";
import { SortTh } from "@/components/reports/sort-th";
import { Definitions, RateCell, ReportHeading } from "@/components/reports/parts";
import { ReportActions } from "@/components/reports/report-actions";
import { formatDayCount, formatRate } from "@/lib/reports/buckets";
import type { BalanceCell } from "@/modules/leave/reports";
import { balanceSortKeys, balanceTypes, loadLeaveReport, sortedLeaveEmployees } from "../data";
import { BASE } from "../tabs";

export const metadata = { title: "Leave balances report" };

/** One type's balance: what is left, with a hairline showing how much of it is gone. */
function BalanceCellView({ cell }: { cell: BalanceCell | undefined }) {
  const total = (cell?.entitled ?? 0) + (cell?.carried ?? 0);
  if (!cell || total === 0) return <span className="text-ink-faint/60">·</span>;
  const pct = Math.max(0, Math.min(100, ((cell.used + cell.pending) / total) * 100));
  const tone = cell.available < 0 ? "bg-danger" : pct >= 90 ? "bg-warn" : "bg-accent";
  return (
    <span
      className="inline-flex w-14 flex-col items-end gap-0.5"
      title={`entitled ${formatDayCount(cell.entitled)} + carried ${formatDayCount(cell.carried)} − used ${formatDayCount(
        cell.used,
      )} − pending ${formatDayCount(cell.pending)}${cell.encashed ? ` − encashed ${formatDayCount(cell.encashed)}` : ""}`}
    >
      <span className={`tabular text-xs ${cell.available < 0 ? "font-semibold text-danger" : "text-ink"}`}>
        {formatDayCount(cell.available)}
        <span className="text-[10px] text-ink-faint">/{formatDayCount(total)}</span>
      </span>
      <span className="h-0.5 w-full overflow-hidden rounded-full bg-sunk" aria-hidden>
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

export default async function LeaveBalancesReportPage({ searchParams }: PageProps<"/leave/reports/balances">) {
  const params = await searchParams;
  const { report, scope } = await loadLeaveReport(params);
  const t = report.totals;
  const columns = balanceTypes(report);
  const { sort, page, visible } = sortedLeaveEmployees(report.employees, params, balanceSortKeys(report), {
    key: "code",
    dir: "asc",
  });
  const sortable = { sort, params };
  const fy = report.fiscalYear;

  return (
    <>
      <ReportHeading
        title="Balances"
        description="Every employee's entitlement for the fiscal year, type by type: what is left, what is already used or reserved, and what will lapse if nobody acts."
        scope={`${scope} · balances for FY ${fy?.code ?? "—"}${fy?.isClosed ? " (closed)" : ""}`}
        actions={<ReportActions exportHref={`${BASE}/export?report=balances`} />}
      />

      {!fy ? (
        <Card>
          <EmptyState title="No fiscal year covers this period" hint="Create the fiscal year under Organisation → Fiscal Years." />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Annual entitlement" value={formatDayCount(t.entitled)} sub={`entitled + carried · FY ${fy.code}`} tone="accent" />
            <StatTile label="Used or reserved" value={formatDayCount(t.used)} sub={`${formatRate(t.utilisation, 0)} of entitlement`} tone="info" />
            <StatTile
              label={fy.isClosed ? "Left at year end" : "Available"}
              value={formatDayCount(t.available)}
              sub={fy.isClosed ? "carried forward or lapsed at close" : "still to be taken"}
              tone="ok"
            />
            <StatTile
              label="At risk of lapsing"
              value={formatDayCount(t.atRisk)}
              sub={fy.isClosed ? "year closed" : "beyond carry-forward caps"}
              tone={t.atRisk > 0 ? "warn" : "neutral"}
            />
            <StatTile
              label="Overdrawn"
              value={t.overdrawn}
              sub="people below zero on a type"
              tone={t.overdrawn ? "danger" : "neutral"}
            />
            <StatTile
              label="Nothing taken yet"
              value={report.employees.filter((e) => e.totalEntitled > 0 && e.totalUsed === 0).length}
              sub="people with untouched entitlement"
              tone="neutral"
            />
          </div>

          <div className="mt-4 overflow-hidden rounded-md border border-line bg-surface print:overflow-visible">
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <SortTh column="code" text {...sortable}>Code</SortTh>
                  <SortTh column="name" text {...sortable}>Employee</SortTh>
                  <SortTh column="taken" align="right" {...sortable}>Taken</SortTh>
                  {columns.map((type) => (
                    <SortTh key={type.id} column={`type:${type.id}`} align="right" {...sortable}>
                      <span title={type.name} className="inline-flex items-center gap-1">
                        <span className="size-1.5 rounded-full" style={{ background: type.colour }} aria-hidden />
                        {type.code}
                      </span>
                    </SortTh>
                  ))}
                  <SortTh column="entitled" align="right" {...sortable}>Annual</SortTh>
                  <SortTh column="available" align="right" {...sortable}>Available</SortTh>
                  <SortTh column="atRisk" align="right" {...sortable}>At risk</SortTh>
                  <SortTh column="utilisation" align="right" {...sortable}>Used</SortTh>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <Tr key={e.id}>
                    <Td className="font-mono text-xs text-ink-soft">{e.code}</Td>
                    <Td className="min-w-44">
                      <Link href={`/hr/employees/${e.id}`} className="font-medium text-ink hover:text-accent">
                        {e.name}
                      </Link>
                      <p className="flex items-center gap-1.5 text-[11px] text-ink-faint">
                        {e.department ?? "—"}
                        {e.overdrawn ? <Badge tone="danger">Overdrawn</Badge> : null}
                      </p>
                    </Td>
                    <Td
                      className={`tabular text-right text-xs ${e.takenDays ? "text-accent" : "text-ink-faint/60"}`}
                      title="Approved leave days inside the chosen period"
                    >
                      {e.takenDays ? formatDayCount(e.takenDays) : "·"}
                    </Td>
                    {columns.map((type) => (
                      <Td key={type.id} className="text-right">
                        <BalanceCellView cell={e.balances[type.id]} />
                      </Td>
                    ))}
                    <Td className="tabular text-right text-xs text-ink-soft">{formatDayCount(e.totalEntitled)}</Td>
                    <Td className={`tabular text-right text-sm font-semibold ${e.totalAvailable < 0 ? "text-danger" : "text-ink"}`}>
                      {formatDayCount(e.totalAvailable)}
                    </Td>
                    <Td className={`tabular text-right text-xs ${e.totalAtRisk > 0 ? "font-medium text-warn" : "text-ink-faint/60"}`}>
                      {e.totalAtRisk > 0 ? formatDayCount(e.totalAtRisk) : "·"}
                    </Td>
                    <Td className="text-right">
                      <RateCell
                        rate={e.utilisation}
                        tone={e.utilisation === null ? "neutral" : e.utilisation > 1 ? "danger" : e.utilisation >= 0.9 ? "warn" : "info"}
                      />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
            <OffsetPagination page={page} params={params} label="employees" className="print:hidden" />
          </div>
        </>
      )}

      <Definitions
        items={[
          { term: "Taken", meaning: "Approved leave days inside the chosen period — the rest of the table is the whole fiscal year." },
          { term: "Cells", meaning: "Available / entitled for each leave type. The hairline is how much is used or reserved; hover for the full sum." },
          {
            term: "Annual · Available · At risk · Used",
            meaning: "Totals over annual leave only. Service-period types (maternity, paternity, study) keep their own columns but stay out of the totals — they cover a whole career.",
          },
          { term: "Available", meaning: "Entitled + carried forward − used − pending − encashed. Pending requests hold their days until decided." },
          {
            term: "At risk",
            meaning: "Available days over the type's carry-forward cap (or all of them, when it does not carry forward). Shown only for an open year.",
          },
          { term: "Fiscal year", meaning: "Balances belong to a fiscal year; this report uses the year the chosen period ends in." },
        ]}
      />
    </>
  );
}
