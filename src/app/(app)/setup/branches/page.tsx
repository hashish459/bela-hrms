import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { branches } from "@/db/schema/org";
import { can, requirePermission } from "@/lib/session";
import { usageFor } from "@/modules/org/masters";
import { Badge, PageHeader } from "@/components/ui";
import { MasterEditor, type EditorRow, type FieldDef } from "../master-editor";
import { ActiveBadge, buildTree, deactivateBlockedReason, deleteBlockedReason, indentOf, subtreeIds } from "../page-parts";

export const metadata = { title: "Branches" };

export default async function BranchesPage() {
  const viewer = await requirePermission("setup.structure.view");
  const [rows, usage] = await Promise.all([
    db.select().from(branches).where(eq(branches.orgId, viewer.orgId)).orderBy(asc(branches.code)),
    usageFor(viewer.orgId, "branch"),
  ]);

  const tree = buildTree(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));

  const fields: FieldDef[] = [
    { name: "code", label: "Code", kind: "text", required: true, maxLength: 20, mono: true, placeholder: "KTM" },
    { name: "name", label: "Name", kind: "text", required: true, maxLength: 120, placeholder: "Kathmandu Branch" },
    { name: "nameNepali", label: "Name (Nepali)", kind: "text", maxLength: 120, wide: true },
    {
      name: "parentId",
      label: "Reports to",
      kind: "select",
      emptyLabel: "None — a top-level branch",
      excludeTree: true,
      wide: true,
      hint: "Regional offices sit under the office that manages them.",
      options: rows.filter((r) => r.isActive).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` })),
    },
    { name: "address", label: "Address", kind: "text", maxLength: 200, wide: true },
    { name: "district", label: "District", kind: "text", maxLength: 60 },
    { name: "phone", label: "Phone", kind: "text", maxLength: 20, placeholder: "01-4xxxxxx" },
    {
      name: "isHeadOffice",
      label: "This is the head office",
      kind: "checkbox",
      hint: "There is always exactly one. Marking this branch moves the flag from whichever branch holds it now.",
    },
  ];

  const editorRows: EditorRow[] = tree.map(({ row: r, depth }) => {
    const u = usage.get(r.id);
    const activeChildren = rows.filter((c) => c.parentId === r.id && c.isActive).length;
    const parent = r.parentId ? byId.get(r.parentId) : null;
    return {
      id: r.id,
      code: r.code,
      isActive: r.isActive,
      search: [r.code, r.name, r.nameNepali, r.district, r.address].filter(Boolean).join(" ").toLowerCase(),
      tree: subtreeIds(rows, r.id),
      deleteBlocked: r.isHeadOffice ? "The head office — mark another branch as head office first" : deleteBlockedReason(u),
      deactivateBlocked: r.isHeadOffice
        ? "The head office — mark another branch as head office first"
        : deactivateBlockedReason(u?.staff ?? 0, activeChildren, "sub-branch"),
      values: {
        code: r.code,
        name: r.name,
        nameNepali: r.nameNepali,
        parentId: r.parentId,
        address: r.address,
        district: r.district,
        phone: r.phone,
        isHeadOffice: r.isHeadOffice,
      },
      cells: [
        <span key="c" className="font-mono text-xs text-ink-soft">{r.code}</span>,
        <span key="n" style={indentOf(depth)} className="flex items-center gap-2">
          {depth > 0 ? <span className="text-ink-faint">└</span> : null}
          <span>
            <span className="font-medium text-ink">{r.name}</span>
            {r.nameNepali ? <span className="block text-[11px] text-ink-faint">{r.nameNepali}</span> : null}
          </span>
          {r.isHeadOffice ? <Badge tone="accent">Head office</Badge> : null}
        </span>,
        <span key="p" className="text-xs text-ink-soft">{parent ? parent.name : "—"}</span>,
        <span key="d" className="text-ink-soft">{r.district ?? "—"}</span>,
        <span key="ph" className="tabular text-xs text-ink-soft">{r.phone ?? "—"}</span>,
        <span key="s" className="tabular">{u?.staff ?? 0}</span>,
        <ActiveBadge key="a" active={r.isActive} />,
      ],
    };
  });

  return (
    <>
      <PageHeader
        title="Branches"
        description="Offices, plants and depots, as a tree. Staff counts are people employed today; a branch still in use can be deactivated but not deleted."
      />
      <MasterEditor
        kind="branch"
        noun="branch"
        plural="branches"
        path="/setup/branches"
        canManage={can(viewer, "setup.structure.manage")}
        columns={[
          { header: "Code" },
          { header: "Branch" },
          { header: "Reports to" },
          { header: "District" },
          { header: "Phone" },
          { header: "Staff", align: "right" },
          { header: "Status" },
        ]}
        rows={editorRows}
        fields={fields}
        defaults={{ isHeadOffice: false }}
      />
    </>
  );
}
