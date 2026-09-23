import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { approvalSteps, leaveBalances, leaveRequests, leaveTypes } from "@/db/schema/leave";
import { CalendarCheck2, CalendarClock, Hourglass, Palmtree } from "lucide-react";
import { requirePermission } from "@/lib/session";
import { LEAVE_ENTITY } from "@/lib/leave";
import { adToBs, formatBs, todayInNepal } from "@/lib/bs";
import { formatDays } from "@/lib/utils";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { ApplyForm } from "./apply-form";
import { BalanceRing } from "./balance-ring";
import { RequestList } from "./request-list";

export const metadata = { title: "My leave" };

export default async function MyLeavePage() {
  const viewer = await requirePermission("leave.request.viewOwn");

  if (!viewer.employeeId) {
    return (
      <>
        <PageHeader title="My leave" />
        <Card>
          <EmptyState
            title="This login is not linked to an employee record"
            hint="An administrator can link it from Administration › Users."
          />
        </Card>
      </>
    );
  }

  const [balances, requests, colleagues] = await Promise.all([
    db
      .select({
        id: leaveBalances.id,
        typeId: leaveTypes.id,
        type: leaveTypes.name,
        colour: leaveTypes.colour,
        deducts: leaveTypes.deductsBalance,
        entitled: leaveBalances.entitled,
        carried: leaveBalances.carriedForward,
        used: leaveBalances.used,
        pending: leaveBalances.pending,
      })
      .from(leaveBalances)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
      .where(
        and(
          eq(leaveBalances.employeeId, viewer.employeeId),
          viewer.fiscalYear ? eq(leaveBalances.fiscalYearId, viewer.fiscalYear.id) : undefined,
        ),
      )
      .orderBy(leaveTypes.name),

    db
      .select({
        id: leaveRequests.id,
        reference: leaveRequests.reference,
        type: leaveTypes.name,
        colour: leaveTypes.colour,
        fromDateBs: leaveRequests.fromDateBs,
        toDateBs: leaveRequests.toDateBs,
        totalDays: leaveRequests.totalDays,
        status: leaveRequests.status,
        reason: leaveRequests.reason,
        currentLevel: leaveRequests.currentLevel,
        fromDate: leaveRequests.fromDate,
        toDate: leaveRequests.toDate,
        portion: leaveRequests.portion,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(eq(leaveRequests.employeeId, viewer.employeeId))
      .orderBy(desc(leaveRequests.createdAt))
      .limit(20),

    db
      .select({
        id: employees.id,
        name: employees.firstName,
        last: employees.lastName,
        code: employees.employeeCode,
      })
      .from(employees)
      .where(and(eq(employees.orgId, viewer.orgId), isNull(employees.deletedAt)))
      .orderBy(employees.employeeCode),
  ]);

  // who is sitting on each pending request
  const pendingIds = requests.filter((r) => r.status === "pending").map((r) => r.id);
  const waitingOn = new Map<string, string>();
  if (pendingIds.length) {
    const steps = await db
      .select({
        entityId: approvalSteps.entityId,
        level: approvalSteps.level,
        label: approvalSteps.approverLabel,
        approverFirst: employees.firstName,
        approverLast: employees.lastName,
      })
      .from(approvalSteps)
      .leftJoin(employees, eq(employees.id, approvalSteps.approverEmployeeId))
      .where(
        and(eq(approvalSteps.entityType, LEAVE_ENTITY), eq(approvalSteps.decision, "pending")),
      );
    for (const s of steps) {
      if (!waitingOn.has(s.entityId)) {
        waitingOn.set(
          s.entityId,
          s.approverFirst ? `${s.approverFirst} ${s.approverLast}` : (s.label ?? "Unassigned"),
        );
      }
    }
  }

  const deductible = balances.filter((b) => b.deducts);
  const today = todayInNepal();

  const totals = deductible.reduce(
    (t, b) => {
      const entitled = Number(b.entitled) + Number(b.carried);
      t.entitled += entitled;
      t.used += Number(b.used);
      t.pending += Number(b.pending);
      t.available += entitled - Number(b.used) - Number(b.pending);
      return t;
    },
    { entitled: 0, used: 0, pending: 0, available: 0 },
  );
  const pendingRequests = requests.filter((r) => r.status === "pending").length;
  const next = requests
    .filter((r) => r.status === "approved" && r.toDate >= today)
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate))[0];

  return (
    <>
      <PageHeader
        title="My leave"
        description={
          viewer.fiscalYear
            ? `Fiscal year ${viewer.fiscalYear.code} · today is ${formatBs(adToBs(today))}`
            : "No fiscal year is current"
        }
      />

      {/* ------------------------------------------------------------ summary */}
      <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Leave at a glance">
        <SummaryTile
          icon={Palmtree}
          label="Days available"
          value={formatDays(Math.max(0, totals.available))}
          sub={`of ${formatDays(totals.entitled)} entitled this year`}
          tone="accent"
        />
        <SummaryTile icon={CalendarCheck2} label="Days taken" value={formatDays(totals.used)} sub="approved and consumed" tone="ok" />
        <SummaryTile
          icon={Hourglass}
          label="Awaiting approval"
          value={String(pendingRequests)}
          sub={totals.pending > 0 ? `${formatDays(totals.pending)} day(s) on hold` : "Nothing waiting"}
          tone={pendingRequests ? "warn" : "neutral"}
        />
        <SummaryTile
          icon={CalendarClock}
          label="Next leave"
          value={next ? next.fromDateBs : "—"}
          sub={next ? `${next.type} · ${formatDays(next.totalDays)} day(s)` : "Nothing booked"}
          tone="info"
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* ----------------------------------------------------------- balances */}
        <Card>
          <CardHeader title="Balances" description="Available = entitled + carried − used − pending" />
          {deductible.length === 0 ? (
            <EmptyState title="No balances allocated yet" hint="HR allocates balances at the start of each fiscal year." />
          ) : (
            <ul className="grid gap-px bg-line-soft sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {deductible.map((b) => {
                const entitled = Number(b.entitled) + Number(b.carried);
                const used = Number(b.used);
                const pending = Number(b.pending);
                const available = entitled - used - pending;
                return (
                  <li key={b.id} className="flex items-center gap-4 bg-surface px-4 py-3.5">
                    <div className="relative">
                      <BalanceRing available={Math.max(0, available)} pending={pending} entitled={entitled} colour={b.colour} />
                      <span className="absolute inset-0 grid place-items-center text-center">
                        <span>
                          <span className="tabular block text-base leading-none font-semibold text-ink">{formatDays(Math.max(0, available))}</span>
                          <span className="block text-[9px] tracking-wide text-ink-faint uppercase">left</span>
                        </span>
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: b.colour }} aria-hidden />
                        {b.type}
                      </p>
                      <p className="tabular mt-0.5 text-xs text-ink-soft">of {formatDays(entitled)} day(s)</p>
                      <p className="tabular mt-1.5 flex flex-wrap gap-1 text-[10px]">
                        <span className="rounded bg-sunk px-1.5 py-0.5 text-ink-soft">used {formatDays(used)}</span>
                        {pending > 0 ? <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn">pending {formatDays(pending)}</span> : null}
                        {Number(b.carried) > 0 ? (
                          <span className="rounded bg-info-soft px-1.5 py-0.5 text-info">carried {formatDays(b.carried)}</span>
                        ) : null}
                        {available <= 0 ? <span className="rounded bg-danger-soft px-1.5 py-0.5 text-danger">exhausted</span> : null}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* -------------------------------------------------------------- apply */}
        <ApplyForm
          leaveTypes={balances.map((b) => ({
            id: b.typeId,
            name: b.type,
            colour: b.colour,
            available: b.deducts
              ? Number(b.entitled) + Number(b.carried) - Number(b.used) - Number(b.pending)
              : null,
          }))}
          colleagues={colleagues
            .filter((c) => c.id !== viewer.employeeId)
            .map((c) => ({ id: c.id, name: `${c.name} ${c.last} (${c.code})` }))}
        />
      </div>

      {/* ------------------------------------------------------------ history */}
      <Card className="mt-4">
        <CardHeader title="My requests" description="Your twenty most recent requests, newest first" />
        <RequestList
          items={requests.map((r) => ({
            id: r.id,
            reference: r.reference,
            type: r.type,
            colour: r.colour,
            fromDateBs: r.fromDateBs,
            toDateBs: r.toDateBs,
            totalDays: String(r.totalDays),
            status: r.status,
            reason: r.reason,
            portion: r.portion,
            waitingOn: waitingOn.get(r.id) ?? null,
            upcoming: r.fromDate > today,
          }))}
        />
      </Card>
    </>
  );
}

const TONE = {
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  info: "bg-info-soft text-info",
  neutral: "bg-sunk text-ink-soft",
} as const;

function SummaryTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Palmtree;
  label: string;
  value: string;
  sub: string;
  tone: keyof typeof TONE;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <span className={`grid size-10 shrink-0 place-items-center rounded-full ${TONE[tone]}`}>
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-ink-faint">{label}</p>
        <p className="tabular text-xl leading-tight font-semibold text-ink">{value}</p>
        <p className="truncate text-[11px] text-ink-faint">{sub}</p>
      </div>
    </div>
  );
}
