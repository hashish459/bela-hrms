import "server-only";

import { and, asc, eq, ne, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { organizations } from "@/db/schema/core";
import { employeeAssignments, employees, EMPLOYED_STATUSES } from "@/db/schema/hr";
import { branches, departments, designations, employmentTypes, grades } from "@/db/schema/org";
import { levelGrades } from "@/db/schema/org-structure";
import { leaveTypeEntitlements } from "@/db/schema/leave-policy";
import { holidayGroupBranches, weeklyOffs } from "@/db/schema/calendar";
import { attendanceDevices } from "@/db/schema/devices";
import { notices } from "@/db/schema/selfservice";
import { publish, type Tx } from "@/kernel/events";

/**
 * Master data: branches, departments (and sections under them), designations,
 * grades, employment types, and the organisation's own profile.
 *
 * The rules every one of them shares, stated once:
 *
 *   • **Codes are unique per organisation**, enforced by the database. A clash
 *     comes back as a field error, never a 500.
 *   • **Trees cannot loop.** A branch or department may not sit under itself or
 *     under its own descendant, and may not sit under an inactive parent.
 *   • **Deactivate, don't strand.** Something with current staff placed in it,
 *     or active children under it, cannot be deactivated — the person would be
 *     left in a unit nobody can select any more.
 *   • **Delete only what nothing points at.** Several references cascade —
 *     deleting a branch would silently take its weekly-off rules with it, a
 *     department its notices, an employment type its leave entitlements — so
 *     the database cannot be trusted to refuse. Every reference is counted
 *     explicitly, and anything referenced at all can only be deactivated.
 *
 * Every write publishes `org.structure.changed` in its own transaction, so a
 * module caching structure learns about it the same way whichever screen made
 * the change.
 */

export type MasterKind = "branch" | "department" | "designation" | "grade" | "employment_type";

export class MasterError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "MasterError";
  }
}

const TABLE = {
  branch: branches,
  department: departments,
  designation: designations,
  grade: grades,
  employment_type: employmentTypes,
} as const;

const NOUN: Record<MasterKind, string> = {
  branch: "branch",
  department: "department",
  designation: "designation",
  grade: "grade",
  employment_type: "employment type",
};

/** The employee column that places somebody in a master of each kind. */
const EMPLOYEE_COLUMN: Record<MasterKind, PgColumn> = {
  branch: employees.branchId,
  department: employees.departmentId,
  designation: employees.designationId,
  grade: employees.gradeId,
  employment_type: employees.employmentTypeId,
};

type Reference = { label: string; table: PgTable; column: PgColumn };

/**
 * Everything that can point at a master row, other than current staff. Kept
 * next to the rules so adding a table that references a branch is one line
 * here — and forgetting it fails safe, because the restrict constraints still
 * stand behind this list.
 */
const REFERENCES: Record<MasterKind, Reference[]> = {
  branch: [
    { label: "employee record", table: employees, column: employees.branchId },
    { label: "placement history entry", table: employeeAssignments, column: employeeAssignments.branchId },
    { label: "sub-branch", table: branches, column: branches.parentId },
    { label: "attendance device", table: attendanceDevices, column: attendanceDevices.branchId },
    { label: "weekly-off rule", table: weeklyOffs, column: weeklyOffs.branchId },
    { label: "holiday group", table: holidayGroupBranches, column: holidayGroupBranches.branchId },
    { label: "notice", table: notices, column: notices.branchId },
  ],
  department: [
    { label: "employee record", table: employees, column: employees.departmentId },
    { label: "placement history entry", table: employeeAssignments, column: employeeAssignments.departmentId },
    { label: "section", table: departments, column: departments.parentId },
    { label: "notice", table: notices, column: notices.departmentId },
  ],
  designation: [
    { label: "employee record", table: employees, column: employees.designationId },
    { label: "placement history entry", table: employeeAssignments, column: employeeAssignments.designationId },
  ],
  grade: [
    { label: "employee record", table: employees, column: employees.gradeId },
    { label: "placement history entry", table: employeeAssignments, column: employeeAssignments.gradeId },
    { label: "position-level mapping", table: levelGrades, column: levelGrades.gradeId },
  ],
  employment_type: [
    { label: "employee record", table: employees, column: employees.employmentTypeId },
    { label: "leave entitlement rule", table: leaveTypeEntitlements, column: leaveTypeEntitlements.employmentTypeId },
  ],
};

const employedNow = (): SQL =>
  sql`${employees.status} = ANY(ARRAY[${sql.join(
    EMPLOYED_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  )}]::employee_status[])`;

/* ------------------------------------------------------------------ reading */

export type Usage = {
  /** Currently employed people placed here. */
  staff: number;
  /** Every reference of any kind — employees past and present, history, config. */
  references: number;
  /** Human summary of what references it, for a refused delete. */
  summary: string[];
};

/** Usage for every row of a kind, in a handful of grouped queries. */
export async function usageFor(orgId: string, kind: MasterKind): Promise<Map<string, Usage>> {
  const out = new Map<string, Usage>();
  const get = (id: string) => {
    let u = out.get(id);
    if (!u) {
      u = { staff: 0, references: 0, summary: [] };
      out.set(id, u);
    }
    return u;
  };

  const staffColumn = EMPLOYEE_COLUMN[kind];
  const staff = await db
    .select({ id: staffColumn, n: sql<number>`count(*)::int` })
    .from(employees)
    .where(and(eq(employees.orgId, orgId), employedNow()))
    .groupBy(staffColumn);
  for (const row of staff) if (row.id) get(row.id as string).staff = row.n;

  for (const ref of REFERENCES[kind]) {
    const rows = await db
      .select({ id: ref.column, n: sql<number>`count(*)::int` })
      .from(ref.table)
      .groupBy(ref.column);
    for (const row of rows) {
      if (!row.id) continue;
      const u = get(row.id as string);
      u.references += row.n;
      u.summary.push(`${row.n} ${ref.label}${row.n === 1 ? "" : "s"}`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ writing */

export type BranchInput = {
  code: string;
  name: string;
  nameNepali: string | null;
  parentId: string | null;
  address: string | null;
  district: string | null;
  phone: string | null;
  isHeadOffice: boolean;
};

export type DepartmentInput = {
  code: string;
  name: string;
  nameNepali: string | null;
  parentId: string | null;
  headEmployeeId: string | null;
};

export type DesignationInput = { code: string; name: string; nameNepali: string | null; hierarchyLevel: number };
export type GradeInput = { code: string; name: string; hierarchyLevel: number; basicSalary: string | null };
export type EmploymentTypeInput = { code: string; name: string; accruesLeave: boolean };

export type MasterInput =
  | { kind: "branch"; values: BranchInput }
  | { kind: "department"; values: DepartmentInput }
  | { kind: "designation"; values: DesignationInput }
  | { kind: "grade"; values: GradeInput }
  | { kind: "employment_type"; values: EmploymentTypeInput };

async function changed(tx: Tx, orgId: string, kind: MasterKind | "organisation", id: string, action: string) {
  await publish(tx, {
    orgId,
    module: "org",
    name: "org.structure.changed",
    payload: { kind, unitId: id, action },
  });
}

/** Postgres error code, whether the driver error is thrown bare or wrapped. */
function pgCode(error: unknown): { code?: string; constraint?: string } {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  return { code: e?.code ?? e?.cause?.code, constraint: e?.constraint ?? e?.cause?.constraint };
}

/**
 * A parent must exist in the same organisation, be active, and not be the row
 * itself or anything beneath it. Walked inside the writing transaction; bounded,
 * so a cycle already in the data cannot hang the request.
 */
async function assertParent(
  tx: Tx,
  table: typeof branches | typeof departments,
  orgId: string,
  parentId: string | null,
  selfId: string | null,
  noun: string,
) {
  if (!parentId) return;
  if (parentId === selfId) throw new MasterError(`A ${noun} cannot sit under itself.`, "parentId");

  const [parent] = await tx
    .select({ id: table.id, orgId: table.orgId, isActive: table.isActive })
    .from(table)
    .where(eq(table.id, parentId))
    .limit(1);
  if (!parent || parent.orgId !== orgId) throw new MasterError("That parent no longer exists.", "parentId");
  if (!parent.isActive) throw new MasterError("That parent is inactive. Reactivate it first.", "parentId");

  if (!selfId) return;
  let cursor: string | null = parentId;
  for (let depth = 0; cursor && depth < 12; depth++) {
    if (cursor === selfId) throw new MasterError(`That would put the ${noun} inside itself.`, "parentId");
    const rows: { parentId: string | null }[] = await tx
      .select({ parentId: table.parentId })
      .from(table)
      .where(eq(table.id, cursor))
      .limit(1);
    cursor = rows[0]?.parentId ?? null;
  }
}

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

/** Only the fields that actually changed, so the audit log stays readable. */
function diff(before: Record<string, unknown> | null, after: Record<string, unknown>): FieldChanges {
  const out: FieldChanges = {};
  if (!before) return out;
  for (const [key, to] of Object.entries(after)) {
    const from = before[key] ?? null;
    const same = from === to || (from !== null && to !== null && String(from) === String(to));
    if (!same) out[key] = { from, to };
  }
  return out;
}

/** The organisation always has a head office; it can be moved, not removed. */
async function assertNotHeadOffice(tx: Tx, id: string, verb: string) {
  const [row] = await tx.select({ isHeadOffice: branches.isHeadOffice }).from(branches).where(eq(branches.id, id)).limit(1);
  if (row?.isHeadOffice) {
    throw new MasterError(`This is the head office. Mark another branch as head office before you ${verb} it.`);
  }
}

/** Creates or updates a master row. Returns its id and, for an update, what changed. */
export async function saveMaster(
  orgId: string,
  id: string | null,
  input: MasterInput,
): Promise<{ id: string; changes: FieldChanges }> {
  try {
    return await db.transaction(async (tx) => {
      let savedId: string;
      const table = TABLE[input.kind] as typeof designations;
      const [before] = id
        ? await tx.select().from(table).where(and(eq(table.id, id), eq(table.orgId, orgId))).limit(1)
        : [];
      if (id && !before) throw new MasterError(`That ${NOUN[input.kind]} no longer exists.`);

      switch (input.kind) {
        case "branch": {
          const v = input.values;
          await assertParent(tx, branches, orgId, v.parentId, id, "branch");
          // the head office moves; it is never simply removed
          if ((before as { isHeadOffice?: boolean } | undefined)?.isHeadOffice && !v.isHeadOffice) {
            throw new MasterError("This is the head office. Mark another branch as head office instead.", "isHeadOffice");
          }
          // one head office: claiming it releases whichever branch held it
          if (v.isHeadOffice) {
            await tx
              .update(branches)
              .set({ isHeadOffice: false })
              .where(and(eq(branches.orgId, orgId), eq(branches.isHeadOffice, true), id ? ne(branches.id, id) : undefined));
          }
          if (id) {
            await tx.update(branches).set(v).where(and(eq(branches.id, id), eq(branches.orgId, orgId)));
            savedId = id;
          } else {
            [{ id: savedId }] = await tx.insert(branches).values({ ...v, orgId }).returning({ id: branches.id });
          }
          break;
        }

        case "department": {
          const v = input.values;
          await assertParent(tx, departments, orgId, v.parentId, id, v.parentId ? "section" : "department");
          if (v.headEmployeeId) {
            const [head] = await tx
              .select({ id: employees.id })
              .from(employees)
              .where(and(eq(employees.id, v.headEmployeeId), eq(employees.orgId, orgId), employedNow()))
              .limit(1);
            if (!head) throw new MasterError("Choose a head who is currently employed.", "headEmployeeId");
          }
          if (id) {
            await tx.update(departments).set(v).where(and(eq(departments.id, id), eq(departments.orgId, orgId)));
            savedId = id;
          } else {
            [{ id: savedId }] = await tx.insert(departments).values({ ...v, orgId }).returning({ id: departments.id });
          }
          break;
        }

        case "designation": {
          const v = input.values;
          if (id) {
            await tx.update(designations).set(v).where(and(eq(designations.id, id), eq(designations.orgId, orgId)));
            savedId = id;
          } else {
            [{ id: savedId }] = await tx.insert(designations).values({ ...v, orgId }).returning({ id: designations.id });
          }
          break;
        }

        case "grade": {
          const v = input.values;
          if (id) {
            await tx.update(grades).set(v).where(and(eq(grades.id, id), eq(grades.orgId, orgId)));
            savedId = id;
          } else {
            [{ id: savedId }] = await tx.insert(grades).values({ ...v, orgId }).returning({ id: grades.id });
          }
          break;
        }

        case "employment_type": {
          const v = input.values;
          if (id) {
            await tx
              .update(employmentTypes)
              .set(v)
              .where(and(eq(employmentTypes.id, id), eq(employmentTypes.orgId, orgId)));
            savedId = id;
          } else {
            [{ id: savedId }] = await tx
              .insert(employmentTypes)
              .values({ ...v, orgId })
              .returning({ id: employmentTypes.id });
          }
          break;
        }
      }

      await changed(tx, orgId, input.kind, savedId, id ? "updated" : "created");
      return { id: savedId, changes: diff((before as Record<string, unknown>) ?? null, input.values) };
    });
  } catch (error) {
    const { code, constraint } = pgCode(error);
    if (code === "23505" && constraint?.endsWith("_code_key")) {
      throw new MasterError(`That code is already used by another ${NOUN[input.kind]}.`, "code");
    }
    throw error;
  }
}

/** Activates or deactivates, refusing to strand staff or children. */
export async function setMasterActive(orgId: string, kind: MasterKind, id: string, active: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    const table = TABLE[kind] as typeof designations;
    const [row] = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, id), eq(table.orgId, orgId)))
      .limit(1);
    if (!row) throw new MasterError(`That ${NOUN[kind]} no longer exists.`);

    if (!active) {
      if (kind === "branch") await assertNotHeadOffice(tx, id, "deactivate");
      const staffColumn = EMPLOYEE_COLUMN[kind];
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(employees)
        .where(and(eq(staffColumn, id), employedNow()));
      if (n > 0) {
        throw new MasterError(
          `${n} current ${n === 1 ? "employee is" : "employees are"} still placed in this ${NOUN[kind]}. Move them first, then deactivate it.`,
        );
      }

      if (kind === "branch" || kind === "department") {
        const tree = TABLE[kind] as typeof branches;
        const [{ c }] = await tx
          .select({ c: sql<number>`count(*)::int` })
          .from(tree)
          .where(and(eq(tree.parentId, id), eq(tree.isActive, true)));
        if (c > 0) {
          const noun = kind === "branch" ? (c === 1 ? "sub-branch" : "sub-branches") : c === 1 ? "section" : "sections";
          throw new MasterError(`Deactivate the ${c} ${noun} underneath first.`);
        }
      }
    } else if (kind === "branch" || kind === "department") {
      // reactivating under a parent that is still switched off would hide it again
      const tree = TABLE[kind] as typeof branches;
      const [self] = await tx.select({ parentId: tree.parentId }).from(tree).where(eq(tree.id, id)).limit(1);
      if (self?.parentId) {
        const [parent] = await tx.select({ isActive: tree.isActive }).from(tree).where(eq(tree.id, self.parentId)).limit(1);
        if (parent && !parent.isActive) throw new MasterError("Its parent is inactive. Reactivate the parent first.");
      }
    }

    await tx.update(table).set({ isActive: active }).where(eq(table.id, id));
    await changed(tx, orgId, kind, id, active ? "reactivated" : "deactivated");
  });
}

/** Deletes a row nothing references. Anything referenced must be deactivated instead. */
export async function deleteMaster(orgId: string, kind: MasterKind, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    if (kind === "branch") await assertNotHeadOffice(tx, id, "delete");
    const table = TABLE[kind] as typeof designations;
    const found: string[] = [];
    for (const ref of REFERENCES[kind]) {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(ref.table)
        .where(eq(ref.column, id));
      if (n > 0) found.push(`${n} ${ref.label}${n === 1 ? "" : "s"}`);
    }
    if (found.length) {
      throw new MasterError(`Still referenced by ${found.join(", ")}. Deactivate it instead — history keeps its meaning.`);
    }

    const deleted = await tx
      .delete(table)
      .where(and(eq(table.id, id), eq(table.orgId, orgId)))
      .returning({ id: table.id });
    if (deleted.length === 0) throw new MasterError(`That ${NOUN[kind]} no longer exists.`);
    await changed(tx, orgId, kind, id, "deleted");
  });
}

/* --------------------------------------------------------- organisation */

export type OrganisationProfile = {
  name: string;
  nameNepali: string | null;
  pan: string | null;
  address: string | null;
  district: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  defaultCalendar: "BS" | "AD";
};

export async function updateOrganisation(orgId: string, profile: OrganisationProfile): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(organizations)
      .set({ ...profile, updatedAt: new Date() })
      .where(eq(organizations.id, orgId));
    await changed(tx, orgId, "organisation", orgId, "updated");
  });
}

/** Employed staff for a "head of department" picker. */
export async function employedStaff(orgId: string) {
  return db
    .select({
      id: employees.id,
      code: employees.employeeCode,
      name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
    })
    .from(employees)
    .where(and(eq(employees.orgId, orgId), employedNow()))
    .orderBy(asc(employees.firstName), asc(employees.lastName));
}
