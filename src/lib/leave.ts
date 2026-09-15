import "server-only";

import { and, asc, eq, gte, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { holidays } from "@/db/schema/core";
import { employees } from "@/db/schema/hr";
import { approvalSteps, leaveBalances, leaveRequests, leaveTypes } from "@/db/schema/leave";
import { adToBs, formatBsKey, todayInNepal, workingDaysBetween } from "@/lib/bs";
import { resolveChain } from "@/kernel/approvals";
import { levelsRequired } from "@/modules/leave/policy";
import { publish } from "@/kernel/events";

export const LEAVE_ENTITY = "leave_request";

export class LeaveError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "LeaveError";
  }
}

/** Holiday dates in a window, as a set of ISO strings. */
export async function holidaySet(orgId: string, from: string, to: string): Promise<Set<string>> {
  const rows = await db
    .select({ date: holidays.date })
    .from(holidays)
    .where(and(eq(holidays.orgId, orgId), eq(holidays.isActive, true), gte(holidays.date, from), lte(holidays.date, to)));
  return new Set(rows.map((r) => r.date));
}

/**
 * Chargeable days for a request. Saturdays and holidays are not deducted -
 * Nepal works a six-day week, so only Saturday is a weekly off.
 */
export async function chargeableDays(
  orgId: string,
  fromDate: string,
  toDate: string,
  portion: "full" | "first_half" | "second_half",
): Promise<number> {
  if (toDate < fromDate) throw new LeaveError("The end date is before the start date.", "toDate");
  const days = workingDaysBetween(fromDate, toDate, await holidaySet(orgId, fromDate, toDate));
  if (portion !== "full") {
    if (fromDate !== toDate) {
      throw new LeaveError("A half day can only be taken on a single date.", "portion");
    }
    return days === 0 ? 0 : 0.5;
  }
  return days;
}

/**
 * Resolves who approves, level by level. Walks the supervisor chain: level 1 is
 * the employee's own supervisor, level 2 that person's supervisor, and so on.
 * The chain stops early at the top of the organisation rather than failing.
 */
/**
 * @deprecated Use `resolveChain` from `@/kernel/approvals`. Kept as an alias so
 * existing call sites keep working; the walk itself moved to the kernel, where
 * attendance can reach it without importing leave.
 */
export async function resolveApprovers(
  employeeId: string,
  levels: number,
): Promise<{ level: number; approverEmployeeId: string | null; label: string }[]> {
  return resolveChain(employeeId, levels);
}

export type SubmitInput = {
  orgId: string;
  employeeId: string;
  leaveTypeId: string;
  fiscalYearId: string;
  fromDate: string;
  toDate: string;
  portion: "full" | "first_half" | "second_half";
  reason: string;
  contactDuringLeave?: string | null;
  handoverToEmployeeId?: string | null;
};

/**
 * Creates a leave request and its full approval chain in one transaction, and
 * reserves the days against the balance so two concurrent submissions cannot
 * both pass the balance check.
 */
export async function submitLeaveRequest(input: SubmitInput): Promise<{ id: string; reference: string }> {
  const [type] = await db
    .select()
    .from(leaveTypes)
    .where(and(eq(leaveTypes.id, input.leaveTypeId), eq(leaveTypes.orgId, input.orgId)))
    .limit(1);
  if (!type) throw new LeaveError("That leave type is not available.", "leaveTypeId");
  if (!type.isActive) throw new LeaveError(`${type.name} is no longer available.`, "leaveTypeId");

  const [employee] = await db
    .select({ id: employees.id, gender: employees.gender, status: employees.status })
    .from(employees)
    .where(eq(employees.id, input.employeeId))
    .limit(1);
  if (!employee) throw new LeaveError("Employee record not found.");

  if (type.appliesTo !== "all" && type.appliesTo !== employee.gender) {
    throw new LeaveError(`${type.name} does not apply to this employee.`, "leaveTypeId");
  }

  const days = await chargeableDays(input.orgId, input.fromDate, input.toDate, input.portion);
  if (days <= 0) {
    throw new LeaveError("Those dates are all weekly offs or holidays — nothing to deduct.", "fromDate");
  }

  if (type.maxConsecutiveDays && days > type.maxConsecutiveDays) {
    throw new LeaveError(
      `${type.name} allows at most ${type.maxConsecutiveDays} consecutive days.`,
      "toDate",
    );
  }

  const today = todayInNepal();
  if (type.minNoticeDays > 0) {
    const notice = workingDaysBetween(today, input.fromDate) - 1;
    if (input.fromDate > today && notice < type.minNoticeDays) {
      throw new LeaveError(
        `${type.name} needs ${type.minNoticeDays} days' notice; this gives ${Math.max(0, notice)}.`,
        "fromDate",
      );
    }
  }

  // an employee cannot be on two kinds of leave at once
  const overlap = await db
    .select({ reference: leaveRequests.reference })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, input.employeeId),
        or(eq(leaveRequests.status, "pending"), eq(leaveRequests.status, "approved")),
        lte(leaveRequests.fromDate, input.toDate),
        gte(leaveRequests.toDate, input.fromDate),
      ),
    )
    .limit(1);
  if (overlap.length) {
    throw new LeaveError(`These dates overlap request ${overlap[0].reference}.`, "fromDate");
  }

  // How many levels this length of request needs. A type can cap what each level
  // may sign off — five days for a supervisor, ten for a manager — so a long
  // request is routed higher from the outset rather than being forwarded by hand.
  const levels = levelsRequired(
    {
      approvalLevels: type.approvalLevels,
      levelLimits: [
        type.level1LimitDays,
        type.level2LimitDays,
        type.level3LimitDays,
        type.level4LimitDays,
      ],
    } as Parameters<typeof levelsRequired>[0],
    days,
  );
  const approvers = await resolveApprovers(input.employeeId, levels);

  return db.transaction(async (tx) => {
    if (type.deductsBalance) {
      // reserve first, then verify: the UPDATE takes a row lock, so a second
      // submission blocks here rather than reading a stale balance
      const [balance] = await tx
        .update(leaveBalances)
        .set({ pending: sql`${leaveBalances.pending} + ${String(days)}`, updatedAt: new Date() })
        .where(
          and(
            eq(leaveBalances.employeeId, input.employeeId),
            eq(leaveBalances.leaveTypeId, input.leaveTypeId),
            eq(leaveBalances.fiscalYearId, input.fiscalYearId),
          ),
        )
        .returning();

      if (!balance) {
        throw new LeaveError(
          `No ${type.name} balance is allocated for this fiscal year.`,
          "leaveTypeId",
        );
      }

      const available =
        Number(balance.entitled) +
        Number(balance.carriedForward) -
        Number(balance.used) -
        Number(balance.pending);

      if (available < 0) {
        throw new LeaveError(
          `Only ${(available + days).toFixed(2).replace(/\.00$/, "")} day(s) of ${type.name} remain.`,
          "toDate",
        );
      }
    }

    const year = adToBs(input.fromDate).year;
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(leaveRequests)
      .where(eq(leaveRequests.orgId, input.orgId));
    const reference = `LV-${year}-${String(Number(n) + 1).padStart(4, "0")}`;

    const [request] = await tx
      .insert(leaveRequests)
      .values({
        orgId: input.orgId,
        reference,
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        fiscalYearId: input.fiscalYearId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        fromDateBs: formatBsKey(adToBs(input.fromDate)),
        toDateBs: formatBsKey(adToBs(input.toDate)),
        portion: input.portion,
        totalDays: String(days),
        reason: input.reason,
        contactDuringLeave: input.contactDuringLeave ?? null,
        handoverToEmployeeId: input.handoverToEmployeeId ?? null,
        status: "pending",
        currentLevel: 1,
        submittedAt: new Date(),
      })
      .returning({ id: leaveRequests.id, reference: leaveRequests.reference });

    await tx.insert(approvalSteps).values(
      approvers.map((a) => ({
        orgId: input.orgId,
        entityType: LEAVE_ENTITY,
        entityId: request.id,
        level: a.level,
        approverEmployeeId: a.approverEmployeeId,
        approverLabel: a.label,
        decision: "pending" as const,
      })),
    );

    return request;
  });
}

/**
 * Records one approval decision and advances or closes the request.
 *
 * Approving the last outstanding level moves the days from `pending` to `used`;
 * a rejection releases the reservation. Both happen in the same transaction as
 * the status change, so a balance can never disagree with a request's state.
 */
export async function decideLeaveRequest(opts: {
  orgId: string;
  requestId: string;
  decision: "approved" | "rejected";
  comment?: string | null;
  approverEmployeeId: string | null;
  decidedByUserId: string;
  canApproveAnything: boolean;
}): Promise<{ reference: string; finalStatus: string }> {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.id, opts.requestId), eq(leaveRequests.orgId, opts.orgId)))
      .limit(1);

    if (!request) throw new LeaveError("That request no longer exists.");
    if (request.status !== "pending") {
      throw new LeaveError(`This request is already ${request.status}.`);
    }

    const [step] = await tx
      .select()
      .from(approvalSteps)
      .where(
        and(
          eq(approvalSteps.entityType, LEAVE_ENTITY),
          eq(approvalSteps.entityId, request.id),
          eq(approvalSteps.level, request.currentLevel ?? 1),
        ),
      )
      .limit(1);

    if (!step) throw new LeaveError("No approval step is outstanding for this request.");

    const isNamedApprover =
      opts.approverEmployeeId !== null && step.approverEmployeeId === opts.approverEmployeeId;
    if (!isNamedApprover && !opts.canApproveAnything) {
      throw new LeaveError("This request is waiting on somebody else.");
    }

    await tx
      .update(approvalSteps)
      .set({
        decision: opts.decision,
        comment: opts.comment ?? null,
        decidedByUserId: opts.decidedByUserId,
        decidedAt: new Date(),
      })
      .where(eq(approvalSteps.id, step.id));

    const [type] = await tx
      .select()
      .from(leaveTypes)
      .where(eq(leaveTypes.id, request.leaveTypeId))
      .limit(1);

    const releasePending = async () =>
      tx
        .update(leaveBalances)
        .set({ pending: sql`${leaveBalances.pending} - ${request.totalDays}`, updatedAt: new Date() })
        .where(
          and(
            eq(leaveBalances.employeeId, request.employeeId),
            eq(leaveBalances.leaveTypeId, request.leaveTypeId),
            eq(leaveBalances.fiscalYearId, request.fiscalYearId),
          ),
        );

    if (opts.decision === "rejected") {
      if (type?.deductsBalance) await releasePending();
      // any later levels never get their turn
      await tx
        .update(approvalSteps)
        .set({ decision: "skipped" })
        .where(
          and(
            eq(approvalSteps.entityType, LEAVE_ENTITY),
            eq(approvalSteps.entityId, request.id),
            eq(approvalSteps.decision, "pending"),
          ),
        );
      await tx
        .update(leaveRequests)
        .set({ status: "rejected", currentLevel: null, decidedAt: new Date(), updatedAt: new Date() })
        .where(eq(leaveRequests.id, request.id));

      // Emitted inside the transaction: the event and the rejection commit
      // together, so attendance can never clear days for a rejection that was
      // rolled back.
      await publish(tx, {
        orgId: opts.orgId,
        module: "leave",
        name: "leave.request.rejected",
        payload: { leaveRequestId: request.id, employeeId: request.employeeId },
        dedupeKey: `leave.rejected:${request.id}`,
      });

      return { reference: request.reference, finalStatus: "rejected" };
    }

    const [nextStep] = await tx
      .select({ level: approvalSteps.level })
      .from(approvalSteps)
      .where(
        and(
          eq(approvalSteps.entityType, LEAVE_ENTITY),
          eq(approvalSteps.entityId, request.id),
          eq(approvalSteps.decision, "pending"),
        ),
      )
      .orderBy(asc(approvalSteps.level))
      .limit(1);

    if (nextStep) {
      await tx
        .update(leaveRequests)
        .set({ currentLevel: nextStep.level, updatedAt: new Date() })
        .where(eq(leaveRequests.id, request.id));
      return { reference: request.reference, finalStatus: "pending" };
    }

    if (type?.deductsBalance) {
      await tx
        .update(leaveBalances)
        .set({
          pending: sql`${leaveBalances.pending} - ${request.totalDays}`,
          used: sql`${leaveBalances.used} + ${request.totalDays}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(leaveBalances.employeeId, request.employeeId),
            eq(leaveBalances.leaveTypeId, request.leaveTypeId),
            eq(leaveBalances.fiscalYearId, request.fiscalYearId),
          ),
        );
    }

    await tx
      .update(leaveRequests)
      .set({ status: "approved", currentLevel: null, decidedAt: new Date(), updatedAt: new Date() })
      .where(eq(leaveRequests.id, request.id));

    // Attendance marks the days off the back of this. It is published rather
    // than called so that an attendance fault delays the marking instead of
    // rolling back an approval the approver has already been shown.
    await publish(tx, {
      orgId: opts.orgId,
      module: "leave",
      name: "leave.request.approved",
      // The span, not the day list. Which days actually get marked is
      // attendance's decision, made against the calendar — leave does not know
      // and should not know how attendance models a day.
      payload: {
        leaveRequestId: request.id,
        employeeId: request.employeeId,
        fromDate: request.fromDate,
        toDate: request.toDate,
        leaveTypeName: type?.name ?? "Leave",
        isHalfDay: request.portion !== "full",
        /**
         * The nature and pay percentage travel with the event so attendance and
         * payroll never have to read a leave table to interpret it. Field work
         * becomes a present day; unpaid leave becomes an unpaid absence — and
         * both are decided by the consumer, from this one word.
         */
        nature: type?.nature ?? "paid",
        paidPercent: Number(type?.paidPercent ?? 100),
        excludesHolidays: type?.excludesHolidays ?? true,
        excludesWeeklyOffs: type?.excludesWeeklyOffs ?? true,
      },
      dedupeKey: `leave.approved:${request.id}`,
    });

    return { reference: request.reference, finalStatus: "approved" };
  });
}

/** Withdraws a request the employee raised, releasing whatever it reserved. */
export async function cancelLeaveRequest(opts: {
  orgId: string;
  requestId: string;
  employeeId: string | null;
  reason?: string | null;
  force?: boolean;
}): Promise<string> {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.id, opts.requestId), eq(leaveRequests.orgId, opts.orgId)))
      .limit(1);

    if (!request) throw new LeaveError("That request no longer exists.");
    if (!opts.force && request.employeeId !== opts.employeeId) {
      throw new LeaveError("You can only withdraw your own requests.");
    }
    if (request.status !== "pending" && request.status !== "approved") {
      throw new LeaveError(`A ${request.status} request cannot be withdrawn.`);
    }

    const [type] = await tx
      .select({ deductsBalance: leaveTypes.deductsBalance })
      .from(leaveTypes)
      .where(eq(leaveTypes.id, request.leaveTypeId))
      .limit(1);

    if (type?.deductsBalance) {
      const column = request.status === "approved" ? leaveBalances.used : leaveBalances.pending;
      await tx
        .update(leaveBalances)
        .set(
          request.status === "approved"
            ? { used: sql`${column} - ${request.totalDays}`, updatedAt: new Date() }
            : { pending: sql`${column} - ${request.totalDays}`, updatedAt: new Date() },
        )
        .where(
          and(
            eq(leaveBalances.employeeId, request.employeeId),
            eq(leaveBalances.leaveTypeId, request.leaveTypeId),
            eq(leaveBalances.fiscalYearId, request.fiscalYearId),
          ),
        );
    }

    await tx
      .update(approvalSteps)
      .set({ decision: "skipped" })
      .where(
        and(
          eq(approvalSteps.entityType, LEAVE_ENTITY),
          eq(approvalSteps.entityId, request.id),
          eq(approvalSteps.decision, "pending"),
        ),
      );

    await tx
      .update(leaveRequests)
      .set({
        status: "cancelled",
        currentLevel: null,
        cancelledAt: new Date(),
        cancelReason: opts.reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(leaveRequests.id, request.id));

    // Withdrawing approved leave must un-mark the attendance days. Same rule as
    // approval: published, not called.
    await publish(tx, {
      orgId: opts.orgId,
      module: "leave",
      name: "leave.request.withdrawn",
      payload: { leaveRequestId: request.id, employeeId: request.employeeId },
      dedupeKey: `leave.withdrawn:${request.id}`,
    });

    return request.reference;
  });
}
