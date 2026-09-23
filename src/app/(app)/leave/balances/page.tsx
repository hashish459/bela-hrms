import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { CalendarClock, HandCoins, Search } from "lucide-react";
import { db } from "@/db/client";
import { employees, onStrength } from "@/db/schema/hr";
import { departments } from "@/db/schema/org";
import { leaveBalances, leaveTypes } from "@/db/schema/leave";
import { requirePermission } from "@/lib/session";
import { formatDays } from "@/lib/utils";
import { pageOf } from "@/lib/pagination";
import { OffsetPagination } from "@/components/pagination";
import { ButtonLink, Card, EmptyState, Input, MeterBar, PageHeader, Select, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { fiscalYearList, previewAllocation } from "@/modules/leave/admin";
import { AllocateButton, BalanceCell } from "./tools";

export const metadata = { title: "Leave balances" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * Every employee's balance in every tracked leave type, for one fiscal year.
 * A cell opens that balance — its figures, its full history, and an audited
 * adjustment; "Allocate balances" fills whatever the year is missing.
 */
export default async function LeaveBalancesPage({ searchParams }: PageProps<"/leave/balances">) {
  const params = await searchParams;
  const viewer = await requirePermission("leave.balance.manage");
  const years = await fiscalYearList(viewer.orgId);
  const fy = years.find((y) => y.id === one(params.fy)) ?? years.find((y) => y.isCurrent) ?? years[0];

  if (!fy) {
    return (
      <>
        <PageHeader title="Leave balances" />
        <Card>
          <EmptyState title="No fiscal years yet" hint="Create one under Organisation › Fiscal Years — balances belong to a year." />
        </Card>
      </>
    );
  }

  const q = one(params.q)?.trim().toLowerCase() ?? "";
  const dept = one(params.dept) ?? "";

  const [types, rows, depts, plan] = await Promise.all([
    db
      .select({ id: leaveTypes.id, code: leaveTypes.code, name: leaveTypes.name, colour: leaveTypes.colour })
      .from(leaveTypes)
      .where(and(eq(leaveTypes.orgId, viewer.orgId), eq(leaveTypes.deductsBalance, true), eq(leaveTypes.isActive, true)))
      .orderBy(asc(leaveTypes.leaveOrder), asc(leaveTypes.name)),
    db
      .select({
        employeeId: employees.id,
        code: employees.employeeCode,
        name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        departmentId: employees.departmentId,
        department: departments.name,
        balanceId: leaveBalances.id,
        leaveTypeId: leaveBalances.leaveTypeId,
        entitled: leaveBalances.entitled,
        carried: leaveBalances.carriedForward,
        used: leaveBalances.used,
        pending: leaveBalances.pending,
        encashed: leaveBalances.encashed,
      })
      .from(employees)
      .leftJoin(leaveBalances, and(eq(leaveBalances.employeeId, employees.id), eq(leaveBalances.fiscalYearId, fy.id)))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(and(eq(employees.orgId, viewer.orgId), onStrength()))
      .orderBy(asc(employees.employeeCode)),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.orgId, viewer.orgId)).orderBy(asc(departments.name)),
    previewAllocation(viewer.orgId, fy.id, true).catch(() => null),
  ]);

  type Cell = { balanceId: string; entitled: number; used: number; pending: number; encashed: number };
  const byEmployee = new Map<string, { code: string; name: string; departmentId: string | null; department: string | null; cells: Map<string, Cell> }>();
  for (const r of rows) {
    let emp = byEmployee.get(r.employeeId);
    if (!emp) {
      emp = { code: r.code, name: r.name, departmentId: r.departmentId, department: r.department, cells: new Map() };
      byEmployee.set(r.employeeId, emp);
    }
    if (r.leaveTypeId && r.balanceId) {
      emp.cells.set(r.leaveTypeId, {
        balanceId: r.balanceId,
        entitled: Number(r.entitled ?? 0) + Number(r.carried ?? 0),
        used: Number(r.used ?? 0),
        pending: Number(r.pending ?? 0),
        encashed: Number(r.encashed ?? 0),
      });
    }
  }

  const everyone = [...byEmployee.entries()];
  const people = everyone.filter(([, e]) => (!q || `${e.name} ${e.code}`.toLowerCase().includes(q)) && (!dept || e.departmentId === dept));

  const totals = types.map((t) => {
    let entitled = 0;
    let used = 0;
    let pending = 0;
    for (const [, emp] of everyone) {
      const c = emp.cells.get(t.id);
      if (!c) continue;
      entitled += c.entitled;
      used += c.used;
      pending += c.pending;
    }
    return { ...t, entitled, used, pending };
  });
  const grandEntitled = totals.reduce((a, t) => a + t.entitled, 0);
  const grandUsed = totals.reduce((a, t) => a + t.used, 0);
  const grandPending = totals.reduce((a, t) => a + t.pending, 0);
  const missing = plan?.rows.length ?? 0;

  const { items: pagedPeople, page } = pageOf(people, params, { sizes: [25, 50, 100] });

  return (
    <>
      <PageHeader
        title="Leave balances"
        description={`Fiscal year ${fy.code} · available = entitled + carried − used − pending. Click a figure to see its history or adjust it.`}
        action={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/leave/encashment" variant="secondary">
              <HandCoins className="size-4" />
              Encashment
            </ButtonLink>
            <ButtonLink href="/leave/lapse" variant="secondary">
              <CalendarClock className="size-4" />
              Year end
            </ButtonLink>
            <AllocateButton years={years.map((y) => ({ id: y.id, code: y.code, closed: y.isClosed }))} defaultYear={fy.id} missing={missing} />
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Employees" value={everyone.length} tone="accent" />
        <StatTile label="Days entitled" value={formatDays(grandEntitled)} sub="including carried forward" />
        <StatTile label="Days taken" value={formatDays(grandUsed)} sub={`${grandEntitled > 0 ? Math.round((grandUsed / grandEntitled) * 100) : 0}% of entitlement`} />
        <StatTile label="Days reserved" value={formatDays(grandPending)} tone={grandPending > 0 ? "warn" : "neutral"} sub="Awaiting approval" />
        <StatTile label="Not allocated" value={missing} tone={missing ? "danger" : "ok"} sub={missing ? "balances missing this year" : "everyone is set up"} />
      </div>

      <Card className="mt-4">
        <div className="border-b border-line-soft px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Utilisation by leave type</h2>
          <div className="mt-3 flex flex-col gap-2">
            {totals.map((t) => (
              <div key={t.id} className="grid grid-cols-[9rem_1fr_7rem] items-center gap-3">
                <span className="flex items-center gap-1.5 truncate text-xs text-ink-soft">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: t.colour }} aria-hidden />
                  {t.name}
                </span>
                <MeterBar used={t.used + t.pending} total={t.entitled} />
                <span className="tabular text-right text-xs text-ink-faint">
                  {formatDays(t.used)} / {formatDays(t.entitled)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <form className="flex flex-wrap items-end gap-2 border-b border-line-soft p-3" role="search">
          <Select name="fy" defaultValue={fy.id} className="w-auto" aria-label="Fiscal year">
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                FY {y.code}
                {y.isCurrent ? " (current)" : y.isClosed ? " (closed)" : ""}
              </option>
            ))}
          </Select>
          <label className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Find an employee" className="pl-8" aria-label="Find an employee" />
          </label>
          <Select name="dept" defaultValue={dept} className="w-auto" aria-label="Department">
            <option value="">All departments</option>
            {depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <button type="submit" className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover">
            Show
          </button>
        </form>

        {people.length === 0 ? (
          <EmptyState title="Nobody matches." />
        ) : (
          <TableShell className="rounded-none border-0">
            <thead>
              <tr>
                <Th className="sticky left-0 z-10">Employee</Th>
                <Th>Department</Th>
                {types.map((t) => (
                  <Th key={t.id} className="text-right" title={t.name}>
                    <span className="inline-flex items-center gap-1">
                      <span className="size-1.5 rounded-full" style={{ background: t.colour }} aria-hidden />
                      {t.code}
                    </span>
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedPeople.map(([id, emp]) => (
                <Tr key={id}>
                  <Td className="sticky left-0 z-10 bg-surface whitespace-nowrap">
                    <Link href={`/hr/employees/${id}`} className="font-medium text-ink hover:text-accent">
                      {emp.name}
                    </Link>
                    <span className="ml-1.5 font-mono text-[11px] text-ink-faint">{emp.code}</span>
                  </Td>
                  <Td className="text-ink-soft">{emp.department ?? "—"}</Td>
                  {types.map((t) => {
                    const c = emp.cells.get(t.id);
                    if (!c) {
                      return (
                        <Td key={t.id} className="text-right text-[11px] text-ink-faint" title="Not allocated — use Allocate balances">
                          —
                        </Td>
                      );
                    }
                    return (
                      <Td key={t.id} className="py-1 text-right">
                        <BalanceCell balanceId={c.balanceId} available={c.entitled - c.used - c.pending} total={c.entitled} label={`${emp.name}, ${t.name}`} />
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
        <OffsetPagination page={page} params={params} label="employees" sizes={[25, 50, 100]} />
      </Card>
    </>
  );
}
