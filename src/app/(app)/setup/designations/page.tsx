import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { designations } from "@/db/schema/org";
import { EMPLOYED_STATUSES } from "@/db/schema/hr";
import { requirePermission } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { ActiveBadge, MasterTable } from "../page-parts";

export const metadata = { title: "Designations" };

export default async function DesignationsPage() {
  const viewer = await requirePermission("setup.structure.view");

  const rows = await db
    .select({
      id: designations.id,
      code: designations.code,
      name: designations.name,
      nameNepali: designations.nameNepali,
      hierarchyLevel: designations.hierarchyLevel,
      isActive: designations.isActive,
      headcount: sql<number>`(
        select count(*)::int from employees e
        where e.designation_id = ${designations.id}
          and e.status = any(${sql.raw(`ARRAY['${EMPLOYED_STATUSES.join("','")}']::employee_status[]`)})
      )`,
    })
    .from(designations)
    .where(eq(designations.orgId, viewer.orgId))
    .orderBy(asc(designations.hierarchyLevel));

  return (
    <>
      <PageHeader
        title="Designations"
        description="Ordered by seniority — level 1 is most senior. Approval routing reads this."
      />
      <MasterTable
        rows={rows}
        empty="No designations defined"
        columns={[
          { header: "Level", align: "right", cell: (r) => <span className="tabular text-ink-soft">{r.hierarchyLevel}</span> },
          { header: "Code", cell: (r) => <span className="font-mono text-xs text-ink-soft">{r.code}</span> },
          { header: "Name", cell: (r) => <span className="font-medium text-ink">{r.name}</span> },
          { header: "Nepali", cell: (r) => <span className="text-ink-soft">{r.nameNepali ?? "—"}</span> },
          { header: "Headcount", align: "right", cell: (r) => <span className="tabular">{r.headcount}</span> },
          { header: "Status", cell: (r) => <ActiveBadge active={r.isActive} /> },
        ]}
      />
    </>
  );
}
