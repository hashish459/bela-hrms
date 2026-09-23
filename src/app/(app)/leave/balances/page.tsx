import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, onStrength } from "@/db/schema/hr";
import { departments } from "@/db/schema/org";
import { leaveBalances, leaveTypes } from "@/db/schema/leave";
import { requirePermission } from "@/lib/session";
import { formatDays } from "@/lib/utils";
import {
  Card,
  EmptyState,
  MeterBar,
  PageHeader,
  StatTile,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui";

export const metadata = { title: "Leave balances" };

export default async function LeaveBalancesPage() {
  const viewer = await requirePermission("leave.balance.manage");

  if (!viewer.fiscalYear) {
    return (
      <>
        <PageHeader title="Leave balances" />
        <Card>
          <EmptyState
            title="No fiscal year is marked current"
            hint="Set one under Organisation › Fiscal Years — balances are scoped to a year."
          />
        </Card>
      </>
    );
  }

  const [types, rows] = await Promise.all([
    db
      .select({ id: leaveTypes.id, code: leaveTypes.code, name: leaveTypes.name, colour: leaveTypes.colour })
      .from(leaveTypes)
      .where(and(eq(leaveTypes.orgId, viewer.orgId), eq(leaveTypes.deductsBalance, true)))
      .orderBy(asc(leaveTypes.name)),

    db
      .select({
        employeeId: employees.id,
        code: employees.employeeCode,
        name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        department: departments.name,
        leaveTypeId: leaveBalances.leaveTypeId,
        entitled: leaveBalances.entitled,
        carried: leaveBalances.carriedForward,
        used: leaveBalances.used,
        pending: leaveBalances.pending,
      })
      .from(employees)
      .leftJoin(
        leaveBalances,
        and(
          eq(leaveBalances.employeeId, employees.id),
          eq(leaveBalances.fiscalYearId, viewer.fiscalYear.id),
        ),
      )
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(
        and(
          eq(employees.orgId, viewer.orgId),
          onStrength(),
        ),
      )
      .orderBy(asc(employees.employeeCode)),
  ]);

  // pivot: one row per employee, one column per leave type
  type Cell = { entitled: number; used: number; pending: number };
  const byEmployee = new Map<
    string,
    { code: string; name: string; department: string | null; cells: Map<string, Cell> }
  >();

  for (const r of rows) {
    let emp = byEmployee.get(r.employeeId);
    if (!emp) {
      emp = { code: r.code, name: r.name, department: r.department, cells: new Map() };
      byEmployee.set(r.employeeId, emp);
    }
    if (r.leaveTypeId) {
      emp.cells.set(r.leaveTypeId, {
        entitled: Number(r.entitled ?? 0) + Number(r.carried ?? 0),
        used: Number(r.used ?? 0),
        pending: Number(r.pending ?? 0),
      });
    }
  }

  const people = [...byEmployee.entries()];

  const totals = types.map((t) => {
    let entitled = 0;
    let used = 0;
    let pending = 0;
    for (const [, emp] of people) {
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

  return (
    <>
      <PageHeader
        title="Leave balances"
        description={`Fiscal year ${viewer.fiscalYear.code} · available = entitled + carried − used − pending`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Employees" value={people.length} tone="accent" />
        <StatTile label="Days entitled" value={formatDays(grandEntitled)} />
        <StatTile
          label="Days taken"
          value={formatDays(grandUsed)}
          sub={`${grandEntitled > 0 ? Math.round((grandUsed / grandEntitled) * 100) : 0}% of entitlement`}
        />
        <StatTile
          label="Days reserved"
          value={formatDays(grandPending)}
          tone={grandPending > 0 ? "warn" : "neutral"}
          sub="Awaiting approval"
        />
      </div>

      <Card className="mt-4">
        <div className="border-b border-line-soft px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Utilisation by leave type</h2>
          <div className="mt-3 flex flex-col gap-2">
            {totals.map((t) => (
              <div key={t.id} className="grid grid-cols-[9rem_1fr_7rem] items-center gap-3">
                <span className="flex items-center gap-1.5 truncate text-xs text-ink-soft">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: t.colour }}
                    aria-hidden
                  />
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

        <TableShell>
          <thead>
            <tr>
              <Th className="sticky left-0 z-10">Employee</Th>
              <Th>Department</Th>
              {types.map((t) => (
                <Th key={t.id} className="text-right">
                  {t.code}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map(([id, emp]) => (
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
                      <Td key={t.id} className="text-right text-ink-faint">
                        —
                      </Td>
                    );
                  }
                  const available = c.entitled - c.used - c.pending;
                  return (
                    <Td key={t.id} className="text-right">
                      <span
                        className={`tabular text-sm ${
                          available <= 0 ? "text-danger" : "text-ink"
                        }`}
                        title={`entitled ${formatDays(c.entitled)}, used ${formatDays(
                          c.used,
                        )}, pending ${formatDays(c.pending)}`}
                      >
                        {formatDays(available)}
                      </span>
                      <span className="block text-[11px] text-ink-faint">
                        of {formatDays(c.entitled)}
                      </span>
                    </Td>
                  );
                })}
              </Tr>
            ))}
          </tbody>
        </TableShell>
      </Card>
    </>
  );
}
