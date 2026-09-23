import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, EMPLOYED_STATUSES } from "@/db/schema/hr";
import { departments, designations } from "@/db/schema/org";
import { can, requirePermission } from "@/lib/session";
import { Card, PageHeader, StatTile } from "@/components/ui";
import { OrgChart, type ChartPerson } from "./org-chart";

export const metadata = { title: "Reporting lines" };

/**
 * Who reports to whom.
 *
 * This is not a diagram for a wall. Leave approval routing walks this chain, so
 * an employee with no supervisor is an employee whose leave request has nowhere
 * to go — which is why "unassigned" is a number on this page rather than
 * something you notice when somebody complains their request has been sitting
 * for a week.
 *
 * Only people still on strength are charted. A resigned manager left in the
 * tree would keep collecting approvals nobody is going to action.
 */
export default async function ReportingLinesPage() {
  const viewer = await requirePermission("hr.employee.view");

  const rows = await db
    .select({
      id: employees.id,
      code: employees.employeeCode,
      firstName: employees.firstName,
      lastName: employees.lastName,
      photoFileId: employees.photoFileId,
      supervisorId: employees.supervisorId,
      status: employees.status,
      designation: designations.name,
      department: departments.name,
    })
    .from(employees)
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(
      sql`${employees.orgId} = ${viewer.orgId} AND ${inArray(employees.status, [...EMPLOYED_STATUSES])}`,
    )
    .orderBy(asc(designations.hierarchyLevel), asc(employees.employeeCode));

  const people: ChartPerson[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: `${r.firstName} ${r.lastName}`,
    photoFileId: r.photoFileId,
    designation: r.designation,
    department: r.department,
    supervisorId: r.supervisorId,
    status: r.status,
  }));

  const ids = new Set(people.map((p) => p.id));
  const unassigned = people.filter((p) => !p.supervisorId).length;
  // A supervisor who is no longer on strength, or in another organisation. The
  // chain stops dead there, so it counts as broken rather than as a root.
  const dangling = people.filter((p) => p.supervisorId && !ids.has(p.supervisorId)).length;
  const managers = new Set(people.map((p) => p.supervisorId).filter(Boolean)).size;

  return (
    <>
      <PageHeader
        title="Reporting lines"
        description="Leave approvals walk this chain: level one is the direct supervisor, level two theirs."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="On strength" value={people.length} sub="charted" tone="accent" />
        <StatTile label="Managers" value={managers} sub="with at least one report" tone="info" />
        <StatTile
          label="No supervisor"
          value={unassigned}
          sub="leave has nowhere to route"
          tone={unassigned > 0 ? "warn" : "ok"}
        />
        <StatTile
          label="Broken links"
          value={dangling}
          sub="supervisor has left"
          tone={dangling > 0 ? "danger" : "neutral"}
        />
      </div>

      <Card className="mt-4">
        <OrgChart people={people} canEdit={can(viewer, "hr.employee.update")} />
      </Card>
    </>
  );
}
