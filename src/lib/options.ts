import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { notDeleted } from "@/db/schema/columns";
import { branches, departments, designations, employmentTypes, grades } from "@/db/schema/org";
import { employees, liveEmployee } from "@/db/schema/hr";
import { cached, cacheTags } from "@/kernel/cache";

export type Option = { id: string; name: string };

/**
 * Every dropdown the employee form needs, in one round trip.
 *
 * Cached per organisation: six queries on every form open, for lists that
 * change when somebody edits a master or hires someone. Master writes drop
 * `cacheTags.masters`, employee writes `cacheTags.people`.
 */
export function loadEmployeeFormOptions(orgId: string) {
  return cached(
    `employee-form-options:${orgId}`,
    async () => {
      const live = <T extends typeof branches | typeof departments | typeof designations | typeof employmentTypes | typeof grades>(t: T) =>
        // inactive rows stay: an employee already placed in one must not have
        // the edit form silently clear it
        and(eq(t.orgId, orgId), notDeleted(t));

      const [branchRows, deptRows, desigRows, typeRows, gradeRows, supervisorRows] = await Promise.all([
        db.select({ id: branches.id, name: branches.name }).from(branches).where(live(branches)).orderBy(asc(branches.name)),
        db.select({ id: departments.id, name: departments.name }).from(departments).where(live(departments)).orderBy(asc(departments.name)),
        db.select({ id: designations.id, name: designations.name }).from(designations).where(live(designations)).orderBy(asc(designations.hierarchyLevel)),
        db.select({ id: employmentTypes.id, name: employmentTypes.name }).from(employmentTypes).where(live(employmentTypes)).orderBy(asc(employmentTypes.name)),
        db.select({ id: grades.id, name: grades.name }).from(grades).where(live(grades)).orderBy(asc(grades.hierarchyLevel)),
        db
          .select({
            id: employees.id,
            name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName} || ' (' || ${employees.employeeCode} || ')'`,
          })
          .from(employees)
          .where(and(eq(employees.orgId, orgId), liveEmployee()))
          .orderBy(asc(employees.employeeCode)),
      ]);

      return {
        branches: branchRows as Option[],
        departments: deptRows as Option[],
        designations: desigRows as Option[],
        employmentTypes: typeRows as Option[],
        grades: gradeRows as Option[],
        supervisors: supervisorRows as Option[],
      };
    },
    { ttl: 300, tags: [cacheTags.masters(orgId), cacheTags.people(orgId), cacheTags.org(orgId)] },
  );
}
