import Link from "next/link";
import { BarList } from "@/components/charts";
import { Badge, Card, CardHeader, EmptyState, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { Definitions, ReportHeading } from "@/components/reports/parts";
import { ReportActions } from "@/components/reports/report-actions";
import { formatDayCount, formatRate } from "@/lib/reports/buckets";
import { formatTurnaround } from "@/modules/leave/reports";
import { loadLeaveReport } from "../data";
import { BsSpan, TypePill } from "../parts";
import { BASE } from "../tabs";

export const metadata = { title: "Leave approvals report" };

function ageTone(days: number): "ok" | "warn" | "danger" {
  if (days > 7) return "danger";
  if (days > 3) return "warn";
  return "ok";
}

export default async function LeaveApprovalsReportPage({ searchParams }: PageProps<"/leave/reports/approvals">) {
  const params = await searchParams;
  const { report, scope } = await loadLeaveReport(params);
  const t = report.totals;

  const pending = report.requests
    .filter((r) => r.status === "pending")
    .sort((a, b) => (b.pendingAgeDays ?? 0) - (a.pendingAgeDays ?? 0));
  const oldest = pending[0]?.pendingAgeDays ?? null;
  const decided = t.approved + t.rejected;

  return (
    <>
      <ReportHeading
        title="Approvals"
        description="How quickly leave is decided and by whom — the queue as it stands, how long it has waited, and each approver's record."
        scope={scope}
        actions={<ReportActions exportHref={`${BASE}/export?report=approvals`} />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Waiting now" value={pending.length} sub={`${formatDayCount(t.pendingDays)} days reserved`} tone={pending.length ? "warn" : "ok"} />
        <StatTile
          label="Oldest in the queue"
          value={oldest === null ? "—" : `${oldest}d`}
          sub="since submission"
          tone={oldest === null ? "neutral" : ageTone(oldest)}
        />
        <StatTile label="Decided" value={decided} sub={`${t.approved} approved · ${t.rejected} rejected`} tone="accent" />
        <StatTile label="Median decision time" value={formatTurnaround(t.medianTurnaroundHours)} sub={`mean ${formatTurnaround(t.avgTurnaroundHours)}`} tone="info" />
        <StatTile
          label="Decided within 48h"
          value={formatRate(t.decidedWithin48h, 0)}
          sub="of decided requests"
          tone={t.decidedWithin48h === null ? "neutral" : t.decidedWithin48h >= 0.8 ? "ok" : "warn"}
        />
        <StatTile label="Rejection rate" value={formatRate(t.rejectionRate, 0)} sub="of decided requests" tone={(t.rejectionRate ?? 0) > 0.2 ? "danger" : "neutral"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader title="The queue" description="Pending requests in the period, longest waiting first" />
          {pending.length === 0 ? (
            <EmptyState title="Nothing is waiting on a decision" />
          ) : (
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Reference</Th>
                  <Th>Employee</Th>
                  <Th>Type</Th>
                  <Th>Dates (BS)</Th>
                  <Th className="text-right">Days</Th>
                  <Th>Waiting on</Th>
                  <Th className="text-right">Waiting</Th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-mono text-xs text-ink-soft">{r.reference}</Td>
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
                    <Td className="tabular text-right text-sm">{formatDayCount(r.totalDays)}</Td>
                    <Td className="text-xs text-ink-soft">
                      {r.awaiting}
                      {r.currentLevel && r.currentLevel > 1 ? <span className="ml-1 text-ink-faint">· level {r.currentLevel}</span> : null}
                    </Td>
                    <Td className="text-right">
                      <Badge tone={ageTone(r.pendingAgeDays ?? 0)}>{r.pendingAgeDays ?? 0}d</Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
          <div className="border-t border-line-soft px-4 py-2 text-right print:hidden">
            <Link href="/leave/approvals" className="text-xs text-accent hover:underline">
              Open the approvals queue to decide
            </Link>
          </div>
        </Card>

        <Card>
          <CardHeader title="How long it has waited" description="Pending requests by age" />
          <div className="p-3">
            <BarList
              colour="var(--color-warn)"
              items={report.pendingAgeing.map((a) => ({ key: a.label, label: a.label, value: a.count }))}
            />
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="By approver" description="Every approval step on requests in the period, per person who holds it" />
        {report.approvers.length === 0 ? (
          <EmptyState title="No approval activity in this period" />
        ) : (
          <TableShell className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Approver</Th>
                <Th className="text-right">Decided</Th>
                <Th className="text-right">Approved</Th>
                <Th className="text-right">Rejected</Th>
                <Th className="text-right">Waiting on them</Th>
                <Th className="text-right">Average response</Th>
              </tr>
            </thead>
            <tbody>
              {report.approvers.map((a) => (
                <Tr key={a.key}>
                  <Td>
                    <span className="font-medium text-ink">{a.label}</span>
                    {a.role && a.role !== a.label ? <p className="text-[11px] text-ink-faint">{a.role}</p> : null}
                  </Td>
                  <Td className="tabular text-right">{a.decided}</Td>
                  <Td className="tabular text-right text-ok">{a.approved}</Td>
                  <Td className={`tabular text-right ${a.rejected ? "text-danger" : "text-ink-faint"}`}>{a.rejected}</Td>
                  <Td className={`tabular text-right ${a.pending ? "font-medium text-warn" : "text-ink-faint"}`}>{a.pending}</Td>
                  <Td className="tabular text-right text-ink-soft">{formatTurnaround(a.avgHours)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>

      <Definitions
        items={[
          { term: "Waiting", meaning: "Whole days since the request was submitted. Amber after three days, red after a week." },
          { term: "Decision time", meaning: "Submission to final decision, across every level of the chain." },
          { term: "Average response", meaning: "Per approval step: from when it reached this approver — submission for level one, the previous level's decision after that — to their decision." },
          { term: "Waiting on them", meaning: "Pending requests whose current level is this approver. Later levels are not counted until reached." },
        ]}
      />
    </>
  );
}
