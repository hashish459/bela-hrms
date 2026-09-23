import "server-only";

import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { employeeAssignments, employeeMovements, employees, onStrength } from "@/db/schema/hr";
import { branches, departments, designations, grades } from "@/db/schema/org";
import { adToBs, formatBsKey, todayInNepal } from "@/lib/bs";
import { publish, type Tx } from "@/kernel/events";
import { nextReference } from "./refs";

/**
 * Transfers, promotions and the other dated placement changes.
 *
 * A movement is recorded against an effective date. On or before today it is
 * applied in the same transaction; after today it waits as `scheduled` and
 * `applyDueMovements` applies it when the date arrives — from the Transfers
 * screen, the cron endpoint, or the next time anyone opens the list. Applying
 * is idempotent: a movement is only ever applied from `scheduled`.
 *
 * Applying does three things together or not at all: writes the new placement
 * onto the employee row, closes the current `employee_assignments` period the
 * day before, and opens a new one carrying the movement's id. That history is
 * what payroll reads to answer "what grade was this person on in Shrawan".
 */

export type MovementKind = (typeof employeeMovements.$inferSelect)["kind"];

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  transfer: "Transfer",
  promotion: "Promotion",
  demotion: "Demotion",
  redesignation: "Re-designation",
  salary_revision: "Salary revision",
  supervisor_change: "Change of supervisor",
};

export class MovementError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "MovementError";
  }
}

export type MovementInput = {
  employeeId: string;
  kind: MovementKind;
  effectiveDate: string;
  toBranchId: string | null;
  toDepartmentId: string | null;
  toDesignationId: string | null;
  toGradeId: string | null;
  toSupervisorId: string | null;
  toBasicSalary: string | null;
  reason: string | null;
  letterNumber: string | null;
};

type Actor = { userId: string; label: string };

/** Records a movement, applying it now when its date has already come. */
export async function recordMovement(orgId: string, input: MovementInput, actor: Actor) {
  return db.transaction(async (tx) => {
    const [emp] = await tx
      .select()
      .from(employees)
      .where(and(eq(employees.id, input.employeeId), eq(employees.orgId, orgId), onStrength()))
      .limit(1);
    if (!emp) throw new MovementError("Choose somebody who is currently employed.", "employeeId");

    const changes = {
      branch: input.toBranchId && input.toBranchId !== emp.branchId,
      department: input.toDepartmentId && input.toDepartmentId !== emp.departmentId,
      designation: input.toDesignationId && input.toDesignationId !== emp.designationId,
      grade: input.toGradeId && input.toGradeId !== emp.gradeId,
      supervisor: input.toSupervisorId && input.toSupervisorId !== emp.supervisorId,
      salary: input.toBasicSalary !== null && Number(input.toBasicSalary) !== Number(emp.basicSalary ?? NaN),
    };
    if (!Object.values(changes).some(Boolean)) {
      throw new MovementError("Nothing would change — pick at least one new value.");
    }
    if (input.toSupervisorId === emp.id) {
      throw new MovementError("Somebody cannot report to themselves.", "toSupervisorId");
    }

    // one scheduled change per person per day keeps the history unambiguous
    const [clash] = await tx
      .select({ reference: employeeMovements.reference })
      .from(employeeMovements)
      .where(
        and(
          eq(employeeMovements.employeeId, emp.id),
          eq(employeeMovements.effectiveDate, input.effectiveDate),
          eq(employeeMovements.status, "scheduled"),
        ),
      )
      .limit(1);
    if (clash) throw new MovementError(`${clash.reference} already changes this person on that date.`, "effectiveDate");

    const reference = await nextReference(tx, {
      orgId,
      prefix: input.kind === "promotion" ? "PRM" : "TRF",
      year: adToBs(input.effectiveDate).year,
      table: "employee_movements",
    });

    const [movement] = await tx
      .insert(employeeMovements)
      .values({
        orgId,
        employeeId: emp.id,
        reference,
        kind: input.kind,
        effectiveDate: input.effectiveDate,
        fromBranchId: emp.branchId,
        fromDepartmentId: emp.departmentId,
        fromDesignationId: emp.designationId,
        fromGradeId: emp.gradeId,
        fromSupervisorId: emp.supervisorId,
        fromBasicSalary: emp.basicSalary,
        toBranchId: changes.branch ? input.toBranchId : null,
        toDepartmentId: changes.department ? input.toDepartmentId : null,
        toDesignationId: changes.designation ? input.toDesignationId : null,
        toGradeId: changes.grade ? input.toGradeId : null,
        toSupervisorId: changes.supervisor ? input.toSupervisorId : null,
        toBasicSalary: changes.salary ? input.toBasicSalary : null,
        reason: input.reason,
        letterNumber: input.letterNumber,
        createdByUserId: actor.userId,
        createdByLabel: actor.label,
      })
      .returning();

    let applied = false;
    if (input.effectiveDate <= todayInNepal()) {
      await applyMovement(tx, movement.id);
      applied = true;
    }
    return { id: movement.id, reference, applied };
  });
}

/** Writes a scheduled movement onto the record. No-op for anything not scheduled. */
async function applyMovement(tx: Tx, movementId: string): Promise<boolean> {
  const [m] = await tx
    .select()
    .from(employeeMovements)
    .where(and(eq(employeeMovements.id, movementId), eq(employeeMovements.status, "scheduled")))
    .for("update")
    .limit(1);
  if (!m) return false;

  const [emp] = await tx.select().from(employees).where(eq(employees.id, m.employeeId)).limit(1);
  if (!emp) return false;

  const next = {
    branchId: m.toBranchId ?? emp.branchId,
    departmentId: m.toDepartmentId ?? emp.departmentId,
    designationId: m.toDesignationId ?? emp.designationId,
    gradeId: m.toGradeId ?? emp.gradeId,
    supervisorId: m.toSupervisorId ?? emp.supervisorId,
    basicSalary: m.toBasicSalary ?? emp.basicSalary,
  };

  await tx.update(employees).set({ ...next, updatedAt: new Date() }).where(eq(employees.id, emp.id));

  // close the open period the day before; open the new one on the effective date
  await tx
    .update(employeeAssignments)
    .set({ isCurrent: false, effectiveTo: sql`(${m.effectiveDate}::date - 1)` })
    .where(and(eq(employeeAssignments.employeeId, emp.id), eq(employeeAssignments.isCurrent, true)));
  await tx.insert(employeeAssignments).values({
    orgId: m.orgId,
    employeeId: emp.id,
    effectiveFrom: m.effectiveDate,
    ...next,
    reason: `${MOVEMENT_LABEL[m.kind]} ${m.reference}${m.reason ? ` — ${m.reason}` : ""}`,
    isCurrent: true,
    movementId: m.id,
  });

  await tx
    .update(employeeMovements)
    .set({ status: "applied", appliedAt: new Date() })
    .where(eq(employeeMovements.id, m.id));

  await publish(tx, {
    orgId: m.orgId,
    module: "people",
    name: "people.movement.applied",
    payload: {
      movementId: m.id,
      employeeId: emp.id,
      reference: m.reference,
      kind: MOVEMENT_LABEL[m.kind],
      effectiveDate: m.effectiveDate,
      effectiveDateBs: formatBsKey(adToBs(m.effectiveDate)),
    },
    dedupeKey: `movement.applied:${m.id}`,
  });
  return true;
}

/** Applies every scheduled movement whose date has come. Safe to call often. */
export async function applyDueMovements(orgId: string, today = todayInNepal()): Promise<number> {
  const due = await db
    .select({ id: employeeMovements.id })
    .from(employeeMovements)
    .where(
      and(
        eq(employeeMovements.orgId, orgId),
        eq(employeeMovements.status, "scheduled"),
        lte(employeeMovements.effectiveDate, today),
      ),
    )
    .orderBy(employeeMovements.effectiveDate);

  let applied = 0;
  for (const row of due) {
    // one transaction each: a bad row must not hold back the rest
    try {
      if (await db.transaction((tx) => applyMovement(tx, row.id))) applied++;
    } catch (error) {
      console.error("[people] could not apply movement", row.id, error);
    }
  }
  return applied;
}

/** Withdraws a movement that has not taken effect. */
export async function cancelMovement(orgId: string, id: string, reason: string | null) {
  const rows = await db
    .update(employeeMovements)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason })
    .where(and(eq(employeeMovements.id, id), eq(employeeMovements.orgId, orgId), eq(employeeMovements.status, "scheduled")))
    .returning({ reference: employeeMovements.reference });
  if (rows.length === 0) throw new MovementError("Only a scheduled movement can be cancelled; an applied one is reversed by recording another.");
  return rows[0].reference;
}

const fromBranch = alias(branches, "from_branch");
const toBranch = alias(branches, "to_branch");
const fromDept = alias(departments, "from_dept");
const toDept = alias(departments, "to_dept");
const fromDesig = alias(designations, "from_desig");
const toDesig = alias(designations, "to_desig");
const fromGrade = alias(grades, "from_grade");
const toGrade = alias(grades, "to_grade");
const fromSup = alias(employees, "from_sup");
const toSup = alias(employees, "to_sup");

/** The register, newest first, with every name resolved. */
export async function listMovements(
  orgId: string,
  filter: { status?: string | null; employeeId?: string | null; limit?: number } = {},
) {
  return db
    .select({
      id: employeeMovements.id,
      reference: employeeMovements.reference,
      kind: employeeMovements.kind,
      status: employeeMovements.status,
      effectiveDate: employeeMovements.effectiveDate,
      reason: employeeMovements.reason,
      letterNumber: employeeMovements.letterNumber,
      createdByLabel: employeeMovements.createdByLabel,
      createdAt: employeeMovements.createdAt,
      cancelReason: employeeMovements.cancelReason,
      employeeId: employees.id,
      employeeCode: employees.employeeCode,
      employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      photoFileId: employees.photoFileId,
      fromBranch: fromBranch.name,
      toBranch: toBranch.name,
      fromDepartment: fromDept.name,
      toDepartment: toDept.name,
      fromDesignation: fromDesig.name,
      toDesignation: toDesig.name,
      fromGrade: fromGrade.name,
      toGrade: toGrade.name,
      fromSupervisor: sql<string | null>`${fromSup.firstName} || ' ' || ${fromSup.lastName}`,
      toSupervisor: sql<string | null>`${toSup.firstName} || ' ' || ${toSup.lastName}`,
      fromBasicSalary: employeeMovements.fromBasicSalary,
      toBasicSalary: employeeMovements.toBasicSalary,
    })
    .from(employeeMovements)
    .innerJoin(employees, eq(employees.id, employeeMovements.employeeId))
    .leftJoin(fromBranch, eq(fromBranch.id, employeeMovements.fromBranchId))
    .leftJoin(toBranch, eq(toBranch.id, employeeMovements.toBranchId))
    .leftJoin(fromDept, eq(fromDept.id, employeeMovements.fromDepartmentId))
    .leftJoin(toDept, eq(toDept.id, employeeMovements.toDepartmentId))
    .leftJoin(fromDesig, eq(fromDesig.id, employeeMovements.fromDesignationId))
    .leftJoin(toDesig, eq(toDesig.id, employeeMovements.toDesignationId))
    .leftJoin(fromGrade, eq(fromGrade.id, employeeMovements.fromGradeId))
    .leftJoin(toGrade, eq(toGrade.id, employeeMovements.toGradeId))
    .leftJoin(fromSup, eq(fromSup.id, employeeMovements.fromSupervisorId))
    .leftJoin(toSup, eq(toSup.id, employeeMovements.toSupervisorId))
    .where(
      and(
        eq(employeeMovements.orgId, orgId),
        isNull(employees.deletedAt),
        filter.status ? eq(employeeMovements.status, filter.status as "scheduled") : undefined,
        filter.employeeId ? eq(employeeMovements.employeeId, filter.employeeId) : undefined,
      ),
    )
    .orderBy(desc(employeeMovements.effectiveDate), desc(employeeMovements.createdAt))
    .limit(filter.limit ?? 200);
}
