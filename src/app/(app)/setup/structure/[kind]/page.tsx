import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/session";
import { PageHeader, Badge } from "@/components/ui";
import { listUnits, usageCounts } from "@/modules/org/structure";
import type { OrgUnitKind } from "@/kernel/ports";
import { ActiveBadge, MasterTable, buildTree, indentOf } from "../../page-parts";
import { RetireButton, UnitForm, type KindConfig } from "./forms";

/**
 * Six legacy screens, one route.
 *
 * Division, Business Unit, Sub Business Unit, Functional Category, Project and
 * Location are the same screen with different labels and one different rule
 * each. The legacy system built six controllers and six views for them, and they
 * drifted apart within a release. Here the differences are data.
 */

type KindDef = KindConfig & {
  slug: string;
  title: string;
  description: string;
  parentKind: OrgUnitKind | null;
};

const KINDS: KindDef[] = [
  {
    slug: "divisions",
    kind: "division",
    singular: "division",
    title: "Divisions",
    description:
      "The nature of the business — the top of the structure. Everything else hangs off one of these.",
    parentKind: null,
    parentLabel: null,
    parentRequired: false,
    showDates: false,
    showGeography: false,
  },
  {
    slug: "business-units",
    kind: "business_unit",
    singular: "business unit",
    title: "Business units",
    description: "An operating company inside a division, run and reported on as its own entity.",
    parentKind: "division",
    parentLabel: "Division",
    parentRequired: true,
    showDates: false,
    showGeography: false,
  },
  {
    slug: "sub-business-units",
    kind: "sub_business_unit",
    singular: "sub business unit",
    title: "Sub business units",
    description: "A product line or plant within a business unit.",
    parentKind: "business_unit",
    parentLabel: "Business unit",
    parentRequired: true,
    showDates: false,
    showGeography: false,
  },
  {
    slug: "functional-categories",
    kind: "functional_category",
    singular: "functional category",
    title: "Functional categories",
    description:
      "Cross-cutting grouping for staff who do the work of another function — a non-sales team doing sales work is reported with sales.",
    parentKind: null,
    parentLabel: null,
    parentRequired: false,
    showDates: false,
    showGeography: false,
  },
  {
    slug: "projects",
    kind: "project",
    singular: "project",
    title: "Projects",
    description:
      "Time-boxed work somebody is assigned to. Dated, so cost can be attributed to the period it was actually incurred in.",
    parentKind: null,
    parentLabel: null,
    parentRequired: false,
    showDates: true,
    showGeography: false,
  },
  {
    slug: "locations",
    kind: "location",
    singular: "location",
    title: "Locations",
    description:
      "Geography that policy keys off — valley and outside-valley allowances, grade bands, leave rules. Nests: a district inside a province.",
    parentKind: "location",
    parentLabel: "Parent location",
    parentRequired: false,
    showDates: false,
    showGeography: true,
  },
];

type RouteParams = { params: Promise<{ kind: string }> };

export async function generateMetadata({ params }: RouteParams) {
  const { kind } = await params;
  const def = KINDS.find((k) => k.slug === kind);
  return { title: def?.title ?? "Structure" };
}

export default async function StructureKindPage({ params }: RouteParams) {
  const viewer = await requirePermission("setup.structure.view");
  const { kind } = await params;

  const def = KINDS.find((k) => k.slug === kind);
  // An unknown slug is a 404, not an empty list — a typo must not look like
  // "there is no data here".
  if (!def) notFound();

  const [rows, parents, usage] = await Promise.all([
    listUnits(viewer.orgId, def.kind as OrgUnitKind),
    def.parentKind ? listUnits(viewer.orgId, def.parentKind) : Promise.resolve([]),
    usageCounts(viewer.orgId, def.kind as OrgUnitKind),
  ]);

  const tree = buildTree(rows);
  const mayManage = can(viewer, "setup.structure.manage");

  return (
    <>
      <PageHeader title={def.title} description={def.description} />

      {mayManage ? (
        <div className="mb-5">
          <UnitForm
            config={def}
            parents={parents
              .filter((p) => p.isActive)
              .map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` }))}
          />
        </div>
      ) : null}

      <MasterTable
        rows={tree.map((t) => ({ ...t.row, __depth: t.depth }))}
        empty={`No ${def.title.toLowerCase()} defined yet`}
        columns={[
          {
            header: "Code",
            cell: (r) => <span className="font-mono text-xs text-ink-soft">{r.code}</span>,
          },
          {
            header: "Name",
            cell: (r) => (
              <span style={indentOf(r.__depth)} className="flex items-center gap-2">
                {r.__depth > 0 ? <span className="text-ink-faint">└</span> : null}
                <span className="font-medium text-ink">{r.name}</span>
              </span>
            ),
          },
          {
            header: "Staff",
            align: "right",
            cell: (r) => {
              const n = usage.get(r.id) ?? 0;
              return n === 0 ? (
                <span className="text-ink-faint">—</span>
              ) : (
                <Badge tone="neutral">{n}</Badge>
              );
            },
          },
          { header: "Status", cell: (r) => <ActiveBadge active={r.isActive} /> },
          ...(mayManage
            ? [
                {
                  header: "",
                  align: "right" as const,
                  cell: (r: (typeof tree)[number]["row"] & { __depth: number }) =>
                    r.isActive ? (
                      <RetireButton id={r.id} kind={def.kind} slug={def.slug} inUse={usage.get(r.id) ?? 0} />
                    ) : (
                      <span className="text-xs text-ink-faint">—</span>
                    ),
                },
              ]
            : []),
        ]}
      />
    </>
  );
}
