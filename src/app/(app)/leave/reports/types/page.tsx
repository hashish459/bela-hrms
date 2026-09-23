import Link from "next/link";
import { BarList, StackedBarChart } from "@/components/charts";
import { Badge, Card, CardHeader, EmptyState, TableShell, Td, Th, Tr } from "@/components/ui";
import { Definitions, RateCell, ReportHeading } from "@/components/reports/parts";
import { ReportActions } from "@/components/reports/report-actions";
import { formatDayCount, formatRate } from "@/lib/reports/buckets";
import { carryFilters, loadLeaveReport } from "../data";
import { TypePill } from "../parts";
import { BASE } from "../tabs";

export const metadata = { title: "Leave by type" };

const NATURE_LABEL: Record<string, string> = {
  official_work: "Field work",
  transit: "Travel",
  paid: "Paid",
  unpaid: "Unpaid",
  absent: "Absence",
  substitute: "Substitute",
  holiday: "Closure",
};

export default async function LeaveByTypePage({ searchParams }: PageProps<"/leave/reports/types">) {
  const params = await searchParams;
  const { report, scope } = await loadLeaveReport(params);
  const link = carryFilters(params);
  const rows = [...report.byType];
  const withBalance = rows.filter((r) => r.entitled > 0);
  const fyCode = report.fiscalYear?.code ?? "—";

  return (
    <>
      <ReportHeading
        title="By leave type"
        description="Each leave type on its own: how much was taken in the period, by how many people, how often it is refused, and how much of the year's entitlement is gone."
        scope={`${scope} · entitlement for FY ${fyCode}`}
        actions={<ReportActions exportHref={`${BASE}/export?report=types`} />}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="No leave types in use" hint="Nobody holds an entitlement and no requests fall in this period." />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
            <Card>
              <CardHeader title="Days taken" description="Approved days inside the period" />
              <div className="p-3">
                <BarList
                  empty="Nothing approved in this period"
                  items={rows
                    .filter((r) => (r.byType[r.type.id] ?? 0) > 0)
                    .sort((a, b) => (b.byType[b.type.id] ?? 0) - (a.byType[a.type.id] ?? 0))
                    .map((r) => ({
                      key: r.type.id,
                      label: <TypePill name={r.type.name} colour={r.type.colour} />,
                      value: r.byType[r.type.id] ?? 0,
                      display: `${formatDayCount(r.byType[r.type.id] ?? 0)} d`,
                      hint: `${r.takers}p`,
                    }))}
                />
              </div>
            </Card>

            <Card>
              <CardHeader
                title={`Entitlement used · FY ${fyCode}`}
                description="Used, reserved by pending requests, and still available — in days, across everybody in scope"
              />
              <div className="p-4">
                {withBalance.length === 0 ? (
                  <EmptyState title="No entitlement allocated for this fiscal year" />
                ) : (
                  <StackedBarChart
                    absolute
                    rows={withBalance
                      .sort((a, b) => (b.utilisation ?? 0) - (a.utilisation ?? 0))
                      .map((r) => ({
                        label: r.type.name,
                        segments: [
                          { key: "used", value: r.used },
                          { key: "pending", value: r.pendingBalance },
                          { key: "available", value: Math.max(0, r.available) },
                        ],
                        trailing: formatRate(r.utilisation, 0),
                      }))}
                    keys={[
                      { key: "used", label: "Used", colour: "var(--color-accent)" },
                      { key: "pending", label: "Reserved", colour: "var(--color-warn)" },
                      { key: "available", label: "Available", colour: "var(--color-line)" },
                    ]}
                  />
                )}
              </div>
            </Card>
          </div>

          <div className="mt-4 overflow-hidden rounded-md border border-line bg-surface print:overflow-visible">
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Leave type</Th>
                  <Th>Nature</Th>
                  <Th className="text-right">Requests</Th>
                  <Th className="text-right">Approved</Th>
                  <Th className="text-right">Rejected</Th>
                  <Th className="text-right">Days taken</Th>
                  <Th className="text-right">People</Th>
                  <Th className="text-right">Avg length</Th>
                  <Th className="text-right">Entitled</Th>
                  <Th className="text-right">Available</Th>
                  <Th className="text-right">At risk</Th>
                  <Th className="text-right">Used</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.type.id}>
                    <Td>
                      <Link
                        href={link(`${BASE}/history`, { type: r.type.id })}
                        className="hover:underline"
                        title="Open this type's requests"
                      >
                        <TypePill name={r.type.name} colour={r.type.colour} />
                      </Link>
                      <p className="font-mono text-[10px] text-ink-faint">{r.type.code}</p>
                    </Td>
                    <Td>
                      <Badge tone={r.type.isWorking ? "info" : r.type.isPaid ? "neutral" : "warn"}>
                        {NATURE_LABEL[r.type.nature] ?? r.type.nature}
                      </Badge>
                    </Td>
                    <Td className="tabular text-right text-xs">{r.requests || "·"}</Td>
                    <Td className="tabular text-right text-xs text-ok">{r.approved || "·"}</Td>
                    <Td className="tabular text-right text-xs">
                      {r.rejected ? (
                        <span className="text-danger">
                          {r.rejected}
                          <span className="ml-1 text-ink-faint">· {formatRate(r.rejectionRate, 0)}</span>
                        </span>
                      ) : (
                        <span className="text-ink-faint/60">·</span>
                      )}
                    </Td>
                    <Td className="tabular text-right text-sm font-semibold">
                      {formatDayCount(r.byType[r.type.id] ?? 0)}
                    </Td>
                    <Td className="tabular text-right text-xs">{r.takers || "·"}</Td>
                    <Td className="tabular text-right text-xs text-ink-soft">
                      {r.avgRequestDays === null ? "—" : `${r.avgRequestDays.toFixed(1)} d`}
                    </Td>
                    <Td className="tabular text-right text-xs text-ink-soft">{r.entitled ? formatDayCount(r.entitled) : "—"}</Td>
                    <Td className={`tabular text-right text-xs ${r.available < 0 ? "text-danger" : ""}`}>
                      {r.entitled ? formatDayCount(r.available) : "—"}
                    </Td>
                    <Td className={`tabular text-right text-xs ${r.atRisk ? "font-medium text-warn" : "text-ink-faint/60"}`}>
                      {r.atRisk ? formatDayCount(r.atRisk) : "·"}
                    </Td>
                    <Td className="text-right">
                      {r.entitled ? (
                        <RateCell
                          rate={r.utilisation}
                          tone={r.utilisation === null ? "neutral" : r.utilisation > 1 ? "danger" : r.utilisation >= 0.9 ? "warn" : "info"}
                        />
                      ) : (
                        <span className="text-xs text-ink-faint">untracked</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          </div>
        </>
      )}

      <Definitions
        items={[
          { term: "Requests", meaning: "Every request whose dates overlap the period, whatever its status." },
          { term: "Rejected · %", meaning: "Rejected requests, and their share of the ones decided (approved + rejected). Withdrawn requests are left out." },
          { term: "Avg length", meaning: "Approved days in the period per approved request." },
          {
            term: "Untracked",
            meaning: "Types with no entitlement to count against — usually field work, or leave without pay, which is granted as needed.",
          },
        ]}
      />
    </>
  );
}
