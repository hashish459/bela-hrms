import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SearchParams, SortState } from "@/lib/reports/period";
import { Th } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * A sortable column header. A link rather than a client handler, so a sorted
 * report is addressable like a filtered one, and sorting works before any
 * JavaScript has loaded.
 *
 * The first click sorts descending for numbers — "who has the most" is the
 * question a report column is almost always asked — and ascending for text.
 */
export function SortTh({
  column,
  sort,
  params,
  children,
  align = "left",
  text = false,
  className,
}: {
  column: string;
  sort: SortState;
  params: SearchParams;
  children: React.ReactNode;
  align?: "left" | "right";
  /** Text columns start ascending. */
  text?: boolean;
  className?: string;
}) {
  const isActive = sort.key === column;
  const nextDir = isActive ? (sort.dir === "desc" ? "asc" : "desc") : text ? "asc" : "desc";
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || k === "sort" || k === "dir" || k === "page") continue;
    if (Array.isArray(v)) v.forEach((item) => query.append(k, item));
    else query.set(k, v);
  }
  query.set("sort", column);
  query.set("dir", nextDir);

  const Arrow = !isActive ? ArrowUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;

  return (
    <Th
      className={cn(align === "right" && "text-right", className)}
      aria-sort={isActive ? (sort.dir === "desc" ? "descending" : "ascending") : undefined}
    >
      <Link
        href={`?${query.toString()}`}
        scroll={false}
        className={cn(
          "inline-flex items-center gap-1 hover:text-ink",
          align === "right" && "flex-row-reverse",
          isActive && "text-ink",
        )}
      >
        {children}
        <Arrow className={cn("size-3", isActive ? "opacity-100" : "opacity-40")} aria-hidden />
      </Link>
    </Th>
  );
}
