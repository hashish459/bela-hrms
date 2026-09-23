"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Paging for a list already in the browser (one filtered with chips, say):
 * no round trip, and it resets when the list it pages changes length.
 */
export function usePager<T>(items: readonly T[], size = 10) {
  const [state, setState] = useState({ page: 1, of: items.length });
  // a new filter means a new list: start again at the top
  const page = state.of === items.length ? state.page : 1;
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pageCount);
  const go = (n: number) => setState({ page: Math.max(1, Math.min(pageCount, n)), of: items.length });
  return {
    items: items.slice((current - 1) * size, current * size),
    pager: { page: current, pageCount, total: items.length, size, go },
  };
}

export function ClientPager({
  pager,
  label = "items",
  className,
}: {
  pager: ReturnType<typeof usePager>["pager"];
  label?: string;
  className?: string;
}) {
  const { page, pageCount, total, size, go } = pager;
  if (pageCount <= 1) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  const numbers = Array.from({ length: pageCount }, (_, i) => i + 1).filter((n) => n === 1 || n === pageCount || Math.abs(n - page) <= 1);

  return (
    <nav aria-label="Pagination" className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2", className)}>
      <p className="tabular text-[11px] text-ink-faint">
        {from}–{to} of {total} {label}
      </p>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => go(page - 1)} disabled={page === 1} aria-label="Previous page" className="grid size-6 place-items-center rounded text-ink-soft hover:bg-sunk disabled:opacity-30">
          <ChevronLeft className="size-3.5" />
        </button>
        {numbers.map((n, i) => (
          <span key={n} className="flex items-center">
            {i > 0 && n - numbers[i - 1] > 1 ? <span className="px-1 text-[11px] text-ink-faint">…</span> : null}
            <button
              type="button"
              onClick={() => go(n)}
              aria-current={n === page ? "page" : undefined}
              className={cn(
                "tabular grid h-6 min-w-6 place-items-center rounded px-1.5 text-[11px] transition-colors",
                n === page ? "bg-accent font-semibold text-on-accent" : "text-ink-soft hover:bg-sunk hover:text-ink",
              )}
            >
              {n}
            </button>
          </span>
        ))}
        <button type="button" onClick={() => go(page + 1)} disabled={page === pageCount} aria-label="Next page" className="grid size-6 place-items-center rounded text-ink-soft hover:bg-sunk disabled:opacity-30">
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    </nav>
  );
}
