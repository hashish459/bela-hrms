import "server-only";

import { and, asc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, EMPLOYED_STATUSES } from "@/db/schema/hr";
import { branches, departments, designations } from "@/db/schema/org";
import type { ReportFilters } from "./period";

/**
 * Who a report is about — shared by every report family.
 *
 * Anybody employed for at least one day of the period, which includes people
 * who have since left: a report on Shrawan has to show the person who resigned
 * in Bhadra, or Shrawan's figures change depending on when the report is run.
 *
 * One query, used by attendance and leave alike, so "24 employees" means the
 * same 24 people on both.
 */
export type ScopedEmployee = {
  id: string;
  code: string;
  name: string;
  dateOfJoin: string;
  separationDate: string | null;
  departmentId: string | null;
  department: string | null;
  branchId: string | null;
  branch: string | null;
  designation: string | null;
};

export async function employeesInScope(
  orgId: string,
  from: string,
  to: string,
  filters: ReportFilters,
): Promise<ScopedEmployee[]> {
  // escape LIKE metacharacters so a search for "50%" is not a wildcard
  const like = filters.q ? `%${filters.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
  const fullName = sql`${employees.firstName} || ' ' || ${employees.lastName}`;

  return db
    .select({
      id: employees.id,
      code: employees.employeeCode,
      name: sql<string>`${fullName}`,
      dateOfJoin: employees.dateOfJoin,
      separationDate: employees.separationDate,
      departmentId: employees.departmentId,
      department: departments.name,
      branchId: employees.branchId,
      branch: branches.name,
      designation: designations.name,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(
      and(
        eq(employees.orgId, orgId),
        isNull(employees.deletedAt),
        lte(employees.dateOfJoin, to),
        or(isNull(employees.separationDate), gte(employees.separationDate, from)),
        or(inArray(employees.status, [...EMPLOYED_STATUSES]), gte(employees.separationDate, from)),
        filters.departmentId ? eq(employees.departmentId, filters.departmentId) : undefined,
        filters.branchId ? eq(employees.branchId, filters.branchId) : undefined,
        like ? or(ilike(employees.employeeCode, like), ilike(fullName, like)) : undefined,
      ),
    )
    .orderBy(asc(employees.employeeCode));
}
