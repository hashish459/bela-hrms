import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { approvalSteps, leaveBalances, leaveRequests, leaveTypes } from "@/db/schema/leave";
import { requirePermission } from "@/lib/session";
import { LEAVE_ENTITY } from "@/lib/leave";
import { formatDays } from "@/lib/utils";
import {
  Card,
  CardHeader,
  EmptyState,
  MeterBar,
  PageHeader,
  StatusBadge,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { ApplyForm } from "./apply-form";
import { WithdrawButton } from "./withdraw-button";

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
      .where(eq(employees.orgId, viewer.orgId))
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

  return (
    <>
      <PageHeader
        title="My leave"
        description={
          viewer.fiscalYear
            ? `Balances for fiscal year ${viewer.fiscalYear.code}`
            : "No fiscal year is current"
        }
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Balances" description="Available = entitled + carried − used − pending" />
            {deductible.length === 0 ? (
              <EmptyState title="No balances allocated yet" />
            ) : (
              <ul className="divide-y divide-line-soft">
                {deductible.map((b) => {
                  const entitled = Number(b.entitled) + Number(b.carried);
                  const used = Number(b.used);
                  const pending = Number(b.pending);
                  const available = entitled - used - pending;
                  return (
                    <li key={b.id} className="px-4 py-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-sm text-ink">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: b.colour }}
                            aria-hidden
                          />
                          {b.type}
                        </span>
                        <span className="tabular text-sm font-semibold text-ink">
                          {formatDays(available)}
                          <span className="text-xs font-normal text-ink-faint">
                            {" "}
                            / {formatDays(entitled)}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <MeterBar
                          used={used + pending}
                          total={entitled}
                          tone={available <= 0 ? "danger" : pending > 0 ? "warn" : "accent"}
                        />
                      </div>
                      <p className="tabular mt-1 flex gap-3 text-[11px] text-ink-faint">
                        <span>used {formatDays(used)}</span>
                        {pending > 0 ? <span className="text-warn">pending {formatDays(pending)}</span> : null}
                        {Number(b.carried) > 0 ? <span>carried {formatDays(b.carried)}</span> : null}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <ApplyForm
          leaveTypes={balances.map((b) => ({
            id: b.typeId,
            name: b.type,
            available: b.deducts
              ? Number(b.entitled) + Number(b.carried) - Number(b.used) - Number(b.pending)
              : null,
          }))}
          colleagues={colleagues
            .filter((c) => c.id !== viewer.employeeId)
            .map((c) => ({ id: c.id, name: `${c.name} ${c.last} (${c.code})` }))}
        />
      </div>

      <Card className="mt-4">
        <CardHeader title="My requests" description="Twenty most recent" />
        {requests.length === 0 ? (
          <EmptyState title="No leave requests yet" hint="Use the form above to apply." />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Reference</Th>
                <Th>Type</Th>
                <Th>From (BS)</Th>
                <Th>To (BS)</Th>
                <Th className="text-right">Days</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-mono text-xs text-ink-soft">{r.reference}</Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: r.colour }}
                        aria-hidden
                      />
                      {r.type}
                    </span>
                  </Td>
                  <Td className="tabular text-ink-soft">{r.fromDateBs}</Td>
                  <Td className="tabular text-ink-soft">{r.toDateBs}</Td>
                  <Td className="tabular text-right">{formatDays(r.totalDays)}</Td>
                  <Td className="max-w-56 truncate text-ink-soft" title={r.reason}>
                    {r.reason}
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-0.5">
                      <StatusBadge value={r.status} />
                      {r.status === "pending" && waitingOn.get(r.id) ? (
                        <span className="text-[11px] text-ink-faint">
                          with {waitingOn.get(r.id)}
                        </span>
                      ) : null}
                    </div>
                  </Td>
                  <Td className="text-right">
                    {r.status === "pending" || r.status === "approved" ? (
                      <WithdrawButton requestId={r.id} reference={r.reference} />
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </>
  );
}
