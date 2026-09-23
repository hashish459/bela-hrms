import Link from "next/link";
import { BarList, DonutChart, StackedBarChart, StackedColumnChart } from "@/components/charts";
import { Card, CardHeader, EmptyState, StatTile } from "@/components/ui";
import { Definitions, ReportHeading } from "@/components/reports/parts";
import { ReportActions } from "@/components/reports/report-actions";
import {
  bradfordBand,
  formatDayCount,
  formatHours,
  formatRate,
  rateTone,
  REPORT_STATUS_COLOUR,
  type AttendanceReport,
} from "@/lib/attendance/reports";
import { formatDuration } from "@/lib/attendance";
import { carryFilters, loadAttendanceReport } from "./data";
import { BASE } from "./tabs";

export const metadata = { title: "Attendance reports" };

const TREND_KEYS = [
  { key: "atWork", label: "At work", colour: REPORT_STATUS_COLOUR.present },
  { key: "half", label: "Half day", colour: REPORT_STATUS_COLOUR.half_day },
  { key: "leave", label: "On leave", colour: REPORT_STATUS_COLOUR.on_leave },
  { key: "absent", label: "Absent", colour: REPORT_STATUS_COLOUR.absent },
  { key: "missing", label: "Missing punch", colour: REPORT_STATUS_COLOUR.missing_punch },
];

export default async function AttendanceReportsOverview({
  searchParams,
}: PageProps<"/attendance/reports">) {
  const params = await searchParams;
  const { report, scope } = await loadAttendanceReport(params);
  const t = report.totals;
  const c = t.counts;
  const link = carryFilters(params);
  const missingPunches = report.exceptions.filter((e) => e.status === "missing_punch").length;

  return (
    <>
      <ReportHeading
        title="Overview"
        description="The period at a glance: how much of the expected time people were at work, how punctual they were, and where to look first."
        scope={scope}
        actions={<ReportActions exportHref={`${BASE}/export?report=daily`} />}
      />

      {t.headcount === 0 ? (
        <Card>
          <EmptyState
            title={report.period.hasElapsed ? "Nobody matches these filters" : "This period has not started yet"}
            hint="Try another period, or clear the department and search filters."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatTile
              label="Attendance rate"
              value={formatRate(t.attendanceRate)}
              sub={`${formatDayCount(t.attendedDays)} of ${t.expectedDays} expected days`}
              tone={rateTone(t.attendanceRate)}
            />
            <StatTile
              label="Absenteeism"
              value={formatRate(t.absenteeismRate)}
              sub={`${c.absent} absent days · ${t.employeesAbsent} people`}
              tone={c.absent > 0 ? "danger" : "neutral"}
            />
            <StatTile
              label="Punctuality"
              value={formatRate(t.punctualityRate)}
              sub={`${t.lateDays} late arrivals · ${t.employeesLate} people`}
              tone={rateTone(t.punctualityRate)}
            />
            <StatTile
              label="Avg hours at work"
              value={
                c.present + c.half_day > 0
                  ? formatDuration(Math.round(t.workedMinutes / (c.present + c.half_day)))
                  : "—"
              }
              sub={`${formatHours(t.workedMinutes)} h worked in total`}
              tone="accent"
            />
            <StatTile
              label="Overtime"
              value={`${formatHours(t.otMinutes)} h`}
              sub={`${t.employeesWithOt} people · ${formatHours(t.offDayOtMinutes)} h on days off`}
              tone="info"
            />
            <StatTile
              label="Exceptions"
              value={report.exceptions.length}
              sub={`${missingPunches} missing punch · ${report.exceptions.length - missingPunches} not marked`}
              tone={report.exceptions.length > 0 ? "warn" : "ok"}
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_22rem]">
            <Card>
              <CardHeader
                title="Attendance trend"
                description={`Share of each ${report.trendGranularity}'s working headcount, with the attendance rate above each column. Faded columns are weekly offs and holidays.`}
              />
              <div className="p-4">
                <TrendChart report={report} />
              </div>
            </Card>

            <Card>
              <CardHeader title="Where the working days went" description="Weekly offs and holidays excluded" />
              <div className="p-4">
                {t.scheduledDays === 0 ? (
                  <EmptyState title="No working days in this period" />
                ) : (
                  <DonutChart
                    centreValue={formatRate(t.attendanceRate, 0)}
                    centreLabel="attendance"
                    slices={[
                      { label: "Present", value: c.present, colour: REPORT_STATUS_COLOUR.present },
                      { label: "Field work", value: c.field_work, colour: REPORT_STATUS_COLOUR.field_work },
                      { label: "Half day", value: c.half_day, colour: REPORT_STATUS_COLOUR.half_day },
                      { label: "On leave", value: c.on_leave, colour: REPORT_STATUS_COLOUR.on_leave },
                      { label: "Absent", value: c.absent, colour: REPORT_STATUS_COLOUR.absent },
                      { label: "Missing punch", value: c.missing_punch, colour: REPORT_STATUS_COLOUR.missing_punch },
                      { label: "Not marked", value: c.not_marked, colour: REPORT_STATUS_COLOUR.not_marked },
                    ]}
                  />
                )}
              </div>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader
                title="Absence to talk about"
                description="Highest Bradford factor"
                action={<Link href={link(`${BASE}/absence`)} className="text-xs text-accent hover:underline">All</Link>}
              />
              <div className="p-3">
                <BarList
                  colour="var(--color-danger)"
                  empty="No absence in this period"
                  items={[...report.employees]
                    .filter((e) => e.bradford > 0)
                    .sort((a, b) => b.bradford - a.bradford)
                    .slice(0, 6)
                    .map((e) => ({
                      key: e.id,
                      label: <Link href={`/hr/employees/${e.id}`} className="hover:text-accent">{e.name}</Link>,
                      value: e.bradford,
                      hint: `${e.counts.absent}d · ${e.absenceSpells} spells · ${bradfordBand(e.bradford).label}`,
                    }))}
                />
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Most often late"
                description="Late arrivals in the period"
                action={<Link href={link(`${BASE}/late`)} className="text-xs text-accent hover:underline">All</Link>}
              />
              <div className="p-3">
                <BarList
                  colour="var(--color-warn)"
                  empty="Nobody was late"
                  items={[...report.employees]
                    .filter((e) => e.lateDays > 0)
                    .sort((a, b) => b.lateDays - a.lateDays || b.lateMinutes - a.lateMinutes)
                    .slice(0, 6)
                    .map((e) => ({
                      key: e.id,
                      label: <Link href={`/hr/employees/${e.id}`} className="hover:text-accent">{e.name}</Link>,
                      value: e.lateDays,
                      display: `${e.lateDays}×`,
                      hint: formatDuration(e.lateMinutes),
                    }))}
                />
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Most overtime"
                description="Hours past shift end"
                action={<Link href={link(`${BASE}/overtime`)} className="text-xs text-accent hover:underline">All</Link>}
              />
              <div className="p-3">
                <BarList
                  colour="var(--color-info)"
                  empty="No overtime in this period"
                  items={[...report.employees]
                    .filter((e) => e.otMinutes > 0)
                    .sort((a, b) => b.otMinutes - a.otMinutes)
                    .slice(0, 6)
                    .map((e) => ({
                      key: e.id,
                      label: <Link href={`/hr/employees/${e.id}`} className="hover:text-accent">{e.name}</Link>,
                      value: e.otMinutes,
                      display: `${formatHours(e.otMinutes)} h`,
                      hint: `${e.otDays} days`,
                    }))}
                />
              </div>
            </Card>
          </div>

          {report.departments.length > 1 ? (
            <Card className="mt-4">
              <CardHeader
                title="Composition by department"
                description="Share of expected working days; lowest attendance rate first."
                action={<Link href={link(`${BASE}/departments`)} className="text-xs text-accent hover:underline">Department report</Link>}
              />
              <div className="p-4">
                <StackedBarChart
                  rows={[...report.departments]
                    .sort((a, b) => (a.attendanceRate ?? 1) - (b.attendanceRate ?? 1))
                    .map((d) => ({
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
                  keys={TREND_KEYS}
                />
              </div>
            </Card>
          ) : null}

          <Definitions
            items={[
              {
                term: "Expected days",
                meaning:
                  "Days in each person's employment window that were not weekly offs or holidays, less approved leave and less days with no record at all — an unrecorded day is unknown, not absent.",
              },
              {
                term: "Attendance rate",
                meaning: "Present and field-work days, plus half of each half day, divided by expected days.",
              },
              {
                term: "Absenteeism",
                meaning: "Absent days divided by expected days. Approved leave is not absence.",
              },
              {
                term: "Punctuality",
                meaning: "Share of punched-in days (present or half day) that were not late after the shift's grace window.",
              },
              {
                term: "Overtime",
                meaning:
                  "Minutes past shift end plus the shift's OT threshold, and every worked minute on a weekly off or holiday.",
              },
              {
                term: "Period",
                meaning:
                  "Counted up to today for a current period. People who joined or left part-way are counted only for the days they were employed.",
              },
            ]}
          />
        </>
      )}
    </>
  );
}

function TrendChart({ report }: { report: AttendanceReport }) {
  if (report.trend.length === 0) return <EmptyState title="Nothing recorded yet" />;
  return (
    <StackedColumnChart
      keys={TREND_KEYS}
      columns={report.trend.map((b) => ({
        label: b.label,
        title: b.sublabel,
        muted: b.isOff,
        caption: b.attendanceRate === null ? undefined : `${Math.round(b.attendanceRate * 100)}`,
        segments: [
          { key: "atWork", value: b.counts.present + b.counts.field_work },
          { key: "half", value: b.counts.half_day },
          { key: "leave", value: b.counts.on_leave },
          { key: "absent", value: b.counts.absent },
          { key: "missing", value: b.counts.missing_punch },
        ],
      }))}
    />
  );
}
