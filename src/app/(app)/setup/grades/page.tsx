import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { grades } from "@/db/schema/org";
import { can, requirePermission } from "@/lib/session";
import { formatNpr } from "@/lib/utils";
import { usageFor } from "@/modules/org/masters";
import { PageHeader } from "@/components/ui";
import { MasterEditor, type EditorRow, type FieldDef } from "../master-editor";
import { ActiveBadge, deactivateBlockedReason, deleteBlockedReason } from "../page-parts";

export const metadata = { title: "Grades" };

export default async function GradesPage() {
  const viewer = await requirePermission("setup.structure.view");
  const [rows, usage] = await Promise.all([
    db.select().from(grades).where(eq(grades.orgId, viewer.orgId)).orderBy(asc(grades.hierarchyLevel), asc(grades.code)),
    usageFor(viewer.orgId, "grade"),
  ]);

  const fields: FieldDef[] = [
    { name: "code", label: "Code", kind: "text", required: true, maxLength: 20, mono: true, placeholder: "L4" },
    { name: "name", label: "Name", kind: "text", required: true, maxLength: 120, placeholder: "Level 4 — Officer" },
    {
      name: "hierarchyLevel",
      label: "Order",
      kind: "number",
      required: true,
      min: 1,
      max: 999,
      hint: "1 is the most senior grade.",
    },
    {
      name: "basicSalary",
      label: "Basic salary (NPR)",
      kind: "number",
      min: 0,
      step: "0.01",
      hint: "Monthly. The starting point payroll proposes for somebody placed in this grade.",
    },
  ];

  const editorRows: EditorRow[] = rows.map((r) => {
    const u = usage.get(r.id);
    return {
      id: r.id,
      code: r.code,
      isActive: r.isActive,
      search: [r.code, r.name].join(" ").toLowerCase(),
      deleteBlocked: deleteBlockedReason(u),
      deactivateBlocked: deactivateBlockedReason(u?.staff ?? 0),
      values: {
        code: r.code,
        name: r.name,
        hierarchyLevel: r.hierarchyLevel,
        basicSalary: r.basicSalary === null ? null : Number(r.basicSalary),
      },
      cells: [
        <span key="c" className="font-mono text-xs text-ink-soft">{r.code}</span>,
        <span key="n" className="font-medium text-ink">{r.name}</span>,
        <span key="l" className="tabular text-ink-soft">{r.hierarchyLevel}</span>,
        <span key="b" className="tabular">{r.basicSalary === null ? "—" : formatNpr(r.basicSalary)}</span>,
        <span key="s" className="tabular">{u?.staff ?? 0}</span>,
        <ActiveBadge key="a" active={r.isActive} />,
      ],
    };
  });

  return (
    <>
      <PageHeader title="Grades" description="Pay grades and the basic salary each one starts at, most senior first." />
      <MasterEditor
        kind="grade"
        noun="grade"
        plural="grades"
        path="/setup/grades"
        canManage={can(viewer, "setup.structure.manage")}
        columns={[
          { header: "Code" },
          { header: "Grade" },
          { header: "Order", align: "right" },
          { header: "Basic salary", align: "right" },
          { header: "Staff", align: "right" },
          { header: "Status" },
        ]}
        rows={editorRows}
        fields={fields}
        defaults={{ hierarchyLevel: 50 }}
      />
    </>
  );
}
