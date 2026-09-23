import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employmentTypes } from "@/db/schema/org";
import { can, requirePermission } from "@/lib/session";
import { usageFor } from "@/modules/org/masters";
import { Badge, PageHeader } from "@/components/ui";
import { MasterEditor, type EditorRow, type FieldDef } from "../master-editor";
import { ActiveBadge, deactivateBlockedReason, deleteBlockedReason } from "../page-parts";

export const metadata = { title: "Employment types" };

export default async function EmploymentTypesPage() {
  const viewer = await requirePermission("setup.structure.view");
  const [rows, usage] = await Promise.all([
    db.select().from(employmentTypes).where(eq(employmentTypes.orgId, viewer.orgId)).orderBy(asc(employmentTypes.code)),
    usageFor(viewer.orgId, "employment_type"),
  ]);

  const fields: FieldDef[] = [
    { name: "code", label: "Code", kind: "text", required: true, maxLength: 20, mono: true, placeholder: "CONT" },
    { name: "name", label: "Name", kind: "text", required: true, maxLength: 120, placeholder: "Contract" },
    {
      name: "accruesLeave",
      label: "Accrues leave",
      kind: "checkbox",
      hint: "Unticked for interns and daily-wage staff, who are granted leave case by case rather than earning it.",
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
      values: { code: r.code, name: r.name, accruesLeave: r.accruesLeave },
      cells: [
        <span key="c" className="font-mono text-xs text-ink-soft">{r.code}</span>,
        <span key="n" className="font-medium text-ink">{r.name}</span>,
        r.accruesLeave ? <Badge key="l" tone="ok">Accrues leave</Badge> : <Badge key="l">No accrual</Badge>,
        <span key="s" className="tabular">{u?.staff ?? 0}</span>,
        <ActiveBadge key="a" active={r.isActive} />,
      ],
    };
  });

  return (
    <>
      <PageHeader
        title="Employment types"
        description="The contract somebody is on. Leave entitlement rules key off these, so a type in use can be deactivated but not deleted."
      />
      <MasterEditor
        kind="employment_type"
        noun="employment type"
        plural="employment types"
        path="/setup/employment-types"
        canManage={can(viewer, "setup.structure.manage")}
        columns={[{ header: "Code" }, { header: "Type" }, { header: "Leave" }, { header: "Staff", align: "right" }, { header: "Status" }]}
        rows={editorRows}
        fields={fields}
        defaults={{ accruesLeave: true }}
      />
    </>
  );
}
