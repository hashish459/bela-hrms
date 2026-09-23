import Link from "next/link";
import { BarList, StackedColumnChart } from "@/components/charts";
import { Card, CardHeader, EmptyState, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { OffsetPagination } from "@/components/pagination";
import { SortTh } from "@/components/reports/sort-th";
import { Definitions, RateCell, ReportHeading } from "@/components/reports/parts";
import { ReportActions } from "@/components/reports/report-actions";
import { formatClock, formatRate, rateTone } from "@/lib/attendance/reports";
import { formatDuration, shortTime } from "@/lib/attendance";
import { carryFilters, loadAttendanceReport, sortedEmployeePage } from "../data";
import { BASE } from "../tabs";

export const metadata = { title: "Late & early exit report" };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function LateReportPage({ searchParams }: PageProps<"/attendance/reports/late">) {
  const params = await searchParams;
  const { report, scope } = await loadAttendanceReport(params);
  const t = report.totals;
  const link = carryFilters(params);

  const offenders = report.employees.filter((e) => e.lateDays > 0 || e.earlyExitDays > 0);
  const { sort, page, visible } = sortedEmployeePage(offenders, params, { key: "late", dir: "desc" });
  const recent = report.lateInstances.slice(0, 20);
  // a reduce, not Math.max(...spread): a year of late arrivals can exceed the argument limit
  const worst = report.employees.reduce((max, e) => Math.max(max, e.maxLateMinutes), 0);
  const avgLate = t.lateDays ? Math.round(t.lateMinutes / t.lateDays) : 0;
  const sortable = { sort, params };

  return (
    <>
      <ReportHeading
        title="Late arrivals & early exits"
        description="Who arrives after the grace window or leaves before shift end, how often, by how much, and on which days of the week."
        scope={scope}
        actions={<ReportActions exportHref={`${BASE}/export?report=late`} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Late arrivals" value={t.lateDays} sub={`${t.employeesLate} of ${t.headcount} people`} tone={t.lateDays ? "warn" : "ok"} />
        <StatTile label="Punctuality" value={formatRate(t.punctualityRate)} sub="punched-in days on time" tone={rateTone(t.punctualityRate)} />
        <StatTile label="Time lost to lateness" value={formatDuration(t.lateMinutes)} sub={`${(t.lateMinutes / 60).toFixed(1)} person-hours`} tone="warn" />
        <StatTile label="Average lateness" value={avgLate ? `${avgLate}m` : "—"} sub="per late arrival" tone="neutral" />
        <StatTile label="Early exits" value={t.earlyExitDays} sub={formatDuration(t.earlyExitMinutes) + " in total"} tone={t.earlyExitDays ? "warn" : "neutral"} />
        <StatTile
          label="Worst single arrival"
          value={worst ? `${worst}m` : "—"}
          sub="minutes past grace"
          tone="danger"
        />
      </div>

      {t.lateDays > 0 ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_18rem_18rem]">
          <Card>
            <CardHeader title="Late arrivals over the period" description={`Per ${report.trendGranularity}`} />
            <div className="p-4">
              <StackedColumnChart
                absolute
                height={120}
                keys={[{ key: "late", label: "Late arrivals", colour: "var(--color-warn)" }]}
                columns={report.trend.map((b) => ({
                  label: b.label,
                  title: b.sublabel,
                  muted: b.isOff,
                  caption: b.lateCount ? String(b.lateCount) : undefined,
                  segments: [{ key: "late", value: b.lateCount }],
                }))}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="By weekday" description="Is there a pattern?" />
            <div className="p-3">
              <BarList
                colour="var(--color-warn)"
                items={WEEKDAYS.map((d, i) => ({ key: d, label: d, value: report.lateByWeekday[i] })).filter(
                  (d, i) => i !== 6 || d.value > 0,
                )}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="By how late" description="Minutes past the grace window" />
            <div className="p-3">
              <BarList
                colour="var(--color-danger)"
                items={report.lateBySeverity.map((s) => ({
                  key: s.label,
                  label: s.label,
                  value: s.count,
                  hint: t.lateDays ? `${Math.round((s.count / t.lateDays) * 100)}%` : undefined,
                }))}
              />
            </div>
          </Card>
        </div>
      ) : null}

      <div className="mt-4">
        {offenders.length === 0 ? (
          <Card>
            <EmptyState title="Everybody was on time" hint="No late arrivals or early exits in this period." />
          </Card>
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-surface print:overflow-visible">
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <SortTh column="code" text {...sortable}>Code</SortTh>
                  <SortTh column="name" text {...sortable}>Employee</SortTh>
                  <SortTh column="late" align="right" {...sortable}>Late days</SortTh>
                  <SortTh column="lateMinutes" align="right" {...sortable}>Late total</SortTh>
                  <SortTh column="avgLate" align="right" {...sortable}>Average</SortTh>
                  <SortTh column="maxLate" align="right" {...sortable}>Worst</SortTh>
                  <SortTh column="early" align="right" {...sortable}>Early exits</SortTh>
                  <SortTh column="earlyMinutes" align="right" {...sortable}>Early total</SortTh>
                  <SortTh column="avgIn" align="right" {...sortable}>Avg in</SortTh>
                  <SortTh column="avgOut" align="right" {...sortable}>Avg out</SortTh>
                  <SortTh column="punctuality" align="right" {...sortable}>Punctual</SortTh>
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
                    <Td className={`tabular text-right ${r.lateDays ? "font-medium text-warn" : "text-ink-faint"}`}>{r.lateDays || "·"}</Td>
                    <Td className="tabular text-right text-xs">{formatDuration(r.lateMinutes)}</Td>
                    <Td className="tabular text-right text-xs text-ink-soft">
                      {r.lateDays ? `${Math.round(r.lateMinutes / r.lateDays)}m` : "—"}
                    </Td>
                    <Td className={`tabular text-right text-xs ${r.maxLateMinutes > 60 ? "text-danger" : "text-ink-soft"}`}>
                      {r.maxLateMinutes ? `${r.maxLateMinutes}m` : "—"}
                    </Td>
                    <Td className={`tabular text-right ${r.earlyExitDays ? "text-warn" : "text-ink-faint"}`}>{r.earlyExitDays || "·"}</Td>
                    <Td className="tabular text-right text-xs">{formatDuration(r.earlyExitMinutes)}</Td>
                    <Td className="tabular text-right text-xs text-ink-soft">{formatClock(r.avgCheckIn)}</Td>
                    <Td className="tabular text-right text-xs text-ink-soft">{formatClock(r.avgCheckOut)}</Td>
                    <Td className="text-right">
                      <RateCell rate={r.punctualityRate} tone={rateTone(r.punctualityRate)} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
            <OffsetPagination page={page} params={params} label="employees" className="print:hidden" />
          </div>
        )}
        {offenders.length > 0 && offenders.length < t.headcount ? (
          <p className="mt-2 text-xs text-ink-faint">
            {t.headcount - offenders.length} other {t.headcount - offenders.length === 1 ? "person was" : "people were"} on
            time every day and are not listed.
          </p>
        ) : null}
      </div>

      {recent.length > 0 ? (
        <Card className="mt-4">
          <CardHeader
            title="Most recent late arrivals"
            description={`Latest ${recent.length} of ${report.lateInstances.length}`}
            action={
              <a
                href={link(`${BASE}/export`, { report: "late-days" })}
                className="text-xs text-accent hover:underline print:hidden"
                download
              >
                Every late arrival (CSV)
              </a>
            }
          />
          <TableShell className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Date (BS)</Th>
                <Th>Employee</Th>
                <Th>Shift</Th>
                <Th className="text-right">In</Th>
                <Th className="text-right">Late by</Th>
                <Th className="text-right">Out</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((l) => (
                <Tr key={`${l.employeeId}:${l.date}`}>
                  <Td className="tabular text-xs">
                    <Link href={`/attendance/register?d=${l.date}`} className="text-ink-soft hover:text-accent">
                      {l.dateBs}
                    </Link>
                  </Td>
                  <Td>
                    <span className="font-medium text-ink">{l.name}</span>
                    <span className="ml-1.5 font-mono text-[11px] text-ink-faint">{l.code}</span>
                  </Td>
                  <Td className="text-xs text-ink-faint">{l.shiftCode ?? "—"}</Td>
                  <Td className="tabular text-right text-xs">{shortTime(l.checkIn)}</Td>
                  <Td className={`tabular text-right text-xs font-medium ${l.lateMinutes > 30 ? "text-danger" : "text-warn"}`}>
                    {l.lateMinutes}m
                  </Td>
                  <Td className="tabular text-right text-xs text-ink-soft">{shortTime(l.checkOut)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Card>
      ) : null}

      <Definitions
        items={[
          { term: "Late", meaning: "Check-in after shift start plus the shift's grace-in minutes. Minutes are counted from the end of the grace window." },
          { term: "Early exit", meaning: "Check-out before shift end less the grace-out minutes." },
          { term: "Excused lateness", meaning: "An approved late-excuse request clears the day's late minutes, so it does not appear here." },
          { term: "Avg in / out", meaning: "Mean punch times on working days with a punch, across every shift the person worked." },
        ]}
      />
    </>
  );
}
