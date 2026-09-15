import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { departments, designations } from "@/db/schema/org";
import { requirePermission } from "@/lib/session";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Reporting lines" };

type Node = {
  id: string;
  code: string;
  name: string;
  designation: string | null;
  department: string | null;
  supervisorId: string | null;
  children: Node[];
};

export default async function ReportingLinesPage() {
  const viewer = await requirePermission("hr.employee.view");

  const rows = await db
    .select({
      id: employees.id,
      code: employees.employeeCode,
      firstName: employees.firstName,
      lastName: employees.lastName,
      supervisorId: employees.supervisorId,
      designation: designations.name,
      department: departments.name,
    })
    .from(employees)
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(employees.orgId, viewer.orgId))
    .orderBy(asc(designations.hierarchyLevel), asc(employees.employeeCode));

  const byId = new Map<string, Node>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      code: r.code,
      name: `${r.firstName} ${r.lastName}`,
      designation: r.designation,
      department: r.department,
      supervisorId: r.supervisorId,
      children: [],
    });
  }

  const roots: Node[] = [];
  for (const node of byId.values()) {
    const parent = node.supervisorId ? byId.get(node.supervisorId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  const orphans = roots.filter((r) => r.supervisorId !== null);

  return (
    <>
      <PageHeader
        title="Reporting lines"
        description="Leave approvals walk this chain: level one is the direct supervisor, level two theirs."
      />

      {roots.length === 0 ? (
        <Card>
          <EmptyState title="No employees to chart" />
        </Card>
      ) : (
        <Card>
          <CardHeader title="Organisation" description={`${rows.length} people`} />
          <div className="overflow-x-auto p-4">
            <ul className="flex flex-col gap-1">
              {roots.map((n) => (
                <TreeNode key={n.id} node={n} depth={0} />
              ))}
            </ul>
          </div>
        </Card>
      )}

      {orphans.length > 0 ? (
        <Card className="mt-4 border-warn/40">
          <CardHeader
            title="Supervisor outside the current list"
            description="These people report to somebody who is not in this organisation."
          />
          <ul className="flex flex-wrap gap-1.5 p-4">
            {orphans.map((o) => (
              <li key={o.id}>
                <Badge tone="warn">{o.name}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function TreeNode({ node, depth }: { node: Node; depth: number }) {
  return (
    <li>
      <div
        className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-sunk"
        style={{ marginLeft: `${depth * 1.5}rem` }}
      >
        {depth > 0 ? <span className="text-ink-faint">└</span> : null}
        <Link href={`/hr/employees/${node.id}`} className="text-sm font-medium text-ink hover:text-accent">
          {node.name}
        </Link>
        <span className="font-mono text-[11px] text-ink-faint">{node.code}</span>
        {node.designation ? (
          <span className="text-xs text-ink-soft">{node.designation}</span>
        ) : null}
        {node.department ? (
          <span className="text-xs text-ink-faint">· {node.department}</span>
        ) : null}
        {node.children.length > 0 ? (
          <Badge tone="neutral">{node.children.length} report{node.children.length === 1 ? "" : "s"}</Badge>
        ) : null}
      </div>
      {node.children.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
