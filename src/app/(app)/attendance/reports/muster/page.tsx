import Link from "next/link";
import { Card, EmptyState, TableShell, Td, Tr } from "@/components/ui";
import { OffsetPagination } from "@/components/pagination";
import { SortTh } from "@/components/reports/sort-th";
import { Definitions, RateCell, ReportHeading } from "@/components/reports/parts";
import { ReportActions } from "@/components/reports/report-actions";
import { formatDayCount, formatHours, formatRate, rateTone } from "@/lib/attendance/reports";
import { loadAttendanceReport, sortedEmployeePage } from "../data";
import { BASE } from "../tabs";

export const metadata = { title: "Muster roll" };

/** A count cell that fades to a dot at zero, so the non-zero figures stand out. */
function N({ value, tone }: { value: number; tone?: string }) {
  return (
    <Td className={`tabular text-right text-xs ${value ? (tone ?? "text-ink") : "text-ink-faint/60"}`}>
      {value ? formatDayCount(value) : "·"}
    </Td>
  );
}

export default async function MusterRollPage({ searchParams }: PageProps<"/attendance/reports/muster">) {
  const params = await searchParams;
  const { report, scope } = await loadAttendanceReport(params);
  const { sort, page, visible } = sortedEmployeePage(report.employees, params, { key: "code", dir: "asc" });
  const t = report.totals;
  const c = t.counts;

  const sortable = { sort, params };

  return (
    <>
      <ReportHeading
        title="Muster roll"
        description="Every employee's days for the period, by status, with the payable days payroll will use. The register a labour inspector asks for."
        scope={scope}
        actions={<ReportActions exportHref={`${BASE}/export?report=muster`} />}
      />

      {report.employees.length === 0 ? (
        <Card>
          <EmptyState title="Nobody matches these filters" hint="Try another period or clear the filters." />
        </Card>
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface print:overflow-visible">
          <TableShell className="rounded-none border-0">
            <thead>
              <tr>
                <SortTh column="code" text {...sortable}>Code</SortTh>
                <SortTh column="name" text {...sortable}>Employee</SortTh>
                <SortTh column="present" align="right" {...sortable} className="text-ok">P</SortTh>
                <SortTh column="field" align="right" {...sortable}>FW</SortTh>
                <SortTh column="half" align="right" {...sortable}>½</SortTh>
                <SortTh column="absent" align="right" {...sortable}>A</SortTh>
                <SortTh column="leave" align="right" {...sortable}>L</SortTh>
                <SortTh column="missing" align="right" {...sortable}>MP</SortTh>
                <SortTh column="notMarked" align="right" {...sortable}>NM</SortTh>
                <SortTh column="off" align="right" {...sortable}>W/H</SortTh>
                <SortTh column="payable" align="right" {...sortable}>Payable</SortTh>
                <SortTh column="worked" align="right" {...sortable}>Hours</SortTh>
                <SortTh column="late" align="right" {...sortable}>Late</SortTh>
                <SortTh column="ot" align="right" {...sortable}>OT h</SortTh>
                <SortTh column="rate" align="right" {...sortable}>Attend.</SortTh>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-mono text-xs text-ink-soft">{r.code}</Td>
                  <Td className="min-w-48">
                    <Link href={`/hr/employees/${r.id}`} className="font-medium text-ink hover:text-accent">
                      {r.name}
                    </Link>
                    <p className="truncate text-[11px] text-ink-faint">
                      {[r.department, r.designation].filter(Boolean).join(" · ") || "—"}
                      {r.windowDays < report.period.elapsedDays ? (
                        <span className="ml-1 text-info">· {r.windowDays} of {report.period.elapsedDays} days employed</span>
                      ) : null}
                    </p>
                  </Td>
                  <N value={r.counts.present} tone="text-ok" />
                  <N value={r.counts.field_work} tone="text-accent" />
                  <N value={r.counts.half_day} tone="text-warn" />
                  <N value={r.counts.absent} tone="font-medium text-danger" />
                  <N value={r.counts.on_leave} tone="text-info" />
                  <N value={r.counts.missing_punch} tone="text-warn" />
                  <N value={r.counts.not_marked} tone="text-ink-soft" />
                  <N value={r.counts.weekly_off + r.counts.holiday} tone="text-ink-soft" />
                  <Td className="tabular text-right text-sm font-semibold text-ink">
                    {formatDayCount(r.payableDays)}
                  </Td>
                  <Td className="tabular text-right text-xs text-ink-soft">{formatHours(r.workedMinutes)}</Td>
                  <N value={r.lateDays} tone="text-warn" />
                  <Td className={`tabular text-right text-xs ${r.otMinutes ? "text-info" : "text-ink-faint/60"}`}>
                    {r.otMinutes ? formatHours(r.otMinutes) : "·"}
                  </Td>
                  <Td className="text-right">
                    <RateCell rate={r.attendanceRate} tone={rateTone(r.attendanceRate)} />
                  </Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-sunk/60 text-xs font-semibold">
                <Td colSpan={2} className="text-ink">
                  All {t.headcount} employees
                </Td>
                <Td className="tabular text-right text-ok">{c.present}</Td>
                <Td className="tabular text-right text-accent">{c.field_work}</Td>
                <Td className="tabular text-right text-warn">{c.half_day}</Td>
                <Td className="tabular text-right text-danger">{c.absent}</Td>
                <Td className="tabular text-right text-info">{c.on_leave}</Td>
                <Td className="tabular text-right text-warn">{c.missing_punch}</Td>
                <Td className="tabular text-right text-ink-soft">{c.not_marked}</Td>
                <Td className="tabular text-right text-ink-soft">{c.weekly_off + c.holiday}</Td>
                <Td className="tabular text-right text-ink">{formatDayCount(t.payableDays)}</Td>
                <Td className="tabular text-right text-ink-soft">{formatHours(t.workedMinutes)}</Td>
                <Td className="tabular text-right text-warn">{t.lateDays}</Td>
                <Td className="tabular text-right text-info">{formatHours(t.otMinutes)}</Td>
                <Td className="tabular text-right text-ink">{formatRate(t.attendanceRate)}</Td>
              </tr>
            </tfoot>
          </TableShell>
          <OffsetPagination page={page} params={params} label="employees" className="print:hidden" />
        </div>
      )}

      <Definitions
        items={[
          { term: "P · FW · ½", meaning: "Present, field work (official duty away from the desk, a present day), half day." },
          { term: "A · L", meaning: "Absent, and approved leave of any type." },
          { term: "MP · NM", meaning: "Missing punch (one punch only — raise a correction), and working days with no record at all." },
          { term: "W/H", meaning: "Weekly offs and public holidays in the employment window." },
          {
            term: "Payable",
            meaning: "Present + field work + ½ × half days + leave + weekly offs + holidays. Unpaid leave is deducted by payroll, not here.",
          },
          { term: "Attend.", meaning: "Attended days ÷ expected days (working days less leave and unrecorded days)." },
        ]}
      />
    </>
  );
}
