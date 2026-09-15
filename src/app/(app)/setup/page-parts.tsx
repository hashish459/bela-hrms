import type { ReactNode } from "react";
import { Badge, Card, EmptyState, TableShell, Td, Th, Tr } from "@/components/ui";

export type Column<Row> = {
  header: string;
  cell: (row: Row) => ReactNode;
  align?: "left" | "right";
  width?: string;
};

/**
 * Master-data tables all look the same, so they are one component rather than
 * five near-identical pages. The legacy system had a separate controller, view
 * and grid definition for each of these.
 */
export function MasterTable<Row extends { id: string }>({
  rows,
  columns,
  empty,
}: {
  rows: Row[];
  columns: Column<Row>[];
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState title={empty} />
      </Card>
    );
  }
  return (
    <TableShell>
      <thead>
        <tr>
          {columns.map((c) => (
            <Th key={c.header} className={c.align === "right" ? "text-right" : undefined}>
              {c.header}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Tr key={row.id}>
            {columns.map((c) => (
              <Td key={c.header} className={c.align === "right" ? "text-right" : undefined}>
                {c.cell(row)}
              </Td>
            ))}
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? "ok" : "neutral"}>{active ? "Active" : "Inactive"}</Badge>;
}

/** Renders a parent/child tree as indented rows. */
export function indentOf(depth: number) {
  return { paddingLeft: `${depth * 1.25}rem` };
}

export function buildTree<T extends { id: string; parentId: string | null }>(
  rows: T[],
): { row: T; depth: number }[] {
  const byParent = new Map<string | null, T[]>();
  for (const r of rows) {
    const key = r.parentId;
    byParent.set(key, [...(byParent.get(key) ?? []), r]);
  }
  const out: { row: T; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const row of byParent.get(parent) ?? []) {
      out.push({ row, depth });
      walk(row.id, depth + 1);
    }
  };
  walk(null, 0);
  // anything whose parent is missing would otherwise vanish silently
  if (out.length < rows.length) {
    const seen = new Set(out.map((o) => o.row.id));
    for (const row of rows) if (!seen.has(row.id)) out.push({ row, depth: 0 });
  }
  return out;
}
