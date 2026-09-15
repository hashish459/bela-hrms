import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { branches, departments, designations, employmentTypes, grades } from "@/db/schema/org";
import { employees } from "@/db/schema/hr";

/** Every dropdown the employee form needs, in one round trip. */
export async function loadEmployeeFormOptions(orgId: string) {
  const [branchRows, deptRows, desigRows, typeRows, gradeRows, supervisorRows] = await Promise.all([
    db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.orgId, orgId)).orderBy(asc(branches.name)),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.orgId, orgId)).orderBy(asc(departments.name)),
    db.select({ id: designations.id, name: designations.name }).from(designations).where(eq(designations.orgId, orgId)).orderBy(asc(designations.hierarchyLevel)),
    db.select({ id: employmentTypes.id, name: employmentTypes.name }).from(employmentTypes).where(eq(employmentTypes.orgId, orgId)).orderBy(asc(employmentTypes.name)),
    db.select({ id: grades.id, name: grades.name }).from(grades).where(eq(grades.orgId, orgId)).orderBy(asc(grades.hierarchyLevel)),
    db
      .select({
        id: employees.id,
        name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName} || ' (' || ${employees.employeeCode} || ')'`,
      })
      .from(employees)
      .where(eq(employees.orgId, orgId))
      .orderBy(asc(employees.employeeCode)),
  ]);

  return {
    branches: branchRows,
    departments: deptRows,
    designations: desigRows,
    employmentTypes: typeRows,
    grades: gradeRows,
    supervisors: supervisorRows,
  };
}
