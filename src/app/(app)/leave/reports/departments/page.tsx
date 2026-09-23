import Link from "next/link";
import { StackedBarChart } from "@/components/charts";
import { Card, CardHeader, EmptyState, TableShell, Td, Th, Tr } from "@/components/ui";
import { Definitions, ReportHeading } from "@/components/reports/parts";
import { ReportActions } from "@/components/reports/report-actions";
import { formatDayCount, formatRate } from "@/lib/reports/buckets";
import { carryFilters, loadLeaveReport } from "../data";
import { BASE } from "../tabs";

export const metadata = { title: "Leave by department" };

export default async function LeaveDepartmentsPage({ searchParams }: PageProps<"/leave/reports/departments">) {
  const params = await searchParams;
  const { report, scope } = await loadLeaveReport(params);
  const link = carryFilters(params);
  const t = report.totals;

  const rows = [...report.departments].sort((a, b) => b.daysPerHead - a.daysPerHead || a.name.localeCompare(b.name));
  const usedTypes = report.types.filter((type) => (t.byType[type.id] ?? 0) > 0);

  return (
    <>
      <ReportHeading
        title="Departments"
        description="Leave per department, per head so teams of different sizes compare fairly — and what it is made of."
        scope={scope}
        actions={<ReportActions exportHref={`${BASE}/export?report=departments`} />}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="Nobody matches these filters" />
        </Card>
      ) : (
        <>
          {usedTypes.length > 0 ? (
            <Card>
              <CardHeader title="Leave days by type" description="Approved days in the period, in the table's order; days per head at the end" />
              <div className="p-4">
                <StackedBarChart
                  absolute
                  rows={rows.map((d) => ({
                    label: d.name,
                    segments: usedTypes.map((type) => ({ key: type.id, value: d.byType[type.id] ?? 0 })),
                    trailing: d.daysPerHead.toFixed(1),
                  }))}
                  keys={usedTypes.map((type) => ({ key: type.id, label: type.name, colour: type.colour }))}
                />
              </div>
            </Card>
          ) : null}

          <div className="mt-4 overflow-hidden rounded-md border border-line bg-surface print:overflow-visible">
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Department</Th>
                  <Th className="text-right">People</Th>
                  <Th className="text-right">On leave</Th>
                  <Th className="text-right">Leave days</Th>
                  <Th className="text-right">Per head</Th>
                  <Th className="text-right">Unpaid</Th>
                  <Th className="text-right">Field work</Th>
                  <Th className="text-right">Pending</Th>
                  <Th className="text-right">Rejected</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <Tr key={d.id ?? "none"}>
                    <Td>
                      {d.id ? (
                        <Link href={link(`${BASE}/balances`, { dept: d.id })} className="font-medium text-ink hover:text-accent">
                          {d.name}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink-soft">{d.name}</span>
                      )}
                    </Td>
                    <Td className="tabular text-right">{d.headcount}</Td>
                    <Td className="tabular text-right text-xs">
                      {d.peopleOnLeave}
                      <span className="ml-1 text-ink-faint">· {formatRate(d.headcount ? d.peopleOnLeave / d.headcount : null, 0)}</span>
                    </Td>
                    <Td className="tabular text-right text-sm font-semibold">{formatDayCount(d.takenDays)}</Td>
                    <Td className="tabular text-right text-sm">{d.daysPerHead.toFixed(1)}</Td>
                    <Td className={`tabular text-right text-xs ${d.unpaidDays ? "text-warn" : "text-ink-faint/60"}`}>
                      {d.unpaidDays ? formatDayCount(d.unpaidDays) : "·"}
                    </Td>
                    <Td className={`tabular text-right text-xs ${d.workingDays ? "text-info" : "text-ink-faint/60"}`}>
                      {d.workingDays ? formatDayCount(d.workingDays) : "·"}
                    </Td>
                    <Td className={`tabular text-right text-xs ${d.pending ? "text-warn" : "text-ink-faint/60"}`}>
                      {d.pending ? `${d.pending} · ${formatDayCount(d.pendingDays)}d` : "·"}
                    </Td>
                    <Td className={`tabular text-right text-xs ${d.rejected ? "text-danger" : "text-ink-faint/60"}`}>
                      {d.rejected || "·"}
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-sunk/60 text-xs font-semibold">
                  <Td>Whole selection</Td>
                  <Td className="tabular text-right">{report.headcount}</Td>
                  <Td className="tabular text-right">{t.peopleOnLeave}</Td>
                  <Td className="tabular text-right">{formatDayCount(t.takenDays)}</Td>
                  <Td className="tabular text-right">{report.headcount ? (t.takenDays / report.headcount).toFixed(1) : "—"}</Td>
                  <Td className="tabular text-right text-warn">{formatDayCount(t.unpaidDays)}</Td>
                  <Td className="tabular text-right text-info">{formatDayCount(t.workingDays)}</Td>
                  <Td className="tabular text-right text-warn">{t.pending}</Td>
                  <Td className="tabular text-right text-danger">{t.rejected}</Td>
                </tr>
              </tfoot>
            </TableShell>
          </div>
        </>
      )}

      <Definitions
        items={[
          { term: "On leave", meaning: "People with at least one approved leave day in the period, and their share of the department." },
          { term: "Per head", meaning: "Leave days divided by everybody in the department — including those who took none." },
          { term: "Field work", meaning: "Official duty away from the desk. Shown for completeness; not counted in leave days." },
          { term: "Drill down", meaning: "Click a department to open its balances for the same period." },
        ]}
      />
    </>
  );
}
