import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, type Db } from "@/db/client";
import type { Tx } from "@/kernel/events";
import { session } from "@/db/schema/auth";
import { userAccounts } from "@/db/schema/core";
import { employees } from "@/db/schema/hr";
import { leaveRequests } from "@/db/schema/leave";
import { attendanceDays, attendanceRequests } from "@/db/schema/attendance";
import { approvalSteps } from "@/db/schema/approvals";
import { employeeExperience, employeeFamily, employeeQualifications } from "@/db/schema/selfservice";
import { cacheTags, invalidate } from "@/kernel/cache";
import type { ProposedValues, SectionKey } from "./profile-fields";

/**
 * The rows of a personnel file that come in lists — family, qualifications,
 * previous employment — and the employee recycle bin.
 *
 * Every write takes the organisation id and checks the row belongs to it: an
 * id from a form is a claim, not a fact.
 */

export class RecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordError";
  }
}

export type RowSection = Extract<SectionKey, "family" | "qualification" | "experience">;

const ROW_TABLE = {
  family: employeeFamily,
  qualification: employeeQualifications,
  experience: employeeExperience,
} as const;

/** Only the columns the section defines ever reach the table. */
function rowValues(section: RowSection, v: ProposedValues) {
  switch (section) {
    case "family":
      return {
        fullName: String(v.fullName),
        relationship: v.relationship as (typeof employeeFamily.$inferInsert)["relationship"],
        dateOfBirth: (v.dateOfBirth as string | null) ?? null,
        occupation: (v.occupation as string | null) ?? null,
        contactNumber: (v.contactNumber as string | null) ?? null,
        isDependant: !!v.isDependant,
        isNominee: !!v.isNominee,
        nomineeSharePercent: (v.nomineeSharePercent as number | null) ?? null,
        isEmergencyContact: !!v.isEmergencyContact,
      };
    case "qualification":
      return {
        kind: v.kind as (typeof employeeQualifications.$inferInsert)["kind"],
        title: String(v.title),
        institution: (v.institution as string | null) ?? null,
        result: (v.result as string | null) ?? null,
        completedYear: (v.completedYear as number | null) ?? null,
        expiresOn: (v.expiresOn as string | null) ?? null,
      };
    case "experience":
      return {
        employer: String(v.employer),
        designation: (v.designation as string | null) ?? null,
        fromDate: (v.fromDate as string | null) ?? null,
        toDate: (v.toDate as string | null) ?? null,
        responsibilities: (v.responsibilities as string | null) ?? null,
        reasonForLeaving: (v.reasonForLeaving as string | null) ?? null,
        referenceContact: (v.referenceContact as string | null) ?? null,
      };
  }
}

type Executor = Db | Tx;

async function assertEmployee(orgId: string, employeeId: string, ex: Executor) {
  const [e] = await ex
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.orgId, orgId), isNull(employees.deletedAt)))
    .limit(1);
  if (!e) throw new RecordError("That employee no longer exists.");
}

/** Adds a row (`rowId` null) or replaces one. Returns the row id. */
export async function saveRow(
  orgId: string,
  employeeId: string,
  section: RowSection,
  rowId: string | null,
  values: ProposedValues,
  ex: Executor = db,
): Promise<string> {
  await assertEmployee(orgId, employeeId, ex);
  const table = ROW_TABLE[section] as typeof employeeExperience;
  const data = rowValues(section, values) as unknown as typeof employeeExperience.$inferInsert;
  if (rowId) {
    const rows = await ex
      .update(table)
      .set(data)
      .where(and(eq(table.id, rowId), eq(table.orgId, orgId), eq(table.employeeId, employeeId), isNull(table.deletedAt)))
      .returning({ id: table.id });
    if (!rows.length) throw new RecordError("That entry no longer exists.");
    return rows[0].id;
  }
  const [row] = await ex
    .insert(table)
    .values({ ...data, orgId, employeeId })
    .returning({ id: table.id });
  return row.id;
}

/** Moves a row to the recycle bin. */
export async function removeRow(orgId: string, section: RowSection, rowId: string, byLabel: string, ex: Executor = db) {
  const table = ROW_TABLE[section] as typeof employeeExperience;
  const rows = await ex
    .update(table)
    .set({ deletedAt: new Date(), deletedBy: byLabel })
    .where(and(eq(table.id, rowId), eq(table.orgId, orgId), isNull(table.deletedAt)))
    .returning({ id: table.id, employeeId: table.employeeId });
  if (!rows.length) throw new RecordError("That entry no longer exists.");
  return rows[0];
}

export async function rowsFor(orgId: string, employeeId: string) {
  const [family, qualifications, experience] = await Promise.all([
    db
      .select()
      .from(employeeFamily)
      .where(and(eq(employeeFamily.orgId, orgId), eq(employeeFamily.employeeId, employeeId), isNull(employeeFamily.deletedAt)))
      .orderBy(asc(employeeFamily.relationship), asc(employeeFamily.fullName)),
    db
      .select()
      .from(employeeQualifications)
      .where(
        and(
          eq(employeeQualifications.orgId, orgId),
          eq(employeeQualifications.employeeId, employeeId),
          isNull(employeeQualifications.deletedAt),
        ),
      )
      .orderBy(desc(employeeQualifications.completedYear), asc(employeeQualifications.title)),
    db
      .select()
      .from(employeeExperience)
      .where(
        and(eq(employeeExperience.orgId, orgId), eq(employeeExperience.employeeId, employeeId), isNull(employeeExperience.deletedAt)),
      )
      .orderBy(desc(employeeExperience.fromDate)),
  ]);
  return { family, qualifications, experience };
}

/* ------------------------------------------------------------ employee bin */

/**
 * Moves an employee record to the recycle bin — for a duplicate or a record
 * entered in error, not for somebody leaving (that is a separation).
 *
 * Refused while the record is load-bearing: people report to them, or a
 * request is waiting on them as approver. Their login, if any, is closed and
 * signed out in the same transaction; nothing else is touched, so a restore
 * brings everything back exactly as it was.
 */
export async function deleteEmployee(orgId: string, employeeId: string, byLabel: string) {
  const result = await db.transaction(async (tx) => {
    const [e] = await tx
      .select({ id: employees.id, code: employees.employeeCode, name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}` })
      .from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.orgId, orgId), isNull(employees.deletedAt)))
      .for("update")
      .limit(1);
    if (!e) throw new RecordError("That employee no longer exists.");

    const [{ reports }] = await tx
      .select({ reports: sql<number>`count(*)::int` })
      .from(employees)
      .where(and(eq(employees.supervisorId, employeeId), isNull(employees.deletedAt)));
    if (reports > 0) {
      throw new RecordError(`${reports} ${reports === 1 ? "person reports" : "people report"} to ${e.name}. Move them to another supervisor first.`);
    }

    const [{ waiting }] = await tx
      .select({ waiting: sql<number>`count(*)::int` })
      .from(approvalSteps)
      .where(and(eq(approvalSteps.approverEmployeeId, employeeId), eq(approvalSteps.decision, "pending")));
    if (waiting > 0) {
      throw new RecordError(`${waiting} ${waiting === 1 ? "request is" : "requests are"} waiting on ${e.name} to decide. Reassign or decide ${waiting === 1 ? "it" : "them"} first.`);
    }

    await tx.update(employees).set({ deletedAt: new Date(), deletedBy: byLabel }).where(eq(employees.id, employeeId));

    const logins = await tx
      .update(userAccounts)
      .set({ isActive: false, deletedAt: new Date(), deletedBy: byLabel })
      .where(and(eq(userAccounts.employeeId, employeeId), isNull(userAccounts.deletedAt)))
      .returning({ userId: userAccounts.userId });
    if (logins.length) await tx.delete(session).where(inArray(session.userId, logins.map((l) => l.userId)));

    return { code: e.code, name: e.name, loginsClosed: logins.length };
  });
  invalidate(cacheTags.authz, cacheTags.people(orgId));
  return result;
}

export async function restoreEmployee(orgId: string, employeeId: string) {
  try {
    const [e] = await db
      .update(employees)
      .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
      .where(and(eq(employees.id, employeeId), eq(employees.orgId, orgId), isNotNull(employees.deletedAt)))
      .returning({ code: employees.employeeCode });
    if (!e) throw new RecordError("That employee is not in the recycle bin.");
    invalidate(cacheTags.people(orgId));
    return e;
  } catch (error) {
    const err = error as { code?: string; cause?: { code?: string } };
    if ((err?.code ?? err?.cause?.code) === "23505") {
      throw new RecordError("Another employee now uses that employee code. Change one of them first.");
    }
    throw error;
  }
}

/**
 * Erases a binned employee for good. Refused if they have any working history —
 * leave, attendance or requests — because that history is somebody else's
 * evidence too (an approver's decision, a payroll period), and a record with
 * history was never "entered in error".
 */
export async function purgeEmployee(orgId: string, employeeId: string) {
  const [[leave], [days], [corrections], [login]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(leaveRequests).where(eq(leaveRequests.employeeId, employeeId)),
    db.select({ n: sql<number>`count(*)::int` }).from(attendanceDays).where(eq(attendanceDays.employeeId, employeeId)),
    db.select({ n: sql<number>`count(*)::int` }).from(attendanceRequests).where(eq(attendanceRequests.employeeId, employeeId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(userAccounts)
      .where(and(eq(userAccounts.employeeId, employeeId), isNull(userAccounts.deletedAt))),
  ]);
  const history = leave.n + days.n + corrections.n;
  if (history > 0) {
    throw new RecordError(
      `This record has ${history} leave or attendance entr${history === 1 ? "y" : "ies"}. It stays in the bin; that history is evidence for other people's decisions.`,
    );
  }
  if (login.n > 0) throw new RecordError("A live login is still linked to this record. Delete the login first.");

  try {
    const gone = await db
      .delete(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.orgId, orgId), isNotNull(employees.deletedAt)))
      .returning({ code: employees.employeeCode });
    if (!gone.length) throw new RecordError("That employee is not in the recycle bin.");
    return gone[0];
  } catch (error) {
    const err = error as { code?: string; cause?: { code?: string } };
    if ((err?.code ?? err?.cause?.code) === "23503") {
      throw new RecordError("Other records still point at this employee, so it stays in the bin.");
    }
    throw error;
  }
}
