import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { branches } from "@/db/schema/org";
import { requirePermission } from "@/lib/session";
import { PageHeader, Badge } from "@/components/ui";
import { ActiveBadge, MasterTable, buildTree, indentOf } from "../page-parts";

export const metadata = { title: "Branches" };

export default async function BranchesPage() {
  const viewer = await requirePermission("setup.structure.view");
  const rows = await db
    .select()
    .from(branches)
    .where(eq(branches.orgId, viewer.orgId))
    .orderBy(asc(branches.code));

  const tree = buildTree(rows);

  return (
    <>
      <PageHeader
        title="Branches"
        description="Locations, as a tree. A root branch has no parent — a missing parent is impossible, not silently a root."
      />
      <MasterTable
        rows={tree.map((t) => ({ ...t.row, __depth: t.depth }))}
        empty="No branches defined"
        columns={[
          { header: "Code", cell: (r) => <span className="font-mono text-xs text-ink-soft">{r.code}</span> },
          {
            header: "Name",
            cell: (r) => (
              <span style={indentOf(r.__depth)} className="flex items-center gap-2">
                {r.__depth > 0 ? <span className="text-ink-faint">└</span> : null}
                <span className="font-medium text-ink">{r.name}</span>
                {r.isHeadOffice ? <Badge tone="accent">Head office</Badge> : null}
              </span>
            ),
          },
          { header: "Nepali", cell: (r) => <span className="text-ink-soft">{r.nameNepali ?? "—"}</span> },
          { header: "District", cell: (r) => <span className="text-ink-soft">{r.district ?? "—"}</span> },
          { header: "Address", cell: (r) => <span className="text-ink-soft">{r.address ?? "—"}</span> },
          { header: "Status", cell: (r) => <ActiveBadge active={r.isActive} /> },
        ]}
      />
    </>
  );
}
