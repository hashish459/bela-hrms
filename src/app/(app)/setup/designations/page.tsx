import { and, asc, eq } from "drizzle-orm";
import { notDeleted } from "@/db/schema/columns";
import { db } from "@/db/client";
import { designations } from "@/db/schema/org";
import { can, requirePermission } from "@/lib/session";
import { usageFor } from "@/modules/org/masters";
import { PageHeader } from "@/components/ui";
import { MasterEditor, type EditorRow, type FieldDef } from "../master-editor";
import { ActiveBadge, deactivateBlockedReason, deleteBlockedReason } from "../page-parts";

export const metadata = { title: "Designations" };

export default async function DesignationsPage() {
  const viewer = await requirePermission("setup.structure.view");
  const [rows, usage] = await Promise.all([
    db
      .select()
      .from(designations)
      .where(and(eq(designations.orgId, viewer.orgId), notDeleted(designations)))
      .orderBy(asc(designations.hierarchyLevel), asc(designations.code)),
    usageFor(viewer.orgId, "designation"),
  ]);

  const fields: FieldDef[] = [
    { name: "code", label: "Code", kind: "text", required: true, maxLength: 20, mono: true, placeholder: "SO" },
    { name: "name", label: "Title", kind: "text", required: true, maxLength: 120, placeholder: "Senior Officer" },
    { name: "nameNepali", label: "Title (Nepali)", kind: "text", maxLength: 120 },
    {
      name: "hierarchyLevel",
      label: "Seniority",
      kind: "number",
      required: true,
      min: 1,
      max: 999,
      hint: "1 is the most senior. Orders the list and seniority reports.",
    },
  ];

  const editorRows: EditorRow[] = rows.map((r) => {
    const u = usage.get(r.id);
    return {
      id: r.id,
      code: r.code,
      isActive: r.isActive,
      search: [r.code, r.name, r.nameNepali].filter(Boolean).join(" ").toLowerCase(),
      deleteBlocked: deleteBlockedReason(u),
      deactivateBlocked: deactivateBlockedReason(u?.staff ?? 0),
      values: { code: r.code, name: r.name, nameNepali: r.nameNepali, hierarchyLevel: r.hierarchyLevel },
      cells: [
        <span key="c" className="font-mono text-xs text-ink-soft">{r.code}</span>,
        <span key="n" className="font-medium text-ink">{r.name}</span>,
        <span key="np" className="text-ink-soft">{r.nameNepali ?? "—"}</span>,
        <span key="l" className="tabular text-ink-soft">{r.hierarchyLevel}</span>,
        <span key="s" className="tabular">{u?.staff ?? 0}</span>,
        <ActiveBadge key="a" active={r.isActive} />,
      ],
    };
  });

  return (
    <>
      <PageHeader
        title="Designations"
        description="Ranks, most senior first. Staff counts are people employed today."
      />
      <MasterEditor
        kind="designation"
        noun="designation"
        plural="designations"
        path="/setup/designations"
        canManage={can(viewer, "setup.structure.manage")}
        columns={[
          { header: "Code" },
          { header: "Title" },
          { header: "Nepali" },
          { header: "Seniority", align: "right" },
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
