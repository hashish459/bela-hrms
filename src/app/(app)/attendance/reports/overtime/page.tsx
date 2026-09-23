import Link from "next/link";
import { BarList, StackedColumnChart } from "@/components/charts";
import { Card, CardHeader, EmptyState, StatTile, TableShell, Td, Tr } from "@/components/ui";
import { OffsetPagination } from "@/components/pagination";
import { SortTh } from "@/components/reports/sort-th";
import { Definitions, ReportHeading } from "@/components/reports/parts";
import { ReportActions } from "@/components/reports/report-actions";
import { formatClock, formatHours } from "@/lib/attendance/reports";
import { formatDuration } from "@/lib/attendance";
import { loadAttendanceReport, sortedEmployeePage } from "../data";
import { BASE } from "../tabs";

export const metadata = { title: "Overtime report" };

export default async function OvertimeReportPage({ searchParams }: PageProps<"/attendance/reports/overtime">) {
  const params = await searchParams;
  const { report, scope } = await loadAttendanceReport(params);
  const t = report.totals;

  const earners = report.employees.filter((e) => e.otMinutes > 0);
  const { sort, page, visible } = sortedEmployeePage(earners, params, { key: "ot", dir: "desc" });
  const sortable = { sort, params };

  // overtime per department, for the "where is it concentrated" question
  const byDept = [...report.departments].filter((d) => d.otMinutes > 0).sort((a, b) => b.otMinutes - a.otMinutes);

  return (
    <>
      <ReportHeading
        title="Overtime"
        description="Hours worked past shift end and on days off, per person and per department — the figures an overtime claim or payroll run starts from."
        scope={scope}
        actions={<ReportActions exportHref={`${BASE}/export?report=overtime`} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Total overtime" value={`${formatHours(t.otMinutes)} h`} sub={`${t.otDays} days with overtime`} tone="info" />
        <StatTile label="People with overtime" value={t.employeesWithOt} sub={`of ${t.headcount}`} tone="accent" />
        <StatTile label="On weekly offs & holidays" value={`${formatHours(t.offDayOtMinutes)} h`} sub="often paid at a higher rate" tone="warn" />
        <StatTile label="Average per OT day" value={t.otDays ? formatDuration(Math.round(t.otMinutes / t.otDays)) : "—"} sub="when overtime happens" tone="neutral" />
        <StatTile
          label="Per person with OT"
          value={t.employeesWithOt ? `${formatHours(t.otMinutes / t.employeesWithOt)} h` : "—"}
          sub="over the period"
          tone="neutral"
        />
        <StatTile
          label="Share of hours worked"
          value={t.workedMinutes ? `${((t.otMinutes / t.workedMinutes) * 100).toFixed(1)}%` : "—"}
          sub="overtime ÷ worked hours"
          tone={t.workedMinutes && t.otMinutes / t.workedMinutes > 0.1 ? "danger" : "neutral"}
        />
      </div>

      {t.otMinutes > 0 ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Card>
            <CardHeader title="Overtime over the period" description={`Hours per ${report.trendGranularity}`} />
            <div className="p-4">
              <StackedColumnChart
                absolute
                height={120}
                keys={[{ key: "ot", label: "Overtime hours", colour: "var(--color-info)" }]}
                columns={report.trend.map((b) => ({
                  label: b.label,
                  title: b.sublabel,
                  caption: b.otMinutes ? formatHours(b.otMinutes) : undefined,
                  segments: [{ key: "ot", value: Math.round(b.otMinutes / 6) / 10 }],
                }))}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="By department" description="Hours of overtime" />
            <div className="p-3">
              <BarList
                colour="var(--color-info)"
                items={byDept.map((d) => ({
                  key: d.name,
                  label: d.name,
                  value: d.otMinutes,
                  display: `${formatHours(d.otMinutes)} h`,
                  hint: `${d.otDays}d`,
                }))}
              />
            </div>
          </Card>
        </div>
      ) : null}

      <div className="mt-4">
        {earners.length === 0 ? (
          <Card>
            <EmptyState title="No overtime in this period" />
          </Card>
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-surface print:overflow-visible">
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <SortTh column="code" text {...sortable}>Code</SortTh>
                  <SortTh column="name" text {...sortable}>Employee</SortTh>
                  <SortTh column="otDays" align="right" {...sortable}>OT days</SortTh>
                  <SortTh column="ot" align="right" {...sortable}>OT hours</SortTh>
                  <SortTh column="offDayOt" align="right" {...sortable}>On days off</SortTh>
                  <SortTh column="worked" align="right" {...sortable}>Worked hours</SortTh>
                  <SortTh column="avgWorked" align="right" {...sortable}>Avg day</SortTh>
                  <SortTh column="avgOut" align="right" {...sortable}>Avg out</SortTh>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-mono text-xs text-ink-soft">{r.code}</Td>
                    <Td>
                      <Link href={`/hr/employees/${r.id}`} className="font-medium text-ink hover:text-accent">
                        {r.name}
                      </Link>
                      <p className="text-[11px] text-ink-faint">{r.department ?? "—"}</p>
                    </Td>
                    <Td className="tabular text-right text-xs">{r.otDays}</Td>
                    <Td className="tabular text-right text-sm font-semibold text-info">{formatHours(r.otMinutes)}</Td>
                    <Td className={`tabular text-right text-xs ${r.offDayOtMinutes ? "text-warn" : "text-ink-faint"}`}>
                      {r.offDayOtMinutes ? formatHours(r.offDayOtMinutes) : "·"}
                    </Td>
                    <Td className="tabular text-right text-xs text-ink-soft">{formatHours(r.workedMinutes)}</Td>
                    <Td className="tabular text-right text-xs text-ink-soft">{formatDuration(r.avgWorkedMinutes)}</Td>
                    <Td className="tabular text-right text-xs text-ink-soft">
                      {formatClock(r.avgCheckOut)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-sunk/60 text-xs font-semibold">
                  <Td colSpan={2}>{earners.length} people</Td>
                  <Td className="tabular text-right">{earners.reduce((n, e) => n + e.otDays, 0)}</Td>
                  <Td className="tabular text-right text-info">{formatHours(t.otMinutes)}</Td>
                  <Td className="tabular text-right text-warn">{formatHours(t.offDayOtMinutes)}</Td>
                  <Td className="tabular text-right">{formatHours(earners.reduce((n, e) => n + e.workedMinutes, 0))}</Td>
                  <Td colSpan={2} />
                </tr>
              </tfoot>
            </TableShell>
            <OffsetPagination page={page} params={params} label="employees" className="print:hidden" />
          </div>
        )}
      </div>

      <Definitions
        items={[
          { term: "Overtime", meaning: "Minutes after shift end plus the shift's OT threshold. Nothing accrues inside the threshold." },
          { term: "On days off", meaning: "Every worked minute on a weekly off or public holiday counts as overtime — there is no shift to finish first." },
          { term: "Hours", meaning: "Decimal hours (1.5 = 1 h 30 m), which is what payroll multiplies by a rate." },
          { term: "Claims", meaning: "This is computed overtime. Whether it is paid is a separate approval; see the Overtime screen when it ships." },
        ]}
      />
    </>
  );
}
