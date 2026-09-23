import "server-only";
import { notDeleted } from "@/db/schema/columns";

import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { branches, departments } from "@/db/schema/org";
import { orgUnits, type orgUnitKind } from "@/db/schema/org-structure";
import { employees, onStrength } from "@/db/schema/hr";
import type { PgColumn } from "drizzle-orm/pg-core";
import { publish, type Tx } from "@/kernel/events";
import type { OrgUnit, OrgUnitKind } from "@/kernel/ports";

/**
 * Organisation structure service.
 *
 * Owns every write to the structure tables and every rule about what may parent
 * what. Nothing outside this module writes `org_units`, `branches` or
 * `departments`; nothing outside this module needs to know that a *section* is
 * stored as a department with a parent.
 */

export type GenericKind = (typeof orgUnitKind.enumValues)[number];

/**
 * Which kind may sit under which. A division is a root; a business unit belongs
 * to a division; a sub business unit to a business unit. Locations nest into
 * locations (Bagmati → Kathmandu), and functional categories and projects are
 * flat.
 *
 * The legacy system enforced none of this — it stored `UnderGroup = 0` for roots
 * and let anything point at anything, which is how a business unit ended up
 * under a project and the structure report started recursing forever.
 */
const PARENT_RULES: Record<GenericKind, readonly GenericKind[]> = {
  division: [],
  business_unit: ["division"],
  sub_business_unit: ["business_unit"],
  functional_category: [],
  project: [],
  location: ["location"],
};

export class StructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructureError";
  }
}

/** Depth limit for the ancestry walk — a cycle must never hang a request. */
const MAX_DEPTH = 12;

export type UnitInput = {
  orgId: string;
  kind: GenericKind;
  code: string;
  name: string;
  nameNepali?: string | null;
  parentId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  country?: string | null;
  state?: string | null;
  sortOrder?: number;
  remarks?: string | null;
  isActive?: boolean;
};

/**
 * Validates the parent against the rules above and against cycles, then inserts.
 * Both checks happen inside the transaction that writes, because a check outside
 * one is a race.
 */
export async function createUnit(input: UnitInput): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    await assertParentAllowed(tx, input.orgId, input.kind, input.parentId ?? null, null);

    const [row] = await tx
      .insert(orgUnits)
      .values({
        orgId: input.orgId,
        kind: input.kind,
        code: input.code.trim(),
        name: input.name.trim(),
        nameNepali: input.nameNepali ?? null,
        parentId: input.parentId ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        country: input.country ?? null,
        state: input.state ?? null,
        sortOrder: input.sortOrder ?? 0,
        remarks: input.remarks ?? null,
        isActive: input.isActive ?? true,
      })
      .returning({ id: orgUnits.id });

    await publish(tx, {
      orgId: input.orgId,
      module: "org",
      name: "org.structure.changed",
      payload: { kind: input.kind, unitId: row.id, action: "created" },
    });

    return { id: row.id };
  });
}

export async function updateUnit(
  id: string,
  input: Omit<UnitInput, "kind"> & { kind: GenericKind },
): Promise<void> {
  await db.transaction(async (tx) => {
    await assertParentAllowed(tx, input.orgId, input.kind, input.parentId ?? null, id);

    await tx
      .update(orgUnits)
      .set({
        code: input.code.trim(),
        name: input.name.trim(),
        nameNepali: input.nameNepali ?? null,
        parentId: input.parentId ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        country: input.country ?? null,
        state: input.state ?? null,
        sortOrder: input.sortOrder ?? 0,
        remarks: input.remarks ?? null,
        // An edit leaves the active flag alone unless it was asked to change —
        // defaulting it to true here would quietly reactivate a retired unit
        // every time somebody corrected its name.
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      })
      .where(and(eq(orgUnits.id, id), eq(orgUnits.orgId, input.orgId)));

    await publish(tx, {
      orgId: input.orgId,
      module: "org",
      name: "org.structure.changed",
      payload: { kind: input.kind, unitId: id, action: "updated" },
    });
  });
}

/**
 * Deactivates rather than deletes. A unit referenced by an employee, a child, or
 * a historical assignment cannot be removed without losing the meaning of past
 * records — the legacy system deleted freely and left dangling ids behind.
 */
export async function deactivateUnit(orgId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const children = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(eq(orgUnits.parentId, id), eq(orgUnits.isActive, true)))
      .limit(1);
    if (children.length > 0) {
      throw new StructureError("Deactivate the units underneath this one first.");
    }

    await tx
      .update(orgUnits)
      .set({ isActive: false })
      .where(and(eq(orgUnits.id, id), eq(orgUnits.orgId, orgId)));

    await publish(tx, {
      orgId,
      module: "org",
      name: "org.structure.changed",
      payload: { unitId: id, action: "deactivated" },
    });
  });
}

async function assertParentAllowed(
  tx: Tx,
  orgId: string,
  kind: GenericKind,
  parentId: string | null,
  selfId: string | null,
): Promise<void> {
  const allowed = PARENT_RULES[kind];

  if (!parentId) {
    // Only kinds with no permitted parent may be roots; everything else needs one.
    if (allowed.length > 0) {
      throw new StructureError(`A ${label(kind)} must sit under a ${allowed.map(label).join(" or ")}.`);
    }
    return;
  }

  if (allowed.length === 0) {
    throw new StructureError(`A ${label(kind)} cannot have a parent.`);
  }
  if (selfId && parentId === selfId) {
    throw new StructureError("A unit cannot be its own parent.");
  }

  const [parent] = await tx
    .select({ id: orgUnits.id, kind: orgUnits.kind, orgId: orgUnits.orgId })
    .from(orgUnits)
    .where(eq(orgUnits.id, parentId))
    .limit(1);

  if (!parent) throw new StructureError("That parent no longer exists.");
  if (parent.orgId !== orgId) throw new StructureError("That parent belongs to another organisation.");
  if (!allowed.includes(parent.kind as GenericKind)) {
    throw new StructureError(
      `A ${label(kind)} cannot sit under a ${label(parent.kind as GenericKind)}.`,
    );
  }

  // Re-parenting must not create a cycle: walk up from the proposed parent and
  // refuse if we meet ourselves.
  if (selfId) {
    let cursor: string | null = parent.id;
    for (let depth = 0; cursor && depth < MAX_DEPTH; depth++) {
      if (cursor === selfId) throw new StructureError("That would put the unit inside itself.");
      const rows: { parentId: string | null }[] = await tx
        .select({ parentId: orgUnits.parentId })
        .from(orgUnits)
        .where(eq(orgUnits.id, cursor))
        .limit(1);
      cursor = rows[0]?.parentId ?? null;
    }
  }
}

export function label(kind: OrgUnitKind): string {
  return {
    division: "division",
    business_unit: "business unit",
    sub_business_unit: "sub business unit",
    functional_category: "functional category",
    project: "project",
    location: "location",
    department: "department",
    section: "section",
    branch: "branch",
  }[kind];
}

/* ------------------------------------------------------------------ reading */

/**
 * Reads any structural kind through one signature. Departments, sections and
 * branches come from their own tables; everything else from `org_units`. The
 * caller cannot tell, which is what lets the storage change later.
 */
export async function listUnits(orgId: string, kind: OrgUnitKind): Promise<OrgUnit[]> {
  if (kind === "department" || kind === "section") {
    const rows = await db
      .select({
        id: departments.id,
        code: departments.code,
        name: departments.name,
        parentId: departments.parentId,
        isActive: departments.isActive,
      })
      .from(departments)
      .where(
        and(
          eq(departments.orgId, orgId),
          notDeleted(departments),
          kind === "section" ? ne(departments.parentId, sql`NULL`) : isNull(departments.parentId),
        ),
      )
      .orderBy(asc(departments.code));
    return rows.map((r) => ({ ...r, kind }));
  }

  if (kind === "branch") {
    const rows = await db
      .select({
        id: branches.id,
        code: branches.code,
        name: branches.name,
        parentId: branches.parentId,
        isActive: branches.isActive,
      })
      .from(branches)
      .where(and(eq(branches.orgId, orgId), notDeleted(branches)))
      .orderBy(asc(branches.code));
    return rows.map((r) => ({ ...r, kind }));
  }

  const rows = await db
    .select({
      id: orgUnits.id,
      code: orgUnits.code,
      name: orgUnits.name,
      parentId: orgUnits.parentId,
      isActive: orgUnits.isActive,
    })
    .from(orgUnits)
    .where(and(eq(orgUnits.orgId, orgId), eq(orgUnits.kind, kind as GenericKind), isNull(orgUnits.deletedAt)))
    .orderBy(asc(orgUnits.sortOrder), asc(orgUnits.code));
  return rows.map((r) => ({ ...r, kind }));
}

/** A unit and its ancestors, nearest first. Bounded, so a cycle cannot hang it. */
export async function ancestryOf(orgId: string, unitId: string): Promise<OrgUnit[]> {
  const out: OrgUnit[] = [];
  let cursor: string | null = unitId;

  for (let depth = 0; cursor && depth < MAX_DEPTH; depth++) {
    const rows: {
      id: string;
      code: string;
      name: string;
      parentId: string | null;
      kind: GenericKind;
      isActive: boolean;
    }[] = await db
      .select({
        id: orgUnits.id,
        code: orgUnits.code,
        name: orgUnits.name,
        parentId: orgUnits.parentId,
        kind: orgUnits.kind,
        isActive: orgUnits.isActive,
      })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, cursor), eq(orgUnits.orgId, orgId)))
      .limit(1);

    const row = rows[0];
    if (!row) break;
    out.push(row);
    cursor = row.parentId;
  }

  return out;
}

/** How many employees point at each unit — shown before anybody deactivates one. */
export async function usageCounts(orgId: string, kind: OrgUnitKind): Promise<Map<string, number>> {
  const column = {
    division: employees.divisionId,
    business_unit: employees.businessUnitId,
    sub_business_unit: employees.businessUnitId,
    functional_category: employees.functionalCategoryId,
    project: employees.projectId,
    location: employees.locationId,
    department: employees.departmentId,
    section: employees.departmentId,
    branch: employees.branchId,
  }[kind];

  const rows = await db
    .select({ unitId: column, count: sql<number>`count(*)::int` })
    .from(employees)
    .where(eq(employees.orgId, orgId))
    .groupBy(column);

  const out = new Map<string, number>();
  for (const row of rows) if (row.unitId) out.set(row.unitId, row.count);
  return out;
}

/** Units referenced by at least one employee, for a bulk guard. */
export async function unitsInUse(orgId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({
      division: employees.divisionId,
      businessUnit: employees.businessUnitId,
      functional: employees.functionalCategoryId,
      project: employees.projectId,
      location: employees.locationId,
    })
    .from(employees)
    .where(
      and(
        eq(employees.orgId, orgId),
        or(
          inArray(employees.divisionId, ids),
          inArray(employees.businessUnitId, ids),
          inArray(employees.functionalCategoryId, ids),
          inArray(employees.projectId, ids),
          inArray(employees.locationId, ids),
        ),
      ),
    );

  const used = new Set<string>();
  for (const row of rows) {
    for (const value of Object.values(row)) if (value) used.add(value);
  }
  return used;
}

/* -------------------------------------------------- editing and retiring */

/** The employee column that places somebody in a unit of each kind, if any. */
const UNIT_EMPLOYEE_COLUMN: Partial<Record<GenericKind, PgColumn>> = {
  division: employees.divisionId,
  business_unit: employees.businessUnitId,
  functional_category: employees.functionalCategoryId,
  project: employees.projectId,
  location: employees.locationId,
};

/** Every column of a kind's units, for an edit form to prefill from. */
export async function listUnitRows(orgId: string, kind: GenericKind) {
  return db
    .select()
    .from(orgUnits)
    .where(and(eq(orgUnits.orgId, orgId), eq(orgUnits.kind, kind), isNull(orgUnits.deletedAt)))
    .orderBy(asc(orgUnits.sortOrder), asc(orgUnits.code));
}

/** Units with children, so the screen knows which ones cannot be deleted. */
export async function unitsWithChildren(orgId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ parentId: orgUnits.parentId })
    .from(orgUnits)
    .where(and(eq(orgUnits.orgId, orgId), ne(orgUnits.parentId, sql`NULL`), isNull(orgUnits.deletedAt)));
  return new Set(rows.map((r) => r.parentId).filter((v): v is string => !!v));
}

/**
 * Activates or deactivates. Deactivating refuses while active units sit
 * underneath or current staff are placed in it; reactivating refuses under a
 * parent that is itself switched off.
 */
export async function setUnitActive(orgId: string, id: string, active: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    const [unit] = await tx
      .select({ kind: orgUnits.kind, parentId: orgUnits.parentId })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, id), eq(orgUnits.orgId, orgId)))
      .limit(1);
    if (!unit) throw new StructureError("That unit no longer exists.");

    if (!active) {
      const children = await tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(and(eq(orgUnits.parentId, id), eq(orgUnits.isActive, true)))
        .limit(1);
      if (children.length > 0) throw new StructureError("Deactivate the units underneath this one first.");

      const column = UNIT_EMPLOYEE_COLUMN[unit.kind];
      if (column) {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(employees)
          .where(
            and(
              eq(column, id),
              onStrength(),
            ),
          );
        if (n > 0) {
          throw new StructureError(
            `${n} current ${n === 1 ? "employee is" : "employees are"} still placed in this ${label(unit.kind)}. Move them first.`,
          );
        }
      }
    } else if (unit.parentId) {
      const [parent] = await tx
        .select({ isActive: orgUnits.isActive })
        .from(orgUnits)
        .where(eq(orgUnits.id, unit.parentId))
        .limit(1);
      if (parent && !parent.isActive) throw new StructureError("Its parent is inactive. Reactivate the parent first.");
    }

    await tx.update(orgUnits).set({ isActive: active }).where(eq(orgUnits.id, id));
    await publish(tx, {
      orgId,
      module: "org",
      name: "org.structure.changed",
      payload: { unitId: id, action: active ? "reactivated" : "deactivated" },
    });
  });
}

/**
 * Moves a unit that nothing — no employee, past or present, and no child —
 * points at to the recycle bin. Restorable until purged.
 */
export async function deleteUnit(orgId: string, id: string, byLabel = "system"): Promise<void> {
  await db.transaction(async (tx) => {
    const [child] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(eq(orgUnits.parentId, id), isNull(orgUnits.deletedAt)))
      .limit(1);
    if (child) throw new StructureError("Units sit underneath this one. Deactivate it instead.");

    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(employees)
      .where(
        or(
          eq(employees.divisionId, id),
          eq(employees.businessUnitId, id),
          eq(employees.functionalCategoryId, id),
          eq(employees.projectId, id),
          eq(employees.locationId, id),
        ),
      );
    if (n > 0) {
      throw new StructureError(
        `${n} employee ${n === 1 ? "record points" : "records point"} at this unit. Deactivate it instead — history keeps its meaning.`,
      );
    }

    const deleted = await tx
      .update(orgUnits)
      .set({ deletedAt: new Date(), deletedBy: byLabel, isActive: false })
      .where(and(eq(orgUnits.id, id), eq(orgUnits.orgId, orgId), isNull(orgUnits.deletedAt)))
      .returning({ id: orgUnits.id });
    if (deleted.length === 0) throw new StructureError("That unit no longer exists.");

    await publish(tx, {
      orgId,
      module: "org",
      name: "org.structure.changed",
      payload: { unitId: id, action: "deleted" },
    });
  });
}

/** Brings a binned unit back, unless its code was reused meanwhile. */
export async function restoreUnit(orgId: string, id: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const restored = await tx
        .update(orgUnits)
        .set({ deletedAt: null, deletedBy: null, isActive: true })
        .where(and(eq(orgUnits.id, id), eq(orgUnits.orgId, orgId), isNotNull(orgUnits.deletedAt)))
        .returning({ id: orgUnits.id, parentId: orgUnits.parentId });
      if (restored.length === 0) throw new StructureError("That unit is not in the recycle bin.");
      const parentId = restored[0].parentId;
      if (parentId) {
        const [parent] = await tx
          .select({ deletedAt: orgUnits.deletedAt })
          .from(orgUnits)
          .where(eq(orgUnits.id, parentId))
          .limit(1);
        if (parent?.deletedAt) throw new StructureError("Its parent is in the recycle bin too. Restore the parent first.");
      }
      await publish(tx, {
        orgId,
        module: "org",
        name: "org.structure.changed",
        payload: { unitId: id, action: "restored" },
      });
    });
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    if ((e?.code ?? e?.cause?.code) === "23505") {
      throw new StructureError("Another unit of this kind now uses that code. Change its code first, then restore this one.");
    }
    throw error;
  }
}

/** Removes a binned unit for good. */
export async function purgeUnit(orgId: string, id: string): Promise<void> {
  const [child] = await db.select({ id: orgUnits.id }).from(orgUnits).where(eq(orgUnits.parentId, id)).limit(1);
  if (child) throw new StructureError("Other units still point at this one; it stays in the bin.");
  const gone = await db
    .delete(orgUnits)
    .where(and(eq(orgUnits.id, id), eq(orgUnits.orgId, orgId), isNotNull(orgUnits.deletedAt)))
    .returning({ id: orgUnits.id });
  if (gone.length === 0) throw new StructureError("That unit is not in the recycle bin.");
}
