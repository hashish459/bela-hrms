import { pageOf } from "@/lib/pagination";
import { OffsetPagination } from "@/components/pagination";
import Link from "next/link";
import { Download, Hourglass, TimerReset, Wallet } from "lucide-react";
import { can, requirePermission } from "@/lib/session";
import { adToBs, BS_MONTHS, formatBs, formatBsKey, todayInNepal } from "@/lib/bs";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/avatar";
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { bsMonthBounds, BsMonthNav } from "@/components/bs-month-nav";
import {
  approvalQueue,
  CLAIM_WINDOW_DAYS,
  DAY_KIND_LABEL,
  eligibleDays,
  myClaims,
  register,
  rulesFor,
  type ClaimRow,
  type DayKind,
} from "@/lib/attendance/overtime";
import { hm } from "./format";
import { ClaimButton, DecideClaim, RuleForm, WithdrawClaim } from "./panels";

export const metadata = { title: "Overtime" };

type Tab = "mine" | "approvals" | "register" | "rules";

const STATUS_TONE = { pending: "warn", approved: "ok", rejected: "danger", withdrawn: "neutral" } as const;
const KIND_TONE: Record<DayKind, "neutral" | "info" | "danger"> = { working_day: "neutral", weekly_off: "info", public_holiday: "danger" };

/**
 * Overtime: claims against the minutes attendance computes, their approval,
 * the monthly register and the rate rules — each tab shown only to somebody
 * who can use it.
 */
export default async function OvertimePage({ searchParams }: PageProps<"/attendance/overtime">) {
  const viewer = await requirePermission("attendance.request.create");
  const params = await searchParams;
  const today = todayInNepal();

  const canApprove = can(viewer, "attendance.request.approve");
  const seesAll = can(viewer, "attendance.record.viewAll");
  const canRules = can(viewer, "attendance.shift.manage");

  const tabs: { key: Tab; label: string }[] = [
    ...(viewer.employeeId ? [{ key: "mine" as const, label: "My overtime" }] : []),
    ...(canApprove ? [{ key: "approvals" as const, label: "Approvals" }] : []),
    ...(seesAll ? [{ key: "register" as const, label: "Register" }] : []),
    ...(canRules ? [{ key: "rules" as const, label: "Rates & rules" }] : []),
  ];
  const tab: Tab = tabs.find((t) => t.key === params.tab)?.key ?? tabs[0]?.key ?? "mine";

  const decider = { userId: viewer.userId, label: viewer.name, employeeId: viewer.employeeId, seesAll };
  const queue = canApprove ? await approvalQueue(viewer.orgId, decider) : [];

  return (
    <>
      <PageHeader
        title="Overtime"
        description="Claims against the overtime your attendance already records, approved by your supervisor and paid at the rate for the kind of day."
      />

      <nav className="mb-4 flex gap-1 border-b border-line" aria-label="Overtime sections">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/attendance/overtime?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px]",
              tab === t.key ? "border-accent font-medium text-accent" : "border-transparent text-ink-soft hover:text-ink",
            )}
          >
            {t.label}
            {t.key === "approvals" && queue.length ? (
              <span className="tabular rounded-full bg-warn-soft px-1.5 text-[10px] font-semibold text-warn">{queue.length}</span>
            ) : null}
          </Link>
        ))}
      </nav>

      {tab === "mine" && viewer.employeeId ? <Mine orgId={viewer.orgId} employeeId={viewer.employeeId} today={today} params={params} /> : null}
      {tab === "approvals" && canApprove ? <Approvals rows={queue} seesAll={seesAll} params={params} /> : null}
      {tab === "register" && seesAll ? <Register orgId={viewer.orgId} y={params.y} m={params.m} status={params.status} params={params} /> : null}
      {tab === "rules" && canRules ? <Rules orgId={viewer.orgId} /> : null}
    </>
  );
}

const bsLabel = (iso: string) => formatBs(adToBs(iso));

async function Mine({ orgId, employeeId, today, params }: { orgId: string; employeeId: string; today: string; params: Params }) {
  const [eligible, claims] = await Promise.all([eligibleDays(orgId, employeeId, today), myClaims(orgId, employeeId)]);
  const month = adToBs(today);
  const inMonth = claims.filter((c) => {
    const b = adToBs(c.date);
    return b.year === month.year && b.month === month.month;
  });
  const approved = inMonth.filter((c) => c.status === "approved");
  const approvedMinutes = approved.reduce((s, c) => s + (c.approvedMinutes ?? 0), 0);
  const payable = approved.reduce((s, c) => s + (c.payableMinutes ?? 0), 0);
  const pendingMinutes = claims.filter((c) => c.status === "pending").reduce((s, c) => s + c.claimedMinutes, 0);
  const unclaimed = eligible.reduce((s, d) => s + d.claimableMinutes, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={`Approved in ${BS_MONTHS[month.month - 1]}`} value={hm(approvedMinutes)} sub={`${approved.length} claim(s)`} tone="ok" />
        <StatTile label="Payable this month" value={hm(payable)} sub="after the day rate" tone="accent" />
        <StatTile label="Awaiting approval" value={hm(pendingMinutes)} tone={pendingMinutes ? "warn" : "neutral"} />
        <StatTile label="Not yet claimed" value={hm(unclaimed)} sub={`last ${CLAIM_WINDOW_DAYS} days`} tone={unclaimed ? "info" : "neutral"} />
      </div>

      <Card>
        <CardHeader
          title="Days you can claim"
          description={`Overtime on your attendance in the last ${CLAIM_WINDOW_DAYS} days that is not claimed yet.`}
        />
        {eligible.length === 0 ? (
          <EmptyState title="Nothing to claim" hint="Overtime shows up here once your punches record time beyond your shift." />
        ) : (
          <ul className="divide-y divide-line-soft">
            {eligible.map((d) => (
              <li key={d.date} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                  <TimerReset className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{bsLabel(d.date)}</p>
                  <p className="text-xs text-ink-faint">
                    <Badge tone={KIND_TONE[d.kind]}>{DAY_KIND_LABEL[d.kind]}</Badge>
                    <span className="ml-2 tabular">
                      {hm(d.computedMinutes)} on record
                      {d.claimableMinutes < d.computedMinutes ? ` · capped at ${hm(d.claimableMinutes)}` : ""} · {d.multiplier}×
                    </span>
                  </p>
                </div>
                <ClaimButton
                  date={d.date}
                  dateBs={d.dateBs}
                  kindLabel={DAY_KIND_LABEL[d.kind]}
                  computedMinutes={d.computedMinutes}
                  claimableMinutes={d.claimableMinutes}
                  multiplier={d.multiplier}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="My claims" description="Newest first" />
        <ClaimTable rows={claims} showEmployee={false} withdraw params={params} />
      </Card>
    </div>
  );
}

function ClaimTable({ rows: all, showEmployee, withdraw = false, params }: { rows: ClaimRow[]; showEmployee: boolean; withdraw?: boolean; params: Params }) {
  if (all.length === 0) return <EmptyState title="No claims yet" />;
  const { items: rows, page } = pageOf(all, params, { sizes: [25, 50, 100] });
  return (
    <>
    <TableShell className="rounded-none border-0">
      <thead>
        <tr>
          <Th>Reference</Th>
          {showEmployee ? <Th>Employee</Th> : null}
          <Th>Day (BS)</Th>
          <Th>Kind</Th>
          <Th className="text-right">Claimed</Th>
          <Th className="text-right">Approved</Th>
          <Th className="text-right">Payable</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <Tr key={c.id}>
            <Td className="font-mono text-xs text-ink-soft">{c.reference}</Td>
            {showEmployee ? (
              <Td>
                <span className="block text-sm font-medium text-ink">{c.employeeName}</span>
                <span className="block text-[11px] text-ink-faint">
                  {c.employeeCode}
                  {c.department ? ` · ${c.department}` : ""}
                </span>
              </Td>
            ) : null}
            <Td className="tabular">{c.dateBs}</Td>
            <Td>
              <Badge tone={KIND_TONE[c.dayKind]}>{DAY_KIND_LABEL[c.dayKind]}</Badge>
            </Td>
            <Td className="tabular text-right">{hm(c.claimedMinutes)}</Td>
            <Td className="tabular text-right">{c.approvedMinutes !== null ? hm(c.approvedMinutes) : "—"}</Td>
            <Td className="tabular text-right font-medium">
              {c.payableMinutes !== null ? hm(c.payableMinutes) : "—"}
              <span className="block text-[10px] font-normal text-ink-faint">{Number(c.multiplier)}×</span>
            </Td>
            <Td>
              <div className="flex flex-col items-start gap-0.5">
                <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                {c.decisionNote ? <span className="max-w-48 truncate text-[10px] text-ink-faint" title={c.decisionNote}>{c.decisionNote}</span> : null}
                {withdraw && c.status === "pending" ? <WithdrawClaim id={c.id} /> : null}
              </div>
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
    <OffsetPagination page={page} params={params} label="claims" sizes={[25, 50, 100]} />
    </>
  );
}

function Approvals({ rows: all, seesAll, params }: { rows: ClaimRow[]; seesAll: boolean; params: Params }) {
  const { items: rows, page } = pageOf(all, params, { sizes: [12, 24, 48] });
  if (all.length === 0) {
    return (
      <Card>
        <EmptyState title="Nothing waiting" hint={seesAll ? "Every overtime claim in the organisation is decided." : "Claims from people who report to you appear here."} />
      </Card>
    );
  }
  return (
    <>
    <div className="grid gap-3 lg:grid-cols-2">
      {rows.map((c) => (
        <Card key={c.id} className="flex flex-col">
          <div className="flex items-start gap-3 border-b border-line-soft px-4 py-3">
            <Avatar
              photoId={c.photoFileId}
              firstName={c.employeeName.split(" ")[0] ?? "?"}
              lastName={c.employeeName.split(" ").slice(-1)[0] ?? ""}
              seed={c.employeeId}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{c.employeeName}</p>
              <p className="text-[11px] text-ink-faint">
                {c.employeeCode}
                {c.department ? ` · ${c.department}` : ""} · <span className="font-mono">{c.reference}</span>
              </p>
            </div>
            <Badge tone={KIND_TONE[c.dayKind]}>{DAY_KIND_LABEL[c.dayKind]}</Badge>
          </div>
          <div className="grid grid-cols-3 gap-2 px-4 py-3 text-center">
            <div>
              <p className="text-[10px] tracking-wide text-ink-faint uppercase">Day</p>
              <p className="tabular text-sm text-ink">{c.dateBs}</p>
            </div>
            <div>
              <p className="text-[10px] tracking-wide text-ink-faint uppercase">Claimed / on record</p>
              <p className="tabular text-sm text-ink">
                {hm(c.claimedMinutes)} <span className="text-ink-faint">/ {hm(c.computedMinutes)}</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] tracking-wide text-ink-faint uppercase">Payable at {Number(c.multiplier)}×</p>
              <p className="tabular text-sm font-semibold text-accent">{hm(Math.round(c.claimedMinutes * Number(c.multiplier)))}</p>
            </div>
          </div>
          <p className="px-4 pb-3 text-sm text-ink-soft">“{c.reason}”</p>
          <div className="mt-auto border-t border-line-soft px-4 py-3">
            <DecideClaim id={c.id} claimedMinutes={c.claimedMinutes} />
          </div>
        </Card>
      ))}
    </div>
    <OffsetPagination page={page} params={params} label="claims" sizes={[12, 24, 48]} className="mt-3 rounded-md border border-line bg-surface" />
    </>
  );
}

type Param = string | string[] | undefined;
type Params = Record<string, Param>;

async function Register({ orgId, y: yParam, m: mParam, status, params }: { orgId: string; y: Param; m: Param; status: Param; params: Params }) {
  const today = adToBs(todayInNepal());
  const y = Number(typeof yParam === "string" ? yParam : NaN);
  const m = Number(typeof mParam === "string" ? mParam : NaN);
  const current = y >= 2000 && y <= 2100 && m >= 1 && m <= 12 ? { year: y, month: m } : { year: today.year, month: today.month };
  const { from, to } = bsMonthBounds(current);
  const st = typeof status === "string" && ["pending", "approved", "rejected", "withdrawn"].includes(status) ? status : null;
  const rows = await register(orgId, from, to, st);

  const byEmployee = new Map<string, { name: string; code: string; dept: string | null; claims: number; approved: number; payable: number; pending: number }>();
  for (const r of rows) {
    const e = byEmployee.get(r.employeeId) ?? { name: r.employeeName, code: r.employeeCode, dept: r.department, claims: 0, approved: 0, payable: 0, pending: 0 };
    e.claims++;
    if (r.status === "approved") {
      e.approved += r.approvedMinutes ?? 0;
      e.payable += r.payableMinutes ?? 0;
    }
    if (r.status === "pending") e.pending += r.claimedMinutes;
    byEmployee.set(r.employeeId, e);
  }
  const people = [...byEmployee.values()].sort((a, b) => b.payable - a.payable);
  const totalApproved = people.reduce((s, p) => s + p.approved, 0);
  const totalPayable = people.reduce((s, p) => s + p.payable, 0);
  const monthKey = `${current.year}-${String(current.month).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BsMonthNav current={current} basePath="/attendance/overtime" extraParams={{ tab: "register", status: st ?? undefined }} />
        <a
          href={`/attendance/overtime/export?month=${monthKey}${st ? `&status=${st}` : ""}`}
          className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-sm text-ink-soft hover:bg-sunk hover:text-ink"
        >
          <Download className="size-4" />
          Export CSV
        </a>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Claims" value={rows.length} />
        <StatTile label="Approved time" value={hm(totalApproved)} tone="ok" />
        <StatTile label="Payable time" value={hm(totalPayable)} sub="approved × day rate" tone="accent" />
        <StatTile label="People" value={people.length} sub="with a claim this month" />
      </div>

      <Card>
        <CardHeader title="By employee" description="What payroll pays for this month" action={<Wallet className="size-4 text-ink-faint" />} />
        {people.length === 0 ? (
          <EmptyState title="No overtime claimed this month" />
        ) : (
          <TableShell className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th className="text-right">Claims</Th>
                <Th className="text-right">Approved</Th>
                <Th className="text-right">Payable</Th>
                <Th className="text-right">Pending</Th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <Tr key={p.code}>
                  <Td>
                    <span className="block font-medium text-ink">{p.name}</span>
                    <span className="block text-[11px] text-ink-faint">
                      {p.code}
                      {p.dept ? ` · ${p.dept}` : ""}
                    </span>
                  </Td>
                  <Td className="tabular text-right">{p.claims}</Td>
                  <Td className="tabular text-right">{hm(p.approved)}</Td>
                  <Td className="tabular text-right font-semibold">{hm(p.payable)}</Td>
                  <Td className="tabular text-right text-warn">
                    {p.pending ? (
                      <span className="inline-flex items-center gap-1">
                        <Hourglass className="size-3" /> {hm(p.pending)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>

      <Card>
        <CardHeader title="Every claim" description={`${formatBsKey({ ...current, day: 1 }).slice(0, 7)} · ${st ?? "all statuses"}`} />
        <ClaimTable rows={rows} showEmployee params={params} />
      </Card>
    </div>
  );
}

async function Rules({ orgId }: { orgId: string }) {
  const rules = await rulesFor(orgId);
  return (
    <Card>
      <CardHeader
        title="Rates and rules"
        description="The pay multiplier, the least time that counts as overtime and the most a single day can carry. A claim takes the rate in force when it is made."
      />
      <ul className="divide-y divide-line-soft">
        {(Object.keys(DAY_KIND_LABEL) as DayKind[]).map((k) => (
          <li key={k} className="flex flex-wrap items-center gap-4 px-4 py-4">
            <div className="w-44">
              <p className="text-sm font-medium text-ink">{DAY_KIND_LABEL[k]}</p>
              <p className="text-[11px] text-ink-faint">{rules[k].custom ? "Set by your organisation" : "Default"}</p>
            </div>
            <RuleForm dayKind={k} multiplier={rules[k].multiplier} minMinutes={rules[k].minMinutes} maxMinutes={rules[k].maxMinutes} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
