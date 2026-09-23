import Link from "next/link";
import { StackedBarChart } from "@/components/charts";
import { Card, CardHeader, EmptyState, TableShell, Td, Tr } from "@/components/ui";
import { SortTh } from "@/components/reports/sort-th";
import { Definitions, RateCell, ReportHeading } from "@/components/reports/parts";
import { ReportActions } from "@/components/reports/report-actions";
import {
  absenteeismTone,
  formatDayCount,
  formatHours,
  formatRate,
  rateTone,
  DEPARTMENT_DEFAULT_SORT,
  DEPARTMENT_SORT_KEYS,
  departmentSortValue,
  REPORT_STATUS_COLOUR,
} from "@/lib/attendance/reports";
import { resolveSort, sortRows } from "@/lib/reports/period";
import { carryFilters, loadAttendanceReport } from "../data";
import { BASE } from "../tabs";

export const metadata = { title: "Department attendance" };

export default async function DepartmentReportPage({ searchParams }: PageProps<"/attendance/reports/departments">) {
  const params = await searchParams;
  const { report, scope } = await loadAttendanceReport(params);
  const t = report.totals;
  const link = carryFilters(params);

  const sort = resolveSort(params, DEPARTMENT_SORT_KEYS, DEPARTMENT_DEFAULT_SORT);
  const rows = sortRows(report.departments, sort, departmentSortValue);
  const sortable = { sort, params };

  return (
    <>
      <ReportHeading
        title="Departments"
        description="Every department side by side on the same measures, so the one that needs attention is visible regardless of its size."
        scope={scope}
        actions={<ReportActions exportHref={`${BASE}/export?report=departments`} />}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="Nobody matches these filters" />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Attendance composition" description="Share of expected working days, in the table's order" />
            <div className="p-4">
              <StackedBarChart
                rows={rows.map((d) => ({
                  label: d.name,
                  segments: [
                    { key: "atWork", value: d.counts.present + d.counts.field_work },
                    { key: "half", value: d.counts.half_day },
                    { key: "leave", value: d.counts.on_leave },
                    { key: "absent", value: d.counts.absent },
                    { key: "missing", value: d.counts.missing_punch },
                  ],
                  trailing: formatRate(d.attendanceRate, 0),
                }))}
                keys={[
                  { key: "atWork", label: "At work", colour: REPORT_STATUS_COLOUR.present },
                  { key: "half", label: "Half day", colour: REPORT_STATUS_COLOUR.half_day },
                  { key: "leave", label: "On leave", colour: REPORT_STATUS_COLOUR.on_leave },
                  { key: "absent", label: "Absent", colour: REPORT_STATUS_COLOUR.absent },
                  { key: "missing", label: "Missing punch", colour: REPORT_STATUS_COLOUR.missing_punch },
                ]}
              />
            </div>
          </Card>

          <div className="mt-4 overflow-hidden rounded-md border border-line bg-surface print:overflow-visible">
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <SortTh column="name" text {...sortable}>Department</SortTh>
                  <SortTh column="headcount" align="right" {...sortable}>People</SortTh>
                  <SortTh column="rate" align="right" {...sortable}>Attendance</SortTh>
                  <SortTh column="absenteeism" align="right" {...sortable}>Absenteeism</SortTh>
                  <SortTh column="punctuality" align="right" {...sortable}>Punctuality</SortTh>
                  <SortTh column="absent" align="right" {...sortable}>Absent days</SortTh>
                  <SortTh column="leave" align="right" {...sortable}>Leave days</SortTh>
                  <SortTh column="late" align="right" {...sortable}>Late</SortTh>
                  <SortTh column="ot" align="right" {...sortable}>OT h</SortTh>
                  <SortTh column="bradford" align="right" {...sortable}>Avg Bradford</SortTh>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <Tr key={d.id ?? "none"}>
                    <Td>
                      {d.id ? (
                        <Link
                          href={link(`${BASE}/muster`, { dept: d.id })}
                          className="font-medium text-ink hover:text-accent"
                        >
                          {d.name}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink-soft">{d.name}</span>
                      )}
                    </Td>
                    <Td className="tabular text-right">{d.headcount}</Td>
                    <Td className="text-right">
                      <RateCell rate={d.attendanceRate} tone={rateTone(d.attendanceRate)} />
                    </Td>
                    <Td className="text-right">
                      <RateCell
                        rate={d.absenteeismRate}
                        tone={absenteeismTone(d.absenteeismRate)}
                      />
                    </Td>
                    <Td className="text-right">
                      <RateCell rate={d.punctualityRate} tone={rateTone(d.punctualityRate)} />
                    </Td>
                    <Td className={`tabular text-right text-xs ${d.counts.absent ? "text-danger" : "text-ink-faint"}`}>
                      {d.counts.absent}
                      <span className="ml-1 text-ink-faint">· {d.employeesAbsent}p</span>
                    </Td>
                    <Td className="tabular text-right text-xs text-info">{formatDayCount(d.counts.on_leave)}</Td>
                    <Td className={`tabular text-right text-xs ${d.lateDays ? "text-warn" : "text-ink-faint"}`}>
                      {d.lateDays}
                      <span className="ml-1 text-ink-faint">· {d.employeesLate}p</span>
                    </Td>
                    <Td className="tabular text-right text-xs text-info">{formatHours(d.otMinutes)}</Td>
                    <Td className="tabular text-right text-xs">{d.avgBradford}</Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-sunk/60 text-xs font-semibold">
                  <Td>Whole selection</Td>
                  <Td className="tabular text-right">{t.headcount}</Td>
                  <Td className="tabular text-right">{formatRate(t.attendanceRate)}</Td>
                  <Td className="tabular text-right">{formatRate(t.absenteeismRate)}</Td>
                  <Td className="tabular text-right">{formatRate(t.punctualityRate)}</Td>
                  <Td className="tabular text-right text-danger">{t.counts.absent}</Td>
                  <Td className="tabular text-right text-info">{t.counts.on_leave}</Td>
                  <Td className="tabular text-right text-warn">{t.lateDays}</Td>
                  <Td className="tabular text-right text-info">{formatHours(t.otMinutes)}</Td>
                  <Td />
                </tr>
              </tfoot>
            </TableShell>
          </div>
        </>
      )}

      <Definitions
        items={[
          { term: "Rates", meaning: "Computed from the department's pooled days, so a large team is not averaged equally with a team of two." },
          { term: "· Np", meaning: "How many different people the days belong to — ten absent days from one person is a different problem from ten people absent once." },
          { term: "Avg Bradford", meaning: "Mean Bradford factor across the department's people, including those with none." },
          { term: "Drill down", meaning: "Click a department to open its muster roll for the same period." },
        ]}
      />
    </>
  );
}
