import Link from "next/link";
import { BarList } from "@/components/charts";
import { Badge, Card, CardHeader, EmptyState, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { OffsetPagination } from "@/components/pagination";
import { Definitions, ReportHeading } from "@/components/reports/parts";
import { ReportActions } from "@/components/reports/report-actions";
import { REPORT_STATUS_LABEL } from "@/lib/attendance/reports";
import { shortTime } from "@/lib/attendance";
import { cn } from "@/lib/utils";
import { carryFilters, loadAttendanceReport, pageRows } from "../data";
import { BASE } from "../tabs";

export const metadata = { title: "Attendance exceptions" };

const TYPES = [
  { value: "", label: "All exceptions" },
  { value: "missing_punch", label: "Missing punch" },
  { value: "not_marked", label: "Not marked" },
] as const;

export default async function ExceptionsReportPage({ searchParams }: PageProps<"/attendance/reports/exceptions">) {
  const params = await searchParams;
  const { report, scope, today } = await loadAttendanceReport(params);
  const link = carryFilters(params);

  const type = TYPES.find((t) => t.value && t.value === params.type)?.value ?? "";
  const rows = type ? report.exceptions.filter((e) => e.status === type) : report.exceptions;
  const { page, visible } = pageRows(rows, params);

  const missing = report.exceptions.filter((e) => e.status === "missing_punch").length;
  const unmarked = report.exceptions.length - missing;

  // who has the most open exceptions — usually a reader enrolment problem
  const perPerson = new Map<string, { name: string; code: string; n: number }>();
  for (const e of report.exceptions) {
    const p = perPerson.get(e.employeeId) ?? { name: e.name, code: e.code, n: 0 };
    p.n++;
    perPerson.set(e.employeeId, p);
  }
  const worst = [...perPerson.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8);

  // days with the most unrecorded people — usually a reader that was not polled
  const worstDays = report.daily
    .filter((d) => d.date < today && d.counts.not_marked + d.counts.missing_punch > 0)
    .sort((a, b) => b.counts.not_marked + b.counts.missing_punch - (a.counts.not_marked + a.counts.missing_punch))
    .slice(0, 8);

  const affected = perPerson.size;

  return (
    <>
      <ReportHeading
        title="Exceptions"
        description="Working days payroll cannot rely on yet: a single punch, or no record at all. Clear these before the period is locked."
        scope={scope}
        actions={<ReportActions exportHref={`${BASE}/export?report=exceptions`} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open exceptions" value={report.exceptions.length} sub="before today" tone={report.exceptions.length ? "warn" : "ok"} />
        <StatTile label="Missing punches" value={missing} sub="one punch recorded" tone={missing ? "warn" : "neutral"} />
        <StatTile label="Not marked" value={unmarked} sub="working day, no record" tone={unmarked ? "danger" : "neutral"} />
        <StatTile label="People affected" value={affected} sub={`of ${report.totals.headcount}`} tone="neutral" />
      </div>

      {report.exceptions.length > 0 ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Most exceptions" description="People to follow up with, or to re-enrol on a reader" />
            <div className="p-3">
              <BarList
                colour="var(--color-warn)"
                items={worst.map(([id, p]) => ({
                  key: id,
                  label: (
                    <Link href={`/hr/employees/${id}`} className="hover:text-accent">
                      {p.name} <span className="font-mono text-[11px] text-ink-faint">{p.code}</span>
                    </Link>
                  ),
                  value: p.n,
                }))}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Worst days" description="Many at once usually means a reader was not polled" />
            <div className="p-3">
              <BarList
                colour="var(--color-danger)"
                items={worstDays.map((d) => ({
                  key: d.date,
                  label: (
                    <Link href={`/attendance/register?d=${d.date}`} className="tabular hover:text-accent">
                      {d.dateBs} <span className="text-[11px] text-ink-faint">{d.date}</span>
                    </Link>
                  ),
                  value: d.counts.not_marked + d.counts.missing_punch,
                  hint: `${d.counts.missing_punch} MP · ${d.counts.not_marked} NM`,
                }))}
              />
            </div>
          </Card>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-1.5 print:hidden">
        {TYPES.map((t) => {
          const active = t.value === type;
          return (
            <Link
              key={t.value}
              href={link(`${BASE}/exceptions`, t.value ? { type: t.value } : undefined)}
              scroll={false}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                active ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-ink-soft hover:bg-sunk",
              )}
            >
              {t.label}
              <span className="tabular ml-1.5 text-ink-faint">
                {t.value === "missing_punch" ? missing : t.value === "not_marked" ? unmarked : report.exceptions.length}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mt-3">
        {rows.length === 0 ? (
          <Card>
            <EmptyState title="Nothing to clear" hint="Every working day in this period has a complete record." />
          </Card>
        ) : (
          <div className="overflow-hidden rounded-md border border-line bg-surface print:overflow-visible">
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Date (BS)</Th>
                  <Th>Date (AD)</Th>
                  <Th>Employee</Th>
                  <Th>Department</Th>
                  <Th>Exception</Th>
                  <Th className="text-right">In</Th>
                  <Th className="text-right">Out</Th>
                  <Th className="print:hidden" />
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <Tr key={`${e.employeeId}:${e.date}`}>
                    <Td className="tabular text-xs text-ink">{e.dateBs}</Td>
                    <Td className="tabular text-xs text-ink-faint">{e.date}</Td>
                    <Td>
                      <Link href={`/hr/employees/${e.employeeId}`} className="font-medium text-ink hover:text-accent">
                        {e.name}
                      </Link>
                      <span className="ml-1.5 font-mono text-[11px] text-ink-faint">{e.code}</span>
                    </Td>
                    <Td className="text-xs text-ink-soft">{e.department ?? "—"}</Td>
                    <Td>
                      <Badge tone={e.status === "missing_punch" ? "warn" : "danger"}>{REPORT_STATUS_LABEL[e.status]}</Badge>
                    </Td>
                    <Td className="tabular text-right text-xs">{shortTime(e.checkIn)}</Td>
                    <Td className="tabular text-right text-xs">{shortTime(e.checkOut)}</Td>
                    <Td className="text-right print:hidden">
                      <Link href={`/attendance/register?d=${e.date}`} className="text-xs text-accent hover:underline">
                        Open day
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
            <OffsetPagination page={page} params={params} label="exceptions" className="print:hidden" />
          </div>
        )}
      </div>

      <Definitions
        items={[
          { term: "Missing punch", meaning: "Only a check-in or only a check-out was recorded. The employee raises a correction request; approval recomputes the day." },
          { term: "Not marked", meaning: "A working day with no record and no approved leave. Usually a reader that was not polled, or somebody not enrolled on one." },
          { term: "Today", meaning: "Today is never an exception — its punches arrive as the readers are polled." },
          { term: "Not counted as absence", meaning: "Unrecorded days are left out of attendance and absence rates, so a data gap never reads as somebody's absence." },
        ]}
      />
    </>
  );
}
