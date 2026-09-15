import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { withParam, type OffsetPage } from "@/lib/pagination";

/**
 * Pagination controls.
 *
 * Links, not buttons: pages are addressable, so they must be navigable with the
 * back button, openable in a new tab, and crawlable by nothing worse than a
 * prefetch. A `useState` pager is a smaller diff and loses all three.
 *
 * Both variants render nothing when there is only one page. A pager under a
 * six-row table is noise that makes a screen look busier than it is.
 */

/** Windowed page numbers with ellipses: 1 … 4 5 [6] 7 8 … 20. */
function windowed(page: number, pageCount: number, span = 1): (number | "gap")[] {
  const pages = new Set<number>([1, pageCount]);
  for (let p = page - span; p <= page + span; p++) {
    if (p >= 1 && p <= pageCount) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push("gap");
    out.push(p);
    previous = p;
  }
  return out;
}

export function OffsetPagination({
  page,
  params,
  label = "rows",
  className,
}: {
  page: OffsetPage;
  /** The current search params, so paging preserves every active filter. */
  params: Record<string, string | string[] | undefined>;
  label?: string;
  className?: string;
}) {
  if (page.pageCount <= 1) return null;

  const href = (n: number) => withParam(params, "page", n === 1 ? null : String(n));

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2",
        className,
      )}
    >
      <p className="tabular text-[11px] text-ink-faint">
        {page.from}–{page.to} of {page.total} {label}
      </p>

      <div className="flex items-center gap-1">
        <PageLink
          href={href(page.page - 1)}
          disabled={!page.hasPrevious}
          label="Previous page"
          icon={<ChevronLeft className="size-3.5" />}
        />

        {windowed(page.page, page.pageCount).map((entry, i) =>
          entry === "gap" ? (
            <span key={`gap-${i}`} className="px-1 text-[11px] text-ink-faint" aria-hidden>
              …
            </span>
          ) : (
            <Link
              key={entry}
              href={href(entry)}
              scroll={false}
              aria-current={entry === page.page ? "page" : undefined}
              className={cn(
                "tabular grid h-6 min-w-6 place-items-center rounded px-1.5 text-[11px] transition-colors",
                entry === page.page
                  ? "bg-accent font-semibold text-on-accent"
                  : "text-ink-soft hover:bg-sunk hover:text-ink",
              )}
            >
              {entry}
            </Link>
          ),
        )}

        <PageLink
          href={href(page.page + 1)}
          disabled={!page.hasNext}
          label="Next page"
          icon={<ChevronRight className="size-3.5" />}
        />
      </div>
    </nav>
  );
}

/**
 * Cursor paging: forward and back only, because a keyset has no page numbers.
 *
 * `previous` is the cursor the caller arrived with, carried in the URL, rather
 * than a computed backwards seek — a "previous" that re-queries in reverse is
 * where keyset pagers usually start returning rows twice.
 */
export function CursorPagination({
  next,
  previous,
  params,
  shown,
  className,
}: {
  next: string | null;
  previous: string | null;
  params: Record<string, string | string[] | undefined>;
  shown: number;
  className?: string;
}) {
  if (!next && !previous) return null;

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex items-center justify-between gap-3 border-t border-line px-3 py-2",
        className,
      )}
    >
      <p className="tabular text-[11px] text-ink-faint">{shown} shown</p>
      <div className="flex items-center gap-1.5">
        <PageLink
          href={withParam(params, "after", null)}
          disabled={!previous}
          label="First page"
          icon={<ChevronLeft className="size-3.5" />}
          text="Newest"
        />
        <PageLink
          href={withParam(params, "after", next)}
          disabled={!next}
          label="Older entries"
          icon={<ChevronRight className="size-3.5" />}
          text="Older"
          iconFirst={false}
        />
      </div>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
  icon,
  text,
  iconFirst = true,
}: {
  href: string;
  disabled: boolean;
  label: string;
  icon: React.ReactNode;
  text?: string;
  iconFirst?: boolean;
}) {
  const shell = cn(
    "inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[11px] transition-colors",
    disabled
      ? "cursor-not-allowed border-line-soft text-ink-faint opacity-50"
      : "border-line text-ink-soft hover:bg-sunk hover:text-ink",
  );

  // A disabled link is a span: an <a> with no href is not focusable and an <a>
  // that navigates nowhere is a trap for keyboard users.
  if (disabled) {
    return (
      <span className={shell} aria-disabled="true" aria-label={label}>
        {iconFirst ? icon : null}
        {text}
        {iconFirst ? null : icon}
      </span>
    );
  }

  return (
    <Link href={href} scroll={false} aria-label={label} className={shell}>
      {iconFirst ? icon : null}
      {text}
      {iconFirst ? null : icon}
    </Link>
  );
}
