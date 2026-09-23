import "server-only";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { user } from "@/db/schema/auth";
import { userAccounts } from "@/db/schema/core";
import { employees } from "@/db/schema/hr";
import { branches, departments, designations, employmentTypes, grades } from "@/db/schema/org";
import { orgUnits } from "@/db/schema/org-structure";
import { employeeDocuments, employeeExperience, employeeFamily, employeeQualifications } from "@/db/schema/selfservice";
import { cacheTags, invalidate } from "@/kernel/cache";
import { dropIfUnreferenced } from "@/lib/storage";
import { purgeMaster, restoreMaster, type MasterKind } from "@/modules/org/masters";
import { purgeUnit, restoreUnit } from "@/modules/org/structure";
import { purgeEmployee, RecordError, restoreEmployee } from "@/modules/people/records";

/**
 * The recycle bin: one place to see everything soft-deleted in the system, and
 * to put it back or remove it for good.
 *
 * Each type knows how to list its binned rows and how to restore and purge
 * them; the rules for *whether* a purge is allowed live with the owning module
 * (an employee with history cannot be purged; a master still referenced cannot
 * be). This file only routes.
 */

export type BinType =
  | "user"
  | "employee"
  | "document"
  | "family"
  | "qualification"
  | "experience"
  | MasterKind
  | "org_unit";

export const BIN_TYPES: { key: BinType; label: string }[] = [
  { key: "user", label: "Logins" },
  { key: "employee", label: "Employee records" },
  { key: "document", label: "Documents" },
  { key: "family", label: "Family members" },
  { key: "qualification", label: "Qualifications" },
  { key: "experience", label: "Previous employment" },
  { key: "branch", label: "Branches" },
  { key: "department", label: "Departments" },
  { key: "designation", label: "Designations" },
  { key: "grade", label: "Grades" },
  { key: "employment_type", label: "Employment types" },
  { key: "org_unit", label: "Structure units" },
];

export type BinItem = {
  type: BinType;
  id: string;
  label: string;
  detail: string | null;
  deletedAt: Date;
  deletedBy: string | null;
};

const MASTER_TABLE = {
  branch: branches,
  department: departments,
  designation: designations,
  grade: grades,
  employment_type: employmentTypes,
} as const;

const fullName = sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`;

async function listType(orgId: string, type: BinType): Promise<BinItem[]> {
  switch (type) {
    case "user": {
      const rows = await db
        .select({ id: user.id, name: user.name, email: user.email, deletedAt: userAccounts.deletedAt, deletedBy: userAccounts.deletedBy })
        .from(userAccounts)
        .innerJoin(user, eq(user.id, userAccounts.userId))
        .where(and(eq(userAccounts.orgId, orgId), isNotNull(userAccounts.deletedAt)));
      return rows.map((r) => ({ type, id: r.id, label: r.name, detail: r.email, deletedAt: r.deletedAt!, deletedBy: r.deletedBy }));
    }
    case "employee": {
      const rows = await db
        .select({ id: employees.id, name: fullName, code: employees.employeeCode, deletedAt: employees.deletedAt, deletedBy: employees.deletedBy })
        .from(employees)
        .where(and(eq(employees.orgId, orgId), isNotNull(employees.deletedAt)));
      return rows.map((r) => ({ type, id: r.id, label: r.name, detail: r.code, deletedAt: r.deletedAt!, deletedBy: r.deletedBy }));
    }
    case "document": {
      const rows = await db
        .select({
          id: employeeDocuments.id,
          title: employeeDocuments.title,
          owner: fullName,
          deletedAt: employeeDocuments.deletedAt,
          deletedBy: employeeDocuments.deletedBy,
        })
        .from(employeeDocuments)
        .innerJoin(employees, eq(employees.id, employeeDocuments.employeeId))
        .where(and(eq(employeeDocuments.orgId, orgId), isNotNull(employeeDocuments.deletedAt)));
      return rows.map((r) => ({ type, id: r.id, label: r.title, detail: r.owner, deletedAt: r.deletedAt!, deletedBy: r.deletedBy }));
    }
    case "family":
    case "qualification":
    case "experience": {
      const table = { family: employeeFamily, qualification: employeeQualifications, experience: employeeExperience }[type] as typeof employeeExperience;
      const title =
        type === "family" ? employeeFamily.fullName : type === "qualification" ? employeeQualifications.title : employeeExperience.employer;
      const rows = await db
        .select({ id: table.id, title: sql<string>`${title}`, owner: fullName, deletedAt: table.deletedAt, deletedBy: table.deletedBy })
        .from(table)
        .innerJoin(employees, eq(employees.id, table.employeeId))
        .where(and(eq(table.orgId, orgId), isNotNull(table.deletedAt)));
      return rows.map((r) => ({ type, id: r.id, label: r.title, detail: r.owner, deletedAt: r.deletedAt!, deletedBy: r.deletedBy }));
    }
    case "org_unit": {
      const rows = await db
        .select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code, kind: orgUnits.kind, deletedAt: orgUnits.deletedAt, deletedBy: orgUnits.deletedBy })
        .from(orgUnits)
        .where(and(eq(orgUnits.orgId, orgId), isNotNull(orgUnits.deletedAt)));
      return rows.map((r) => ({
        type,
        id: r.id,
        label: r.name,
        detail: `${r.kind.replace(/_/g, " ")} · ${r.code}`,
        deletedAt: r.deletedAt!,
        deletedBy: r.deletedBy,
      }));
    }
    default: {
      const table = MASTER_TABLE[type] as typeof designations;
      const rows = await db
        .select({ id: table.id, name: table.name, code: table.code, deletedAt: table.deletedAt, deletedBy: table.deletedBy })
        .from(table)
        .where(and(eq(table.orgId, orgId), isNotNull(table.deletedAt)));
      return rows.map((r) => ({ type, id: r.id, label: r.name, detail: r.code, deletedAt: r.deletedAt!, deletedBy: r.deletedBy }));
    }
  }
}

export async function listBin(orgId: string, type: BinType | null) {
  const types = type ? [type] : BIN_TYPES.map((t) => t.key);
  const lists = await Promise.all(types.map((t) => listType(orgId, t)));
  return lists.flat().sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
}

/** How many binned items of each type, for the filter chips. */
export async function binCounts(orgId: string): Promise<Map<BinType, number>> {
  const all = await listBin(orgId, null);
  const out = new Map<BinType, number>();
  for (const item of all) out.set(item.type, (out.get(item.type) ?? 0) + 1);
  return out;
}

export async function restoreItem(orgId: string, type: BinType, id: string): Promise<string> {
  switch (type) {
    case "user": {
      const rows = await db
        .update(userAccounts)
        .set({ deletedAt: null, deletedBy: null, isActive: true })
        .where(and(eq(userAccounts.userId, id), eq(userAccounts.orgId, orgId), isNotNull(userAccounts.deletedAt)))
        .returning({ userId: userAccounts.userId });
      if (!rows.length) throw new RecordError("That login is not in the recycle bin.");
      invalidate(cacheTags.authz);
      return "Login restored and enabled. Its roles are as they were.";
    }
    case "employee":
      await restoreEmployee(orgId, id);
      return "Employee record restored. Restore their login separately if they had one.";
    case "document":
    case "family":
    case "qualification":
    case "experience": {
      const table = {
        document: employeeDocuments,
        family: employeeFamily,
        qualification: employeeQualifications,
        experience: employeeExperience,
      }[type] as typeof employeeExperience;
      const rows = await db
        .update(table)
        .set({ deletedAt: null, deletedBy: null })
        .where(and(eq(table.id, id), eq(table.orgId, orgId), isNotNull(table.deletedAt)))
        .returning({ employeeId: table.employeeId });
      if (!rows.length) throw new RecordError("That entry is not in the recycle bin.");
      // an entry on a record that is itself binned comes back with the record
      const [owner] = await db
        .select({ deletedAt: employees.deletedAt })
        .from(employees)
        .where(eq(employees.id, rows[0].employeeId))
        .limit(1);
      return owner?.deletedAt ? "Restored — it shows once the employee record is restored too." : "Restored.";
    }
    case "org_unit":
      await restoreUnit(orgId, id);
      invalidate(cacheTags.masters(orgId));
      return "Unit restored.";
    default:
      await restoreMaster(orgId, type, id);
      invalidate(cacheTags.masters(orgId));
      return "Restored and active again.";
  }
}

export async function purgeItem(orgId: string, type: BinType, id: string): Promise<string> {
  switch (type) {
    case "user": {
      const [account] = await db
        .select({ userId: userAccounts.userId })
        .from(userAccounts)
        .where(and(eq(userAccounts.userId, id), eq(userAccounts.orgId, orgId), isNotNull(userAccounts.deletedAt)))
        .limit(1);
      if (!account) throw new RecordError("That login is not in the recycle bin.");
      // Cascades to its sessions, credentials, roles and notifications; the audit
      // trail keeps the actor's name.
      await db.delete(user).where(eq(user.id, id));
      invalidate(cacheTags.authz);
      return "Login purged. Its email address can be used again.";
    }
    case "employee":
      await purgeEmployee(orgId, id);
      return "Employee record purged.";
    case "document": {
      const [doc] = await db
        .delete(employeeDocuments)
        .where(and(eq(employeeDocuments.id, id), eq(employeeDocuments.orgId, orgId), isNotNull(employeeDocuments.deletedAt)))
        .returning({ fileId: employeeDocuments.fileId });
      if (!doc) throw new RecordError("That document is not in the recycle bin.");
      await dropIfUnreferenced(doc.fileId);
      return "Document and its file purged.";
    }
    case "family":
    case "qualification":
    case "experience": {
      const table = { family: employeeFamily, qualification: employeeQualifications, experience: employeeExperience }[type] as typeof employeeExperience;
      const gone = await db
        .delete(table)
        .where(and(eq(table.id, id), eq(table.orgId, orgId), isNotNull(table.deletedAt)))
        .returning({ id: table.id });
      if (!gone.length) throw new RecordError("That entry is not in the recycle bin.");
      return "Purged.";
    }
    case "org_unit":
      await purgeUnit(orgId, id);
      return "Unit purged.";
    default:
      await purgeMaster(orgId, type, id);
      return "Purged.";
  }
}
