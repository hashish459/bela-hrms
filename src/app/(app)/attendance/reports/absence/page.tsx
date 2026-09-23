import Link from "next/link";
import { BarList, StackedColumnChart } from "@/components/charts";
import { Badge, Card, CardHeader, EmptyState, StatTile, TableShell, Td, Tr } from "@/components/ui";
import { OffsetPagination } from "@/components/pagination";
import { SortTh } from "@/components/reports/sort-th";
import { Definitions, RateCell, ReportHeading } from "@/components/reports/parts";
import { ReportActions } from "@/components/reports/report-actions";
import { absenteeismTone, bradfordBand, formatRate } from "@/lib/attendance/reports";
import { loadAttendanceReport, sortedEmployeePage } from "../data";
import { BASE } from "../tabs";

export const metadata = { title: "Absenteeism report" };

const BANDS = [
  { label: "Normal", range: "0–49", min: 0, max: 49, colour: "var(--color-ok)" },
  { label: "Watch", range: "50–124", min: 50, max: 124, colour: "var(--color-info)" },
  { label: "Concern", range: "125–399", min: 125, max: 399, colour: "var(--color-warn)" },
  { label: "Review", range: "400+", min: 400, max: Infinity, colour: "var(--color-danger)" },
];

export default async function AbsenceReportPage({ searchParams }: PageProps<"/attendance/reports/absence">) {
  const params = await searchParams;
  const { report, scope } = await loadAttendanceReport(params);
  const t = report.totals;

  const absentees = report.employees.filter((e) => e.counts.absent > 0 || e.counts.half_day > 0);
  const { sort, page, visible } = sortedEmployeePage(absentees, params, { key: "bradford", dir: "desc" });
  const sortable = { sort, params };

  const spells = report.employees.reduce((n, e) => n + e.absenceSpells, 0);
  const longest = report.employees.reduce((m, e) => Math.max(m, e.longestAbsence), 0);

  return (
    <>
      <ReportHeading
        title="Absenteeism"
        description="Unplanned absence — days nobody applied leave for. Ranked by Bradford factor, which weighs frequent short absences above a single long one."
        scope={scope}
        actions={<ReportActions exportHref={`${BASE}/export?report=absence`} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Absenteeism rate" value={formatRate(t.absenteeismRate)} sub="absent ÷ expected days" tone={t.counts.absent ? "danger" : "ok"} />
        <StatTile label="Absent days" value={t.counts.absent} sub={`${t.employeesAbsent} of ${t.headcount} people`} tone={t.counts.absent ? "danger" : "neutral"} />
        <StatTile label="Absence spells" value={spells} sub="separate runs of absence" tone="warn" />
        <StatTile label="Longest run" value={longest ? `${longest}d` : "—"} sub="consecutive working days" tone={longest >= 3 ? "danger" : "neutral"} />
        <StatTile label="Half days" value={t.counts.half_day} sub="short of a full day's hours" tone={t.counts.half_day ? "warn" : "neutral"} />
        <StatTile label="Approved leave" value={t.counts.on_leave} sub="planned — not absence" tone="info" />
      </div>

      {t.counts.absent > 0 ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Card>
            <CardHeader title="Absence over the period" description={`Absent people per ${report.trendGranularity}`} />
            <div className="p-4">
              <StackedColumnChart
                absolute
                height={120}
                keys={[
                  { key: "absent", label: "Absent", colour: "var(--color-danger)" },
                  { key: "half", label: "Half day", colour: "var(--color-warn)" },
                ]}
                columns={report.trend.map((b) => ({
                  label: b.label,
                  title: b.sublabel,
                  muted: b.isOff,
                  caption: b.counts.absent ? String(b.counts.absent) : undefined,
                  segments: [
                    { key: "absent", value: b.counts.absent },
                    { key: "half", value: b.counts.half_day },
                  ],
                }))}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Bradford bands" description="People in each band" />
            <div className="p-3">
              <BarList
                items={BANDS.map((b) => ({
                  key: b.label,
                  label: (
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-sm" style={{ background: b.colour }} aria-hidden />
                      {b.label}
                    </span>
                  ),
                  hint: b.range,
                  value: report.employees.filter((e) => e.bradford >= b.min && e.bradford <= b.max).length,
                }))}
              />
              <p className="mt-3 border-t border-line-soft pt-2 text-[11px] leading-relaxed text-ink-faint">
                Bands are prompts for a return-to-work conversation, not grounds for action on their own.
              </p>
            </div>
          </Card>
        </div>
      ) : null}

      <div className="mt-4">
        {absentees.length === 0 ? (
          <Card>
            <EmptyState title="No absence in this period" hint="Nobody was absent or short of a full day." />
          </Card>
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-surface print:overflow-visible">
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <SortTh column="code" text {...sortable}>Code</SortTh>
                  <SortTh column="name" text {...sortable}>Employee</SortTh>
                  <SortTh column="absent" align="right" {...sortable}>Absent</SortTh>
                  <SortTh column="spells" align="right" {...sortable}>Spells</SortTh>
                  <SortTh column="longest" align="right" {...sortable}>Longest</SortTh>
                  <SortTh column="half" align="right" {...sortable}>Half days</SortTh>
                  <SortTh column="leave" align="right" {...sortable}>Leave</SortTh>
                  <SortTh column="missing" align="right" {...sortable}>Missing punch</SortTh>
                  <SortTh column="absenteeism" align="right" {...sortable}>Rate</SortTh>
                  <SortTh column="bradford" align="right" {...sortable}>Bradford</SortTh>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const band = bradfordBand(r.bradford);
                  return (
                    <Tr key={r.id}>
                      <Td className="font-mono text-xs text-ink-soft">{r.code}</Td>
                      <Td>
                        <Link href={`/hr/employees/${r.id}`} className="font-medium text-ink hover:text-accent">
                          {r.name}
                        </Link>
                        <p className="text-[11px] text-ink-faint">{r.department ?? "—"}</p>
                      </Td>
                      <Td className={`tabular text-right ${r.counts.absent ? "font-medium text-danger" : "text-ink-faint"}`}>
                        {r.counts.absent || "·"}
                      </Td>
                      <Td className="tabular text-right text-xs">{r.absenceSpells || "·"}</Td>
                      <Td className={`tabular text-right text-xs ${r.longestAbsence >= 3 ? "text-danger" : ""}`}>
                        {r.longestAbsence ? `${r.longestAbsence}d` : "·"}
                      </Td>
                      <Td className="tabular text-right text-xs text-warn">{r.counts.half_day || "·"}</Td>
                      <Td className="tabular text-right text-xs text-info">{r.counts.on_leave || "·"}</Td>
                      <Td className="tabular text-right text-xs text-ink-soft">{r.counts.missing_punch || "·"}</Td>
                      <Td className="text-right">
                        <RateCell
                          rate={r.absenteeismRate}
                          tone={absenteeismTone(r.absenteeismRate)}
                        />
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        <span className="tabular mr-1.5 text-sm font-semibold text-ink">{r.bradford}</span>
                        <Badge tone={band.tone}>{band.label}</Badge>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </TableShell>
            <OffsetPagination page={page} params={params} label="employees" className="print:hidden" />
          </div>
        )}
      </div>

      <Definitions
        items={[
          { term: "Absent", meaning: "A working day with no punches and no approved leave, or too few worked hours for a half day." },
          { term: "Spell", meaning: "A run of consecutive absent working days. A weekly off or holiday inside the run neither ends nor extends it." },
          { term: "Bradford factor", meaning: "S² × D, where S is the number of spells and D the total absent days. Five one-day absences score 125; one five-day absence scores 5." },
          { term: "Rate", meaning: "Absent days ÷ expected days (working days less approved leave and unrecorded days)." },
        ]}
      />
    </>
  );
}
