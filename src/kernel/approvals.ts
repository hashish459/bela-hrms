import "server-only";

import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { approvalSteps } from "@/db/schema/approvals";
import type { Tx } from "./events";
import type { SupervisorLink } from "./ports";
import { requirePort } from "./registry";

/**
 * The shared approval engine.
 *
 * This used to live in `lib/leave.ts`, which meant attendance imported leave to
 * route an attendance correction — a dependency in the wrong direction that made
 * the two modules impossible to deploy or fail independently. Approval is a
 * kernel capability: every module that needs a signature chain uses this one.
 *
 * The supervisor walk goes through the `people` port rather than querying
 * `employees` directly, so the chain still resolves (as "needs HR") when the
 * people module is unavailable instead of throwing into a caller's transaction.
 */

export type EntityType = "leave_request" | "attendance_request" | "substitute_request";

/**
 * Walks the reporting line to `levels` deep. Always returns exactly `levels`
 * entries: a genuine gap in the reporting line becomes an unassigned step that
 * HR can see and fix, never a short chain that approves itself.
 *
 * The one thing it will not do is degrade quietly. If the people module is
 * unavailable, this throws rather than writing a chain of "needs HR" steps —
 * routing is not a rendering concern, and a request routed to nobody because of
 * a boot problem looks identical to one routed to nobody because the employee
 * has no supervisor. Those must not be confused: the first is an outage, the
 * second is data entry.
 */
export async function resolveChain(employeeId: string, levels: number): Promise<SupervisorLink[]> {
  const people = requirePort("people");
  const chain = await people.supervisorChain(employeeId, levels);

  // A port answering with the wrong shape is a bug in that module. Padding it
  // out here would hide the bug behind a plausible-looking ledger.
  if (chain.length !== levels) {
    throw new Error(
      `people.supervisorChain returned ${chain.length} link(s) for ${levels} level(s)`,
    );
  }
  return chain;
}

/**
 * Writes the whole chain at submission. `onConflictDoNothing` makes resubmitting
 * an already-routed entity a no-op rather than a duplicate-key error.
 */
export async function openChain(
  tx: Tx,
  input: {
    orgId: string;
    entityType: EntityType;
    entityId: string;
    chain: SupervisorLink[];
  },
): Promise<void> {
  if (input.chain.length === 0) return;

  await tx
    .insert(approvalSteps)
    .values(
      input.chain.map((step) => ({
        orgId: input.orgId,
        entityType: input.entityType,
        entityId: input.entityId,
        level: step.level,
        approverEmployeeId: step.approverEmployeeId,
        approverLabel: step.label,
      })),
    )
    .onConflictDoNothing();
}

export type StepRow = {
  id: string;
  level: number;
  approverEmployeeId: string | null;
  approverLabel: string | null;
  decision: "pending" | "approved" | "rejected" | "returned" | "skipped";
  comment: string | null;
  decidedAt: Date | null;
};

/** The ledger for one entity, in level order. */
export async function chainFor(entityType: EntityType, entityId: string): Promise<StepRow[]> {
  const rows = await db
    .select({
      id: approvalSteps.id,
      level: approvalSteps.level,
      approverEmployeeId: approvalSteps.approverEmployeeId,
      approverLabel: approvalSteps.approverLabel,
      decision: approvalSteps.decision,
      comment: approvalSteps.comment,
      decidedAt: approvalSteps.decidedAt,
    })
    .from(approvalSteps)
    .where(and(eq(approvalSteps.entityType, entityType), eq(approvalSteps.entityId, entityId)))
    .orderBy(approvalSteps.level);

  return rows as StepRow[];
}

/** Ledgers for many entities at once, keyed by entity id — avoids a query per row in a list. */
export async function chainsFor(
  entityType: EntityType,
  entityIds: string[],
): Promise<Map<string, StepRow[]>> {
  const out = new Map<string, StepRow[]>();
  if (entityIds.length === 0) return out;

  const rows = await db
    .select({
      entityId: approvalSteps.entityId,
      id: approvalSteps.id,
      level: approvalSteps.level,
      approverEmployeeId: approvalSteps.approverEmployeeId,
      approverLabel: approvalSteps.approverLabel,
      decision: approvalSteps.decision,
      comment: approvalSteps.comment,
      decidedAt: approvalSteps.decidedAt,
    })
    .from(approvalSteps)
    .where(
      and(eq(approvalSteps.entityType, entityType), inArray(approvalSteps.entityId, entityIds)),
    )
    .orderBy(approvalSteps.level);

  for (const row of rows) {
    const { entityId, ...step } = row;
    const list = out.get(entityId) ?? [];
    list.push(step as StepRow);
    out.set(entityId, list);
  }
  return out;
}

/**
 * The step a decision would land on: the lowest pending level. Returns null when
 * the chain is finished, which is how a caller detects a double decision without
 * a race — it still has to re-check inside its transaction.
 */
export function currentStep(chain: StepRow[]): StepRow | null {
  return chain.find((s) => s.decision === "pending") ?? null;
}

/** True once every level has approved. */
export function isFullyApproved(chain: StepRow[]): boolean {
  return chain.length > 0 && chain.every((s) => s.decision === "approved" || s.decision === "skipped");
}

/**
 * Marks the remaining levels skipped after a rejection, so a rejected request
 * does not sit in three other people's queues forever.
 */
export async function skipRemaining(
  tx: Tx,
  entityType: EntityType,
  entityId: string,
  afterLevel: number,
): Promise<void> {
  await tx
    .update(approvalSteps)
    .set({ decision: "skipped" })
    .where(
      and(
        eq(approvalSteps.entityType, entityType),
        eq(approvalSteps.entityId, entityId),
        eq(approvalSteps.decision, "pending"),
        gt(approvalSteps.level, afterLevel),
      ),
    );
}
