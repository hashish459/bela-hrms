import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { departments } from "@/db/schema/org";
import { can, requirePermission } from "@/lib/session";
import { employedStaff, usageFor } from "@/modules/org/masters";
import { Badge, PageHeader } from "@/components/ui";
import { MasterEditor, type EditorRow, type FieldDef } from "../master-editor";
import { ActiveBadge, buildTree, deactivateBlockedReason, deleteBlockedReason, indentOf, subtreeIds } from "../page-parts";

export const metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  const viewer = await requirePermission("setup.structure.view");
  const [rows, usage, staff] = await Promise.all([
    db.select().from(departments).where(eq(departments.orgId, viewer.orgId)).orderBy(asc(departments.code)),
    usageFor(viewer.orgId, "department"),
    employedStaff(viewer.orgId),
  ]);

  const tree = buildTree(rows);
  const staffById = new Map(staff.map((s) => [s.id, s]));

  const fields: FieldDef[] = [
    { name: "code", label: "Code", kind: "text", required: true, maxLength: 20, mono: true, placeholder: "FIN" },
    { name: "name", label: "Name", kind: "text", required: true, maxLength: 120, placeholder: "Finance & Accounts" },
    { name: "nameNepali", label: "Name (Nepali)", kind: "text", maxLength: 120, wide: true },
    {
      name: "parentId",
      label: "Part of",
      kind: "select",
      emptyLabel: "None — this is a department",
      excludeTree: true,
      wide: true,
      hint: "Choose a department to make this a section of it.",
      options: rows.filter((r) => r.isActive).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` })),
    },
    {
      name: "headEmployeeId",
      label: "Head",
      kind: "select",
      emptyLabel: "Not assigned",
      wide: true,
      hint: "Receives the department's approvals where a policy routes to the head.",
      options: staff.map((s) => ({ value: s.id, label: `${s.name} · ${s.code}` })),
    },
  ];

  const editorRows: EditorRow[] = tree.map(({ row: r, depth }) => {
    const u = usage.get(r.id);
    const activeChildren = rows.filter((c) => c.parentId === r.id && c.isActive).length;
    const head = r.headEmployeeId ? staffById.get(r.headEmployeeId) : null;
    return {
      id: r.id,
      code: r.code,
      isActive: r.isActive,
      search: [r.code, r.name, r.nameNepali, head?.name].filter(Boolean).join(" ").toLowerCase(),
      tree: subtreeIds(rows, r.id),
      deleteBlocked: deleteBlockedReason(u),
      deactivateBlocked: deactivateBlockedReason(u?.staff ?? 0, activeChildren, "section"),
      values: {
        code: r.code,
        name: r.name,
        nameNepali: r.nameNepali,
        parentId: r.parentId,
        headEmployeeId: head ? r.headEmployeeId : null,
      },
      cells: [
        <span key="c" className="font-mono text-xs text-ink-soft">{r.code}</span>,
        <span key="n" style={indentOf(depth)} className="flex items-center gap-2">
          {depth > 0 ? <span className="text-ink-faint">└</span> : null}
          <span>
            <span className="font-medium text-ink">{r.name}</span>
            {r.nameNepali ? <span className="block text-[11px] text-ink-faint">{r.nameNepali}</span> : null}
          </span>
          {depth > 0 ? <Badge tone="neutral">Section</Badge> : null}
        </span>,
        head ? (
          <Link key="h" href={`/hr/employees/${head.id}`} className="text-accent hover:underline">
            {head.name}
          </Link>
        ) : r.headEmployeeId ? (
          <span key="h" className="text-xs text-warn" title="The recorded head is no longer employed">
            Head has left — reassign
          </span>
        ) : (
          <span key="h" className="text-ink-faint">Not assigned</span>
        ),
        <span key="s" className="tabular">{u?.staff ?? 0}</span>,
        <ActiveBadge key="a" active={r.isActive} />,
      ],
    };
  });

  return (
    <>
      <PageHeader
        title="Departments"
        description="Departments and the sections inside them. Staff counts are people employed today; one still in use can be deactivated but not deleted."
      />
      <MasterEditor
        kind="department"
        noun="department"
        plural="departments"
        path="/setup/departments"
        canManage={can(viewer, "setup.structure.manage")}
        columns={[
          { header: "Code" },
          { header: "Department" },
          { header: "Head" },
          { header: "Staff", align: "right" },
          { header: "Status" },
        ]}
        rows={editorRows}
        fields={fields}
      />
    </>
  );
}
