import { Search } from "lucide-react";
import { requirePermission } from "@/lib/session";
import { formatDays } from "@/lib/utils";
import { pageOf } from "@/lib/pagination";
import { adToBs, formatBs } from "@/lib/bs";
import { OffsetPagination } from "@/components/pagination";
import { Badge, Card, CardHeader, EmptyState, Input, PageHeader, Select, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { encashableBalances, encashmentHistory, fiscalYearList } from "@/modules/leave/admin";
import { EncashButton, ReverseButton } from "./panels";

export const metadata = { title: "Leave Encashment" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const npt = (d: Date) => formatBs(adToBs(new Date(d.getTime() + (5 * 60 + 45) * 60_000).toISOString().slice(0, 10)));

/**
 * Paying out unused leave. Only types marked encashable appear; each
 * encashment is checked against the type's minimum and maximum and the
 * days actually available, takes carried-forward days first, and carries an
 * ENC reference payroll can quote. A mistake is reversed, never deleted.
 */
export default async function EncashmentPage({ searchParams }: PageProps<"/leave/encashment">) {
  const viewer = await requirePermission("leave.balance.manage");
  const params = await searchParams;
  const years = await fiscalYearList(viewer.orgId);
  const fy = years.find((y) => y.id === one(params.fy)) ?? years.find((y) => y.isCurrent) ?? years[0];
  if (!fy) {
    return (
      <>
        <PageHeader title="Leave Encashment" />
        <Card>
          <EmptyState title="No fiscal years yet" />
        </Card>
      </>
    );
  }
  const q = one(params.q)?.trim().toLowerCase() ?? "";

  const [balances, history] = await Promise.all([encashableBalances(viewer.orgId, fy.id), encashmentHistory(viewer.orgId, fy.id)]);
  const shown = balances.filter((b) => !q || `${b.employeeName} ${b.employeeCode}`.toLowerCase().includes(q));
  const { items, page } = pageOf(shown, params, { sizes: [25, 50, 100] });
  const { items: hist, page: histPage } = pageOf(history, params, { param: "hpage", sizeParam: "hsize", size: 15 });

  const encashedDays = history.filter((h) => h.a.kind === "encashment" && !h.a.reversedAt).reduce((a, h) => a - Number(h.a.days), 0);
  const potential = balances.reduce((a, b) => a + b.encashable, 0);
  const people = new Set(history.filter((h) => h.a.kind === "encashment" && !h.a.reversedAt).map((h) => h.a.employeeId)).size;

  return (
    <>
      <PageHeader title="Leave Encashment" description={`Unused leave paid out in fiscal year ${fy.code}. Only leave types marked encashable appear here.`} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Encashed this year" value={`${formatDays(encashedDays)} d`} sub={`${people} ${people === 1 ? "person" : "people"}`} tone="accent" />
        <StatTile label="Could still be encashed" value={`${formatDays(potential)} d`} sub="within each type's limits" tone="ok" />
        <StatTile label="Eligible balances" value={balances.length} />
        <StatTile label="Entries" value={history.length} sub={`${history.filter((h) => h.a.reversedAt).length} reversed`} />
      </div>

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-2 border-b border-line-soft p-3" role="search">
          <Select name="fy" defaultValue={fy.id} className="w-auto" aria-label="Fiscal year">
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                FY {y.code}
              </option>
            ))}
          </Select>
          <label className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Find an employee" className="pl-8" aria-label="Find an employee" />
          </label>
          <button type="submit" className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover">
            Show
          </button>
        </form>
        {shown.length === 0 ? (
          <EmptyState title="No encashable balances." hint="Mark a leave type encashable under Leave › Leave Types › Year end & pay." />
        ) : (
          <TableShell className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Leave</Th>
                <Th className="text-right">Available</Th>
                <Th className="text-right">Encashed</Th>
                <Th className="text-right">Limits</Th>
                <Th className="text-right">Can encash</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <Tr key={b.balanceId}>
                  <Td className="whitespace-nowrap">
                    <span className="font-medium text-ink">{b.employeeName}</span>
                    <span className="ml-1.5 font-mono text-[11px] text-ink-faint">{b.employeeCode}</span>
                    {b.department ? <span className="block text-[11px] text-ink-faint">{b.department}</span> : null}
                  </Td>
                  <Td>
                    <span className="flex items-center gap-1.5 text-ink-soft">
                      <span className="size-2 rounded-full" style={{ background: b.colour }} aria-hidden />
                      {b.leaveTypeName}
                    </span>
                  </Td>
                  <Td className="tabular text-right">{formatDays(b.available)}</Td>
                  <Td className="tabular text-right text-ink-soft">{b.encashed ? formatDays(b.encashed) : "—"}</Td>
                  <Td className="tabular text-right text-xs text-ink-faint">
                    {b.min ? `min ${formatDays(b.min)}` : ""}
                    {b.min && b.max !== null ? " · " : ""}
                    {b.max !== null ? `max ${formatDays(b.max)}` : ""}
                    {!b.min && b.max === null ? "—" : ""}
                  </Td>
                  <Td className="tabular text-right font-medium text-accent">{formatDays(b.encashable)}</Td>
                  <Td className="text-right">
                    <EncashButton balanceId={b.balanceId} employee={b.employeeName} type={b.leaveTypeName} available={b.available} min={b.min} max={b.max} encashable={b.encashable} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
        <OffsetPagination page={page} params={params} label="balances" sizes={[25, 50, 100]} />
      </Card>

      <Card>
        <CardHeader title="Encashment register" description={`Every encashment and reversal in ${fy.code}, newest first`} />
        {history.length === 0 ? (
          <EmptyState title="Nothing encashed this year." />
        ) : (
          <TableShell className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Employee</Th>
                <Th>Leave</Th>
                <Th className="text-right">Days</Th>
                <Th>Note</Th>
                <Th>By</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {hist.map((h) => (
                <Tr key={h.a.id} className={h.a.reversedAt ? "opacity-60" : undefined}>
                  <Td className="font-mono text-xs">
                    {h.a.reference}
                    {h.a.kind === "encashment_reversal" ? <Badge tone="danger" className="ml-2">Reversal</Badge> : null}
                    {h.a.reversedAt ? <Badge tone="neutral" className="ml-2">Reversed</Badge> : null}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {h.employeeName} <span className="font-mono text-[11px] text-ink-faint">{h.employeeCode}</span>
                  </Td>
                  <Td>
                    <span className="flex items-center gap-1.5 text-ink-soft">
                      <span className="size-2 rounded-full" style={{ background: h.colour }} aria-hidden />
                      {h.typeName}
                    </span>
                  </Td>
                  <Td className={`tabular text-right font-medium ${Number(h.a.days) < 0 ? "text-warn" : "text-ok"}`}>{formatDays(Math.abs(Number(h.a.days)))}</Td>
                  <Td className="max-w-64 truncate text-xs text-ink-soft" title={h.a.reason ?? undefined}>
                    {h.a.reason ?? "—"}
                  </Td>
                  <Td className="text-xs text-ink-faint">
                    {h.a.byLabel}
                    <span className="block">{npt(h.a.createdAt)}</span>
                  </Td>
                  <Td className="text-right">{h.a.kind === "encashment" && !h.a.reversedAt ? <ReverseButton id={h.a.id} reference={h.a.reference ?? ""} /> : null}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
        <OffsetPagination page={histPage} params={params} param="hpage" label="entries" />
      </Card>
    </>
  );
}
