import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, onStrength } from "@/db/schema/hr";
import { departments } from "@/db/schema/org";
import { adToBs, todayInNepal } from "@/lib/bs";
import { bsMonthBounds, type BsMonth } from "@/components/bs-month-nav";
import type { RecordFilter } from "@/modules/workbook/service";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the reviewer's filters from the query string — the same parameters on
 * the records page, its CSV export and the insights page, so a link carries
 * its view. Anything malformed falls back rather than reaching SQL.
 */
export function readFilter(params: Params): { month: BsMonth; filter: RecordFilter } {
  const now = adToBs(todayInNepal());
  const y = Number(one(params.y));
  const m = Number(one(params.m));
  const month = y >= 2000 && y <= 2100 && m >= 1 && m <= 12 ? { year: y, month: m } : { year: now.year, month: now.month };
  const { from, to } = bsMonthBounds(month);
  const dept = one(params.dept);
  const emp = one(params.emp);
  const status = one(params.status);
  const q = one(params.q)?.trim().slice(0, 100);
  return {
    month,
    filter: {
      from,
      to,
      departmentId: dept && UUID.test(dept) ? dept : null,
      employeeId: emp && UUID.test(emp) ? emp : null,
      status: status === "draft" || status === "submitted" ? status : null,
      q: q || null,
    },
  };
}

/** Departments and people for the filter selects. */
export async function filterOptions(orgId: string) {
  const [depts, people] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.orgId, orgId), eq(departments.isActive, true)))
      .orderBy(asc(departments.name)),
    db
      .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName, code: employees.employeeCode })
      .from(employees)
      .where(and(eq(employees.orgId, orgId), onStrength()))
      .orderBy(asc(employees.firstName), asc(employees.lastName)),
  ]);
  return { depts, people };
}
