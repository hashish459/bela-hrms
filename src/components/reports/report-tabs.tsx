"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/components/app-nav";
import { cn } from "@/lib/utils";

export type ReportTab = { href: string; label: string; icon: string };

/** Filters carried from one report to the next; paging and sorting are per report. */
const CARRIED = ["y", "m", "from", "to", "dept", "branch", "q"];

/**
 * Tabs across a family of reports. Switching tab keeps the period and filters,
 * because the reader is looking at the same people from a different angle —
 * making them re-pick "Bhadra, Finance" on every tab is how filters get lost.
 */
export function ReportTabs({ tabs }: { tabs: ReportTab[] }) {
  const pathname = usePathname();
  const search = useSearchParams();

  const carried = new URLSearchParams();
  for (const k of CARRIED) {
    const v = search.get(k);
    if (v) carried.set(k, v);
  }
  const query = carried.toString();

  // the deepest matching href wins, so the overview tab is not active everywhere
  const active = tabs
    .filter((t) => pathname === t.href || pathname.startsWith(t.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav
      aria-label="Reports"
      className="-mx-1 flex gap-0.5 overflow-x-auto border-b border-line px-1 print:hidden"
    >
      {tabs.map((t) => {
        const isActive = t.href === active;
        return (
          <Link
            key={t.href}
            href={query ? `${t.href}?${query}` : t.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
              isActive
                ? "border-accent font-medium text-ink"
                : "border-transparent text-ink-soft hover:border-line hover:text-ink",
            )}
          >
            <Icon name={t.icon} className={cn("size-3.5", isActive ? "text-accent" : "text-ink-faint")} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
