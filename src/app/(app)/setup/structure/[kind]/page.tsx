import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { listUnitRows, unitsWithChildren, usageCounts, type GenericKind } from "@/modules/org/structure";
import type { OrgUnitKind } from "@/kernel/ports";
import { ActiveBadge, buildTree, deactivateBlockedReason, indentOf, subtreeIds } from "../../page-parts";
import { MasterEditor, type EditorRow, type FieldDef } from "../../master-editor";

type KindConfig = {
  kind: string;
  /** Route segment, so a save revalidates the page it came from. */
  slug: string;
  singular: string;
  parentLabel: string | null;
  parentRequired: boolean;
  showDates: boolean;
  showGeography: boolean;
};

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

  const unitKind = def.kind as GenericKind;
  const [rows, parents, usage, withChildren] = await Promise.all([
    listUnitRows(viewer.orgId, unitKind),
    def.parentKind ? listUnitRows(viewer.orgId, def.parentKind as GenericKind) : Promise.resolve([]),
    usageCounts(viewer.orgId, def.kind as OrgUnitKind),
    unitsWithChildren(viewer.orgId),
  ]);

  const tree = buildTree(rows);
  const parentById = new Map(parents.map((p) => [p.id, p]));
  // locations nest into locations, so the parent list is the same list
  const sameKindParent = def.parentKind === def.kind;

  const fields: FieldDef[] = [
    { name: "code", label: "Code", kind: "text", required: true, maxLength: 20, mono: true },
    { name: "name", label: "Name", kind: "text", required: true, maxLength: 120 },
    { name: "nameNepali", label: "Name (Nepali)", kind: "text", maxLength: 120, wide: true },
    ...(def.parentLabel
      ? [
          {
            name: "parentId",
            label: def.parentLabel,
            kind: "select" as const,
            required: def.parentRequired,
            emptyLabel: def.parentRequired ? "Select…" : "None — top level",
            excludeTree: sameKindParent,
            wide: true,
            hint:
              parents.filter((p) => p.isActive).length === 0
                ? `Add a ${def.parentLabel.toLowerCase()} first.`
                : def.parentRequired
                  ? `Must sit under a ${def.parentLabel.toLowerCase()}; anything else is refused.`
                  : undefined,
            options: parents.filter((p) => p.isActive).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })),
          },
        ]
      : []),
    ...(def.showDates
      ? [
          { name: "startDate", label: "Start date", kind: "date" as const },
          { name: "endDate", label: "End date", kind: "date" as const },
        ]
      : []),
    ...(def.showGeography
      ? [
          { name: "country", label: "Country", kind: "text" as const, maxLength: 80 },
          { name: "state", label: "Province / State", kind: "text" as const, maxLength: 80 },
        ]
      : []),
    { name: "sortOrder", label: "Sort order", kind: "number", min: 0, max: 9999, hint: "Lower appears first." },
    { name: "remarks", label: "Remarks", kind: "textarea", maxLength: 500, wide: true },
  ];

  const editorRows: EditorRow[] = tree.map(({ row: r, depth }) => {
    const staff = usage.get(r.id) ?? 0;
    const activeChildren = rows.filter((c) => c.parentId === r.id && c.isActive).length;
    const parent = r.parentId ? (parentById.get(r.parentId) ?? rows.find((x) => x.id === r.parentId)) : null;
    return {
      id: r.id,
      code: r.code,
      isActive: r.isActive,
      search: [r.code, r.name, r.nameNepali, parent?.name].filter(Boolean).join(" ").toLowerCase(),
      tree: sameKindParent ? subtreeIds(rows, r.id) : [r.id],
      deleteBlocked:
        staff > 0
          ? `${staff} employee${staff === 1 ? "" : "s"} placed here. Deactivate instead.`
          : withChildren.has(r.id)
            ? "Units sit underneath this one. Deactivate instead."
            : null,
      deactivateBlocked: deactivateBlockedReason(staff, activeChildren, "unit"),
      values: {
        code: r.code,
        name: r.name,
        nameNepali: r.nameNepali,
        parentId: r.parentId,
        startDate: r.startDate,
        endDate: r.endDate,
        country: r.country,
        state: r.state,
        sortOrder: r.sortOrder,
        remarks: r.remarks,
      },
      cells: [
        <span key="c" className="font-mono text-xs text-ink-soft">{r.code}</span>,
        <span key="n" style={indentOf(depth)} className="flex items-center gap-2">
          {depth > 0 ? <span className="text-ink-faint">└</span> : null}
          <span>
            <span className="font-medium text-ink">{r.name}</span>
            {r.nameNepali ? <span className="block text-[11px] text-ink-faint">{r.nameNepali}</span> : null}
          </span>
        </span>,
        ...(def.parentLabel && !sameKindParent
          ? [<span key="p" className="text-xs text-ink-soft">{parent ? parent.name : "—"}</span>]
          : []),
        ...(def.showDates
          ? [
              <span key="d" className="tabular text-xs text-ink-soft">
                {r.startDate ?? "—"} → {r.endDate ?? "open"}
              </span>,
            ]
          : []),
        <span key="s" className="tabular">{staff}</span>,
        <ActiveBadge key="a" active={r.isActive} />,
      ],
    };
  });

  return (
    <>
      <PageHeader title={def.title} description={def.description} />
      <MasterEditor
        kind={def.kind}
        noun={def.singular}
        plural={def.title.toLowerCase()}
        path={`/setup/structure/${def.slug}`}
        canManage={can(viewer, "setup.structure.manage")}
        columns={[
          { header: "Code" },
          { header: "Name" },
          ...(def.parentLabel && !sameKindParent ? [{ header: def.parentLabel }] : []),
          ...(def.showDates ? [{ header: "Runs" }] : []),
          { header: "Staff", align: "right" as const },
          { header: "Status" },
        ]}
        rows={editorRows}
        fields={fields}
        defaults={{ sortOrder: 0, country: def.showGeography ? "Nepal" : null }}
      />
    </>
  );
}
