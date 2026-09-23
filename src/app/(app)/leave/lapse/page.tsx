import Link from "next/link";
import { ArrowRight, CheckCircle2, TriangleAlert } from "lucide-react";
import { requirePermission } from "@/lib/session";
import { formatDays } from "@/lib/utils";
import { pageOf } from "@/lib/pagination";
import { OffsetPagination } from "@/components/pagination";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Select, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { fiscalYearList, LeaveAdminError, previewYearEnd } from "@/modules/leave/admin";
import { RunYearEnd } from "./run-button";

export const metadata = { title: "Lapse & Carry Forward" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * The year-end close for leave: what each balance carries into the next
 * fiscal year and what lapses, previewed in full before anything moves.
 */
export default async function LapsePage({ searchParams }: PageProps<"/leave/lapse">) {
  const viewer = await requirePermission("leave.balance.manage");
  const params = await searchParams;
  const years = await fiscalYearList(viewer.orgId); // newest first
  const current = years.find((y) => y.isCurrent) ?? years[0];
  const toYear = years.find((y) => y.id === one(params.to)) ?? current;
  const fromYear =
    years.find((y) => y.id === one(params.from)) ?? years.find((y) => toYear && y.startDate < toYear.startDate) ?? years[1];

  if (!fromYear || !toYear) {
    return (
      <>
        <PageHeader title="Lapse & Carry Forward" />
        <Card>
          <EmptyState title="Two fiscal years are needed" hint="Create the next fiscal year under Organisation › Fiscal Years first." />
        </Card>
      </>
    );
  }

  let plan: Awaited<ReturnType<typeof previewYearEnd>> | null = null;
  let problem: string | null = null;
  try {
    plan = await previewYearEnd(viewer.orgId, fromYear.id, toYear.id);
  } catch (e) {
    if (e instanceof LeaveAdminError) problem = e.message;
    else throw e;
  }

  const rows = plan?.rows ?? [];
  const open = rows.filter((r) => !r.done);
  const carry = open.reduce((a, r) => a + r.carry, 0);
  const lapse = open.reduce((a, r) => a + r.lapse, 0);
  const pending = open.reduce((a, r) => a + r.pending, 0);
  const { items, page } = pageOf(rows, params, { sizes: [50, 100, 200] });

  return (
    <>
      <PageHeader
        title="Lapse & Carry Forward"
        description="Close a fiscal year's leave: unused days carry into the next year or lapse, by each leave type's rules. Nothing moves until you run it."
      />

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 p-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
            Closing year
            <Select name="from" defaultValue={fromYear.id} className="w-40">
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  FY {y.code}
                </option>
              ))}
            </Select>
          </label>
          <ArrowRight className="mb-2 size-4 text-ink-faint" aria-hidden />
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
            Carry into
            <Select name="to" defaultValue={toYear.id} className="w-40">
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  FY {y.code}
                </option>
              ))}
            </Select>
          </label>
          <button type="submit" className="rounded border border-line px-3 py-1.5 text-sm text-ink-soft hover:bg-sunk hover:text-ink">
            Preview
          </button>
        </form>
        {/* a sibling, never inside the form above: nested forms are dropped by the parser */}
        {plan ? (
          <div className="flex justify-end border-t border-line-soft px-4 py-3">
            <RunYearEnd from={fromYear.id} to={toYear.id} fromCode={fromYear.code} toCode={toYear.code} rows={open.length} carry={carry} lapse={lapse} pending={pending} />
          </div>
        ) : null}
        {problem ? <p className="border-t border-line-soft px-4 py-3 text-sm text-danger">{problem}</p> : null}
      </Card>

      {plan ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile label="Balances to close" value={open.length} sub={`${rows.length - open.length} already done`} tone="accent" />
            <StatTile label="Days carried" value={formatDays(carry)} sub={`into ${toYear.code}`} tone="ok" />
            <StatTile label="Days lapsing" value={formatDays(lapse)} tone={lapse ? "danger" : "neutral"} />
            <StatTile label="Still reserved" value={formatDays(pending)} sub="undecided requests" tone={pending ? "warn" : "neutral"} />
            <StatTile label="Closing year" value={fromYear.code} sub={fromYear.isClosed ? "marked closed" : "still open"} />
          </div>

          {pending ? (
            <p className="mb-4 flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {formatDays(pending)} day(s) in {fromYear.code} are reserved by requests nobody has decided. Reserved days are not carried.{" "}
              <Link href="/leave/approvals" className="underline">
                Open approvals
              </Link>
            </p>
          ) : null}

          <Card>
            <CardHeader title="Balance by balance" description="Available is what is left after taken and reserved days." />
            {rows.length === 0 ? (
              <EmptyState title={`No balances in ${fromYear.code}.`} />
            ) : (
              <TableShell className="rounded-none border-0">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Leave</Th>
                    <Th>Rule</Th>
                    <Th className="text-right">Available</Th>
                    <Th className="text-right">Carries</Th>
                    <Th className="text-right">Lapses</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <Tr key={`${r.employeeId}:${r.leaveTypeId}`} className={r.done ? "opacity-60" : undefined}>
                      <Td className="whitespace-nowrap">
                        <span className="font-medium text-ink">{r.employeeName}</span>
                        <span className="ml-1.5 font-mono text-[11px] text-ink-faint">{r.employeeCode}</span>
                      </Td>
                      <Td>
                        <span className="flex items-center gap-1.5 text-ink-soft">
                          <span className="size-2 rounded-full" style={{ background: r.colour }} aria-hidden />
                          {r.leaveTypeName}
                        </span>
                      </Td>
                      <Td className="text-xs text-ink-faint">{r.rule}</Td>
                      <Td className="tabular text-right">
                        {formatDays(r.available)}
                        {r.pending ? <span className="block text-[10px] text-warn">+{formatDays(r.pending)} reserved</span> : null}
                      </Td>
                      <Td className="tabular text-right font-medium text-ok">{r.carry ? formatDays(r.carry) : "—"}</Td>
                      <Td className="tabular text-right text-danger">{r.lapse ? formatDays(r.lapse) : "—"}</Td>
                      <Td className="text-right">
                        {r.done ? (
                          <Badge tone="ok">
                            <CheckCircle2 className="size-3" aria-hidden /> Done
                          </Badge>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            )}
            <OffsetPagination page={page} params={params} label="balances" sizes={[50, 100, 200]} />
          </Card>
        </>
      ) : null}
    </>
  );
}
