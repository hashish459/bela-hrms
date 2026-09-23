"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Export and print for a report.
 *
 * The CSV link is built from the live URL, so it exports exactly the period and
 * filters on screen — never a stale copy of them — and every row, not just the
 * visible page.
 *
 * Printing re-renders the report with `?print=1`, which drops pagination so the
 * paper has every row, then opens the browser's dialog (which is also "Save as
 * PDF") and returns to the paged view afterwards. The app chrome hides itself
 * under `print:`.
 */
export function ReportActions({ exportHref }: { exportHref?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const printing = search.get("print") === "1";

  const without = (key: string) => {
    const next = new URLSearchParams(search.toString());
    next.delete(key);
    return next;
  };

  useEffect(() => {
    if (!printing) return;
    const back = () => {
      const query = without("print").toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };
    window.addEventListener("afterprint", back, { once: true });
    // a frame's delay, so the full table is painted before the dialog snapshots it
    const timer = window.setTimeout(() => window.print(), 150);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", back);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printing]);

  const query = without("page");
  query.delete("print");
  const separator = exportHref?.includes("?") ? "&" : "?";
  const href = exportHref ? `${exportHref}${query.size ? separator + query.toString() : ""}` : null;

  function print() {
    const next = without("page");
    next.set("print", "1");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="flex items-center gap-2 print:hidden">
      {href ? (
        <a
          href={href}
          download
          className="inline-flex items-center justify-center gap-1.5 rounded border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-sunk"
        >
          <Download className="size-4" />
          Export CSV
        </a>
      ) : null}
      <Button type="button" variant="secondary" onClick={print} disabled={printing}>
        <Printer className="size-4" />
        {printing ? "Preparing…" : "Print / PDF"}
      </Button>
    </div>
  );
}
