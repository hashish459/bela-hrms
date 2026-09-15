import "server-only";

import { and, asc, eq, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { register } from "@/kernel/registry";
import type { PeoplePort, PersonSummary, SupervisorLink } from "@/kernel/ports";

/**
 * The people module: the employee master, exposed read-only to everything else.
 *
 * It has no `requires`, which is deliberate — people is a leaf. If it needed
 * attendance or leave to answer a question, every module would transitively
 * depend on every other and the boundaries would be decorative.
 */

async function supervisorChain(employeeId: string, levels: number): Promise<SupervisorLink[]> {
  const chain: SupervisorLink[] = [];
  let currentId: string | null = employeeId;
  const seen = new Set<string>([employeeId]);

  for (let level = 1; level <= levels; level++) {
    if (!currentId) {
      chain.push({ level, approverEmployeeId: null, label: "Unassigned — needs HR" });
      continue;
    }

    // annotated because `currentId` is reassigned from this result, which makes
    // the inference circular
    const rows: { supervisorId: string | null }[] = await db
      .select({ supervisorId: employees.supervisorId })
      .from(employees)
      .where(eq(employees.id, currentId))
      .limit(1);

    const next: string | null = rows[0]?.supervisorId ?? null;

    // a cycle in the reporting chain must not hang the loop
    if (next && seen.has(next)) {
      chain.push({ level, approverEmployeeId: null, label: "Reporting loop — needs HR" });
      currentId = null;
      continue;
    }
    if (next) seen.add(next);

    chain.push({
      level,
      approverEmployeeId: next,
      label: level === 1 ? "Reporting supervisor" : `Level ${level} approver`,
    });
    currentId = next;
  }

  return chain;
}

/** Statuses that mean the person has left. Everything else is still on strength. */
const SEPARATED: (typeof employees.$inferSelect)["status"][] = [
  "resigned",
  "terminated",
  "retired",
];

function toSummary(row: typeof employees.$inferSelect): PersonSummary {
  return {
    id: row.id,
    code: row.employeeCode,
    fullName: [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" "),
    branchId: row.branchId,
    departmentId: row.departmentId,
    employmentTypeId: row.employmentTypeId,
    gender: row.gender,
    joinDate: row.dateOfJoin,
    isActive: !SEPARATED.includes(row.status),
  };
}

export const peoplePort: PeoplePort = {
  supervisorChain,

  async get(employeeId) {
    const [row] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
    return row ? toSummary(row) : null;
  },

  async list(orgId, filter) {
    const rows = await db
      .select()
      .from(employees)
      .where(
        filter?.activeOnly
          ? and(eq(employees.orgId, orgId), notInArray(employees.status, SEPARATED))
          : eq(employees.orgId, orgId),
      )
      .orderBy(asc(employees.employeeCode));
    return rows.map(toSummary);
  },
};

register({
  id: "people",
  version: "1.0.0",
  port: () => peoplePort,
});
