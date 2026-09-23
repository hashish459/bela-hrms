import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { userAccounts } from "@/db/schema/core";
import { session } from "@/db/schema/auth";
import { employeeSeparations, employees, onStrength, separationClearances } from "@/db/schema/hr";
import { departments, designations } from "@/db/schema/org";
import { adToBs, formatBsKey, todayInNepal } from "@/lib/bs";
import { publish } from "@/kernel/events";
import { cacheTags, invalidate } from "@/kernel/cache";
import { nextReference } from "./refs";

/**
 * Leaving the organisation.
 *
 * A separation is a case with a life of its own: opened when notice is given
 * or a decision is made, worked through a no-dues checklist while the notice
 * runs, and completed once everything is handed back. Only completion touches
 * the employee: their status becomes resigned, terminated or retired, the
 * separation date is written, and their login is switched off and signed out
 * everywhere — so there is no window where a leaver keeps system access
 * because somebody forgot a second screen.
 *
 * A cancelled case puts nothing back because completion never happened; a
 * completed case can be reopened only by recording a new hire, which is a
 * different decision with different paperwork.
 */

export type SeparationKind = (typeof employeeSeparations.$inferSelect)["kind"];

export const SEPARATION_LABEL: Record<SeparationKind, string> = {
  resignation: "Resignation",
  termination: "Termination",
  retirement: "Retirement",
  contract_end: "End of contract",
  death: "Death in service",
  absconding: "Absconding",
};

/** The status an employee ends in for each kind of leaving. */
const FINAL_STATUS: Record<SeparationKind, "resigned" | "terminated" | "retired"> = {
  resignation: "resigned",
  termination: "terminated",
  retirement: "retired",
  contract_end: "resigned",
  death: "terminated",
  absconding: "terminated",
};

/**
 * The default no-dues checklist. Each organisation's HR can add lines to a case;
 * these are the ones every leaver in Nepal is cleared against.
 */
export const DEFAULT_CLEARANCE: { owner: string; item: string }[] = [
  { owner: "Line manager", item: "Handover of work, files and ongoing tasks" },
  { owner: "IT", item: "Laptop, accessories and access cards returned; accounts disabled" },
  { owner: "Admin", item: "ID card, keys, uniform and other company property returned" },
  { owner: "Finance", item: "Advances, loans and petty cash settled" },
  { owner: "HR", item: "Leave balance reconciled for encashment or deduction" },
  { owner: "HR", item: "Experience letter and relieving letter issued" },
  { owner: "Finance", item: "Final settlement, SSF/PF and gratuity processed" },
];

export class SeparationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "SeparationError";
  }
}

export type SeparationInput = {
  employeeId: string;
  kind: SeparationKind;
  noticeDate: string;
  lastWorkingDate: string;
  reason: string | null;
};

type Actor = { userId: string; label: string };

export async function initiateSeparation(orgId: string, input: SeparationInput, actor: Actor) {
  if (input.lastWorkingDate < input.noticeDate) {
    throw new SeparationError("The last working day cannot be before notice was given.", "lastWorkingDate");
  }
  try {
    return await db.transaction(async (tx) => {
      const [emp] = await tx
        .select({ id: employees.id, status: employees.status, dateOfJoin: employees.dateOfJoin })
        .from(employees)
        .where(and(eq(employees.id, input.employeeId), eq(employees.orgId, orgId), onStrength()))
        .limit(1);
      if (!emp) throw new SeparationError("Choose somebody who is currently employed.", "employeeId");
      if (input.lastWorkingDate < emp.dateOfJoin) {
        throw new SeparationError("The last working day is before they joined.", "lastWorkingDate");
      }

      const reference = await nextReference(tx, {
        orgId,
        prefix: "SEP",
        year: adToBs(input.noticeDate).year,
        table: "employee_separations",
      });

      const [row] = await tx
        .insert(employeeSeparations)
        .values({
          orgId,
          employeeId: emp.id,
          reference,
          kind: input.kind,
          noticeDate: input.noticeDate,
          lastWorkingDate: input.lastWorkingDate,
          reason: input.reason,
          createdByUserId: actor.userId,
          createdByLabel: actor.label,
          settlementStatus: input.kind === "absconding" ? "not_applicable" : "pending",
        })
        .returning({ id: employeeSeparations.id });

      await tx
        .insert(separationClearances)
        .values(DEFAULT_CLEARANCE.map((c, i) => ({ separationId: row.id, ...c, sortOrder: i })));

      await publish(tx, {
        orgId,
        module: "people",
        name: "people.separation.initiated",
        payload: {
          separationId: row.id,
          employeeId: emp.id,
          reference,
          kind: SEPARATION_LABEL[input.kind],
          lastWorkingDate: input.lastWorkingDate,
          lastWorkingDateBs: formatBsKey(adToBs(input.lastWorkingDate)),
        },
        dedupeKey: `separation.initiated:${row.id}`,
      });

      return { id: row.id, reference };
    });
  } catch (error) {
    const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
    const constraint = e?.constraint ?? e?.cause?.constraint;
    if ((e?.code ?? e?.cause?.code) === "23505" && constraint === "employee_separations_open_key") {
      throw new SeparationError("A separation is already open for this person.", "employeeId");
    }
    throw error;
  }
}

export async function updateSeparation(
  orgId: string,
  id: string,
  patch: {
    lastWorkingDate?: string;
    exitInterview?: string | null;
    eligibleForRehire?: boolean;
    settlementStatus?: "pending" | "processed" | "not_applicable";
    settlementNote?: string | null;
  },
) {
  const [current] = await db
    .select({ status: employeeSeparations.status, noticeDate: employeeSeparations.noticeDate })
    .from(employeeSeparations)
    .where(and(eq(employeeSeparations.id, id), eq(employeeSeparations.orgId, orgId)))
    .limit(1);
  if (!current) throw new SeparationError("That separation no longer exists.");
  if (current.status === "cancelled") throw new SeparationError("A cancelled separation cannot be edited.");
  if (current.status === "completed" && patch.lastWorkingDate) {
    throw new SeparationError("The last working day is fixed once the separation is completed.");
  }
  if (patch.lastWorkingDate && patch.lastWorkingDate < current.noticeDate) {
    throw new SeparationError("The last working day cannot be before notice was given.", "lastWorkingDate");
  }
  await db
    .update(employeeSeparations)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(employeeSeparations.id, id));
}

export async function setClearance(
  orgId: string,
  clearanceId: string,
  status: "pending" | "cleared" | "waived",
  note: string | null,
  byLabel: string,
) {
  const [row] = await db
    .select({ id: separationClearances.id, caseStatus: employeeSeparations.status })
    .from(separationClearances)
    .innerJoin(employeeSeparations, eq(employeeSeparations.id, separationClearances.separationId))
    .where(and(eq(separationClearances.id, clearanceId), eq(employeeSeparations.orgId, orgId)))
    .limit(1);
  if (!row) throw new SeparationError("That checklist line no longer exists.");
  if (row.caseStatus !== "in_progress") throw new SeparationError("The case is closed; its checklist is final.");
  await db
    .update(separationClearances)
    .set({
      status,
      note,
      clearedByLabel: status === "pending" ? null : byLabel,
      clearedAt: status === "pending" ? null : new Date(),
    })
    .where(eq(separationClearances.id, clearanceId));
}

export async function addClearance(orgId: string, separationId: string, owner: string, item: string) {
  const [c] = await db
    .select({ status: employeeSeparations.status })
    .from(employeeSeparations)
    .where(and(eq(employeeSeparations.id, separationId), eq(employeeSeparations.orgId, orgId)))
    .limit(1);
  if (!c || c.status !== "in_progress") throw new SeparationError("Lines can only be added to an open case.");
  const [{ n }] = await db
    .select({ n: sql<number>`coalesce(max(${separationClearances.sortOrder}), 0)::int` })
    .from(separationClearances)
    .where(eq(separationClearances.separationId, separationId));
  await db.insert(separationClearances).values({ separationId, owner, item, sortOrder: n + 1 });
}

/**
 * Closes the case and the employee record with it.
 *
 * Refused while any checklist line is still pending — "waived" is the honest
 * answer for a line that will never be cleared, and it is recorded as such.
 */
export async function completeSeparation(orgId: string, id: string, actor: Actor) {
  const result = await db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(employeeSeparations)
      .where(and(eq(employeeSeparations.id, id), eq(employeeSeparations.orgId, orgId)))
      .for("update")
      .limit(1);
    if (!c) throw new SeparationError("That separation no longer exists.");
    if (c.status !== "in_progress") throw new SeparationError("This case is already closed.");
    // Serving notice is still being employed: payroll, leave and attendance all
    // continue until the last day, so the record cannot close before it.
    if (c.lastWorkingDate > todayInNepal()) {
      throw new SeparationError(
        `Still serving notice until ${formatBsKey(adToBs(c.lastWorkingDate))} BS. Complete the case on or after the last working day.`,
      );
    }

    const [{ open }] = await tx
      .select({ open: sql<number>`count(*)::int` })
      .from(separationClearances)
      .where(and(eq(separationClearances.separationId, id), eq(separationClearances.status, "pending")));
    if (open > 0) {
      throw new SeparationError(
        `${open} checklist ${open === 1 ? "line is" : "lines are"} still pending. Clear or waive ${open === 1 ? "it" : "them"} first.`,
      );
    }

    const [emp] = await tx
      .select({ status: employees.status })
      .from(employees)
      .where(eq(employees.id, c.employeeId))
      .limit(1);

    await tx
      .update(employees)
      .set({
        status: FINAL_STATUS[c.kind],
        separationDate: c.lastWorkingDate,
        separationReason: `${SEPARATION_LABEL[c.kind]}${c.reason ? ` — ${c.reason}` : ""}`,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, c.employeeId));

    // Reports who pointed at the leaver now point at nobody; the reporting
    // lines screen lists them as needing a supervisor.
    await tx.update(employees).set({ supervisorId: null }).where(eq(employees.supervisorId, c.employeeId));

    const logins = await tx
      .update(userAccounts)
      .set({ isActive: false })
      .where(and(eq(userAccounts.employeeId, c.employeeId), isNull(userAccounts.deletedAt)))
      .returning({ userId: userAccounts.userId });
    if (logins.length) {
      await tx.delete(session).where(inArray(session.userId, logins.map((l) => l.userId)));
    }

    await tx
      .update(employeeSeparations)
      .set({
        status: "completed",
        completedAt: new Date(),
        completedByLabel: actor.label,
        previousStatus: emp?.status ?? null,
        updatedAt: new Date(),
      })
      .where(eq(employeeSeparations.id, id));

    await publish(tx, {
      orgId,
      module: "people",
      name: "people.separation.completed",
      payload: { separationId: id, employeeId: c.employeeId, reference: c.reference, kind: SEPARATION_LABEL[c.kind] },
      dedupeKey: `separation.completed:${id}`,
    });

    return { reference: c.reference, loginsClosed: logins.length };
  });

  invalidate(cacheTags.authz, cacheTags.people(orgId));
  return result;
}

export async function cancelSeparation(orgId: string, id: string) {
  const rows = await db
    .update(employeeSeparations)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(and(eq(employeeSeparations.id, id), eq(employeeSeparations.orgId, orgId), eq(employeeSeparations.status, "in_progress")))
    .returning({ reference: employeeSeparations.reference });
  if (rows.length === 0) throw new SeparationError("Only an open case can be cancelled.");
  return rows[0].reference;
}

export async function listSeparations(orgId: string, filter: { status?: string | null } = {}) {
  const rows = await db
    .select({
      id: employeeSeparations.id,
      reference: employeeSeparations.reference,
      kind: employeeSeparations.kind,
      status: employeeSeparations.status,
      noticeDate: employeeSeparations.noticeDate,
      lastWorkingDate: employeeSeparations.lastWorkingDate,
      settlementStatus: employeeSeparations.settlementStatus,
      reason: employeeSeparations.reason,
      employeeId: employees.id,
      employeeCode: employees.employeeCode,
      employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      photoFileId: employees.photoFileId,
      department: departments.name,
      designation: designations.name,
      cleared: sql<number>`(select count(*)::int from separation_clearances c where c.separation_id = ${employeeSeparations.id} and c.status <> 'pending')`,
      total: sql<number>`(select count(*)::int from separation_clearances c where c.separation_id = ${employeeSeparations.id})`,
    })
    .from(employeeSeparations)
    .innerJoin(employees, eq(employees.id, employeeSeparations.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(
      and(
        eq(employeeSeparations.orgId, orgId),
        isNull(employees.deletedAt),
        filter.status ? eq(employeeSeparations.status, filter.status as "in_progress") : undefined,
      ),
    )
    .orderBy(asc(sql`case when ${employeeSeparations.status} = 'in_progress' then 0 else 1 end`), desc(employeeSeparations.lastWorkingDate));
  return rows;
}

export async function separationDetail(orgId: string, id: string) {
  const [row] = await db
    .select({
      s: employeeSeparations,
      employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      employeeCode: employees.employeeCode,
      photoFileId: employees.photoFileId,
      dateOfJoin: employees.dateOfJoin,
      noticePeriodDays: employees.noticePeriodDays,
      department: departments.name,
      designation: designations.name,
    })
    .from(employeeSeparations)
    .innerJoin(employees, eq(employees.id, employeeSeparations.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(and(eq(employeeSeparations.id, id), eq(employeeSeparations.orgId, orgId)))
    .limit(1);
  if (!row) return null;
  const clearance = await db
    .select()
    .from(separationClearances)
    .where(eq(separationClearances.separationId, id))
    .orderBy(asc(separationClearances.sortOrder));
  return { ...row, clearance };
}
