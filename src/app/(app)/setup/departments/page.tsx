import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { departments } from "@/db/schema/org";
import { EMPLOYED_STATUSES } from "@/db/schema/hr";
import { requirePermission } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { ActiveBadge, MasterTable, buildTree, indentOf } from "../page-parts";

export const metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  const viewer = await requirePermission("setup.structure.view");

  const rows = await db
    .select({
      id: departments.id,
      code: departments.code,
      name: departments.name,
      nameNepali: departments.nameNepali,
      parentId: departments.parentId,
      isActive: departments.isActive,
      headEmployeeId: departments.headEmployeeId,
      headName: sql<string | null>`head.first_name || ' ' || head.last_name`,
      headcount: sql<number>`(
        select count(*)::int from employees e
        where e.department_id = ${departments.id}
          and e.status = any(${sql.raw(`ARRAY['${EMPLOYED_STATUSES.join("','")}']::employee_status[]`)})
      )`,
    })
    .from(departments)
    .leftJoin(sql`employees head`, sql`head.id = ${departments.headEmployeeId}`)
    .where(eq(departments.orgId, viewer.orgId))
    .orderBy(asc(departments.code));

  const tree = buildTree(rows);

  return (
    <>
      <PageHeader title="Departments" description="Headcount counts currently employed staff only." />
      <MasterTable
        rows={tree.map((t) => ({ ...t.row, __depth: t.depth }))}
        empty="No departments defined"
        columns={[
          { header: "Code", cell: (r) => <span className="font-mono text-xs text-ink-soft">{r.code}</span> },
          {
            header: "Name",
            cell: (r) => (
              <span style={indentOf(r.__depth)} className="font-medium text-ink">
                {r.name}
              </span>
            ),
          },
          { header: "Nepali", cell: (r) => <span className="text-ink-soft">{r.nameNepali ?? "—"}</span> },
          {
            header: "Head",
            cell: (r) =>
              r.headEmployeeId ? (
                <Link href={`/hr/employees/${r.headEmployeeId}`} className="text-accent hover:underline">
                  {r.headName}
                </Link>
              ) : (
                <span className="text-ink-faint">Not assigned</span>
              ),
          },
          { header: "Headcount", align: "right", cell: (r) => <span className="tabular">{r.headcount}</span> },
          { header: "Status", cell: (r) => <ActiveBadge active={r.isActive} /> },
        ]}
      />
    </>
  );
}
