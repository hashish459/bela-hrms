import Link from "next/link";
import { BarList, DonutChart, StackedBarChart, StackedColumnChart } from "@/components/charts";
import { Card, CardHeader, EmptyState, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { Definitions, ReportHeading } from "@/components/reports/parts";
import { ReportActions } from "@/components/reports/report-actions";
import { formatDayCount, formatRate } from "@/lib/reports/buckets";
import { formatTurnaround } from "@/modules/leave/reports";
import { carryFilters, loadLeaveReport } from "./data";
import { BsSpan, TypePill } from "./parts";
import { BASE } from "./tabs";

export const metadata = { title: "Leave reports" };

export default async function LeaveReportsOverview({ searchParams }: PageProps<"/leave/reports">) {
  const params = await searchParams;
  const { report, scope, today } = await loadLeaveReport(params);
  const t = report.totals;
  const link = carryFilters(params);

  // types that actually appear in the period, in policy order, for the charts
  const usedTypes = report.types.filter((type) => (t.byType[type.id] ?? 0) > 0);
  const keys = usedTypes.map((type) => ({ key: type.id, label: type.name, colour: type.colour }));

  const peakDays = [...report.days]
    .filter((d) => d.onLeave > 0)
    .sort((a, b) => b.onLeave - a.onLeave || (a.date < b.date ? -1 : 1))
    .slice(0, 6);

  const fyCode = report.fiscalYear?.code ?? "—";

  return (
    <>
      <ReportHeading
        title="Overview"
        description="How much leave was taken and by whom, what is still waiting on a decision, and how much entitlement is left in the year."
        scope={scope}
        actions={<ReportActions exportHref={`${BASE}/export?report=daily`} />}
      />

      {report.headcount === 0 ? (
        <Card>
          <EmptyState title="Nobody matches these filters" hint="Try another period, or clear the department and search filters." />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatTile
              label="Leave days approved"
              value={formatDayCount(t.takenDays)}
              sub={`${t.peopleOnLeave} of ${report.headcount} people · ${t.spells} requests`}
              tone="accent"
            />
            <StatTile
              label="Days per head"
              value={report.headcount ? (t.takenDays / report.headcount).toFixed(1) : "—"}
              sub={t.unpaidDays ? `${formatDayCount(t.unpaidDays)} unpaid days` : "no unpaid leave"}
              tone={t.unpaidDays ? "warn" : "neutral"}
            />
            <StatTile
              label="Awaiting decision"
              value={t.pending}
              sub={`${formatDayCount(t.pendingDays)} days reserved`}
              tone={t.pending ? "warn" : "ok"}
            />
            <StatTile
              label="Median decision time"
              value={formatTurnaround(t.medianTurnaroundHours)}
              sub={t.decidedWithin48h === null ? "nothing decided yet" : `${formatRate(t.decidedWithin48h, 0)} within 48 hours`}
              tone="info"
            />
            <StatTile
              label="Rejection rate"
              value={formatRate(t.rejectionRate, 0)}
              sub={`${t.rejected} rejected · ${t.cancelled} withdrawn`}
              tone={(t.rejectionRate ?? 0) > 0.2 ? "danger" : "neutral"}
            />
            <StatTile
              label={`Annual leave used · FY ${fyCode}`}
              value={formatRate(t.utilisation, 0)}
              sub={
                report.fiscalYear?.isClosed
                  ? `year closed · ${formatDayCount(t.available)} days left at close`
                  : t.atRisk > 0
                    ? `${formatDayCount(t.atRisk)} days at risk of lapsing`
                    : `${formatDayCount(t.available)} days still available`
              }
              tone={t.atRisk > 0 ? "warn" : "ok"}
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_22rem]">
            <Card>
              <CardHeader
                title="Leave over the period"
                description={`Approved leave days per ${report.granularity}, by type. The figure above each column is the most people away on any one day.`}
              />
              <div className="p-4">
                {keys.length === 0 ? (
                  <EmptyState title="No approved leave in this period" />
                ) : (
                  <StackedColumnChart
                    absolute
                    height={140}
                    keys={keys}
                    columns={report.trend.map((b) => ({
                      label: b.label,
                      title: `${b.sublabel} · ${formatDayCount(b.total)} days · up to ${b.peakOnLeave} away`,
                      caption: b.peakOnLeave ? String(b.peakOnLeave) : undefined,
                      segments: usedTypes.map((type) => ({ key: type.id, value: b.byType[type.id] ?? 0 })),
                    }))}
                  />
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="By leave type" description="Approved days in the period" />
              <div className="p-4">
                {keys.length === 0 ? (
                  <EmptyState title="Nothing approved yet" />
                ) : (
                  <DonutChart
                    centreValue={formatDayCount(t.takenDays + t.workingDays)}
                    centreLabel="days"
                    slices={usedTypes.map((type) => ({
                      label: type.name,
                      value: Math.round((t.byType[type.id] ?? 0) * 10) / 10,
                      colour: type.colour,
                    }))}
                  />
                )}
                {t.workingDays > 0 ? (
                  <p className="mt-3 border-t border-line-soft pt-2 text-[11px] text-ink-faint">
                    Includes {formatDayCount(t.workingDays)} days of field work or travel — time at work, not absence, and
                    left out of the leave totals above.
                  </p>
                ) : null}
              </div>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Who is away soon"
                description="Approved leave in the next 30 days, from today"
                action={
                  <Link href={link(`${BASE}/history`, { status: "approved" })} className="text-xs text-accent hover:underline">
                    History
                  </Link>
                }
              />
              {report.upcoming.length === 0 ? (
                <EmptyState title="Nobody has approved leave in the next 30 days" />
              ) : (
                <TableShell className="rounded-none border-0">
                  <thead>
                    <tr>
                      <Th>Employee</Th>
                      <Th>Type</Th>
                      <Th>Dates (BS)</Th>
                      <Th className="text-right">Days</Th>
                      <Th className="text-right">Starts</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.upcoming.slice(0, 8).map((r) => {
                      const inDays = Math.round((Date.parse(r.fromDate) - Date.parse(today)) / 86_400_000);
                      return (
                        <Tr key={r.id}>
                          <Td>
                            <Link href={`/hr/employees/${r.employeeId}`} className="font-medium text-ink hover:text-accent">
                              {r.name}
                            </Link>
                            <p className="text-[11px] text-ink-faint">{r.department ?? "—"}</p>
                          </Td>
                          <Td>
                            <TypePill name={r.typeName} colour={r.typeColour} />
                          </Td>
                          <Td className="text-xs text-ink-soft">
                            <BsSpan from={r.fromDateBs} to={r.toDateBs} />
                          </Td>
                          <Td className="tabular text-right text-sm font-medium">{formatDayCount(r.totalDays)}</Td>
                          <Td className="text-right text-xs">
                            {inDays <= 0 ? (
                              <span className="font-medium text-accent">Away now</span>
                            ) : (
                              <span className="text-ink-soft">in {inDays} {inDays === 1 ? "day" : "days"}</span>
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </TableShell>
              )}
            </Card>

            <Card>
              <CardHeader title="Busiest days" description="Most people on leave at once in the period" />
              <div className="p-3">
                <BarList
                  colour="var(--color-accent)"
                  empty="Nobody was on leave"
                  items={peakDays.map((d) => ({
                    key: d.date,
                    label: (
                      <span className="tabular">
                        {d.dateBs} <span className="text-[11px] text-ink-faint">{d.date}</span>
                      </span>
                    ),
                    value: d.onLeave,
                    display: `${d.onLeave} away`,
                  }))}
                />
              </div>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Most leave taken"
                description="Approved days in the period"
                action={
                  <Link href={link(`${BASE}/balances`, { sort: "taken", dir: "desc" })} className="text-xs text-accent hover:underline">
                    All
                  </Link>
                }
              />
              <div className="p-3">
                <BarList
                  empty="No leave taken"
                  items={[...report.employees]
                    .filter((e) => e.takenDays > 0)
                    .sort((a, b) => b.takenDays - a.takenDays)
                    .slice(0, 6)
                    .map((e) => ({
                      key: e.id,
                      label: <Link href={`/hr/employees/${e.id}`} className="hover:text-accent">{e.name}</Link>,
                      value: e.takenDays,
                      display: `${formatDayCount(e.takenDays)} d`,
                      hint: `${e.spells} ${e.spells === 1 ? "request" : "requests"}`,
                    }))}
                />
              </div>
            </Card>

            {report.departments.length > 1 && keys.length > 0 ? (
              <Card>
                <CardHeader
                  title="Leave mix by department"
                  description="Share of each department's approved days, by type; days per head at the end"
                  action={<Link href={link(`${BASE}/departments`)} className="text-xs text-accent hover:underline">Department report</Link>}
                />
                <div className="p-4">
                  <StackedBarChart
                    rows={[...report.departments]
                      .filter((d) => d.takenDays + d.workingDays > 0)
                      .sort((a, b) => b.daysPerHead - a.daysPerHead)
                      .map((d) => ({
                        label: d.name,
                        segments: usedTypes.map((type) => ({ key: type.id, value: d.byType[type.id] ?? 0 })),
                        trailing: d.daysPerHead.toFixed(1),
                      }))}
                    keys={keys}
                  />
                </div>
              </Card>
            ) : null}
          </div>

          <Definitions
            items={[
              {
                term: "Leave days",
                meaning:
                  "Approved working days of leave inside the period. Saturdays and holidays are never charged; a half day counts as half. A request that runs over the period's edge counts only its days inside it.",
              },
              {
                term: "Field work and travel",
                meaning: "Leave types with an official-work or transit nature are time at work. They are shown, but not counted as leave taken.",
              },
              {
                term: "Decision time",
                meaning: "From submission to the final decision, across every approval level. Median, so one forgotten request does not hide the typical case.",
              },
              {
                term: "Annual leave used",
                meaning: `Used plus reserved, over entitled plus carried forward, for fiscal year ${fyCode} — the year this period ends in. Service-period leave (maternity, paternity, study) is left out: it covers a whole career, and pooling it would make every year look barely used.`,
              },
              {
                term: "At risk of lapsing",
                meaning: "Available days beyond what the type lets carry forward. They disappear at year end unless taken or encashed.",
              },
              {
                term: "Future dates",
                meaning: "Leave is planned: approved leave later in the period is already counted, unlike attendance, which stops at today.",
              },
            ]}
          />
        </>
      )}
    </>
  );
}
