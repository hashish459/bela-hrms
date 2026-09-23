import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { adToBs, formatBs } from "@/lib/bs";
import { cn } from "@/lib/utils";
import { Badge, Card, EmptyState, PageHeader, TableShell, Td, Th, Tr } from "@/components/ui";
import { BIN_TYPES, binCounts, listBin, type BinType } from "@/lib/recycle-bin";
import { BinRowActions } from "./bin-row";

export const metadata = { title: "Recycle Bin" };

/**
 * Everything deleted, from every screen, in one list.
 *
 * Deleting across the product is soft: the row stays, marked, and drops out of
 * every list, picker and report. Here it can be restored as it was, or purged —
 * which the owning module may refuse if anything still depends on the row
 * (an employee with leave history, a master still referenced).
 */
export default async function RecycleBinPage({ searchParams }: PageProps<"/admin/recycle-bin">) {
  const viewer = await requirePermission("admin.recycle.manage");
  const params = await searchParams;
  const type = BIN_TYPES.find((t) => t.key === params.type)?.key ?? null;

  const [items, counts] = await Promise.all([listBin(viewer.orgId, type), binCounts(viewer.orgId)]);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const label = new Map(BIN_TYPES.map((t) => [t.key, t.label]));

  const chip = (key: BinType | null, text: string, n: number) => (
    <Link
      key={key ?? "all"}
      href={key ? `/admin/recycle-bin?type=${key}` : "/admin/recycle-bin"}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        type === key ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-ink-soft hover:bg-sunk hover:text-ink",
      )}
    >
      {text}
      <span className="tabular text-[10px] text-ink-faint">{n}</span>
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Recycle Bin"
        description="Deleted logins, employee records, documents and masters. Restore puts a row back exactly as it was; purge removes it for good."
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {chip(null, "Everything", total)}
        {BIN_TYPES.filter((t) => (counts.get(t.key) ?? 0) > 0 || t.key === type).map((t) =>
          chip(t.key, t.label, counts.get(t.key) ?? 0),
        )}
      </div>

      {items.length === 0 ? (
        <Card>
          <EmptyState title="The recycle bin is empty" hint="Anything deleted anywhere in the system appears here first." />
        </Card>
      ) : (
        <TableShell>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th>Kind</Th>
              <Th>Deleted</Th>
              <Th>By</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Tr key={`${item.type}:${item.id}`}>
                <Td>
                  <span className="block font-medium text-ink">{item.label}</span>
                  {item.detail ? <span className="block text-xs text-ink-faint">{item.detail}</span> : null}
                </Td>
                <Td>
                  <Badge>{label.get(item.type)}</Badge>
                </Td>
                <Td className="tabular text-ink-soft">{formatBs(adToBs(item.deletedAt.toISOString().slice(0, 10)))}</Td>
                <Td className="text-ink-soft">{item.deletedBy ?? "—"}</Td>
                <Td className="text-right">
                  <BinRowActions type={item.type} id={item.id} label={item.label} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </>
  );
}
