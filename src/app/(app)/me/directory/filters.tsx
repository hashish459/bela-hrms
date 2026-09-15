"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2, Search, X } from "lucide-react";

/**
 * Directory filters, held in the URL for the same reasons as everywhere else:
 * a filtered directory is linkable, survives a refresh, and comes back with the
 * back button.
 */
export function DirectoryFilters({
  departments,
  branches,
  values,
  total,
}: {
  departments: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  values: { q: string; dept: string; branch: string };
  total: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // A narrower result set makes the current page number meaningless.
    next.delete("page");
    start(() => router.replace(next.toString() ? `?${next}` : "?", { scroll: false }));
  }

  const dirty = values.q !== "" || values.dept !== "" || values.branch !== "";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
      <Search className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
      <input
        type="search"
        defaultValue={values.q}
        placeholder="Search by name or code…"
        aria-label="Search the directory"
        onChange={(e) => set("q", e.target.value.trim())}
        className="min-w-44 flex-1 rounded border border-line bg-surface px-2 py-1 text-xs text-ink placeholder:text-ink-faint"
      />

      <select
        value={values.dept}
        aria-label="Filter by department"
        onChange={(e) => set("dept", e.target.value)}
        className="rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink-soft"
      >
        <option value="">All departments</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      <select
        value={values.branch}
        aria-label="Filter by branch"
        onChange={(e) => set("branch", e.target.value)}
        className="rounded border border-line bg-surface px-2 py-1 text-[11px] text-ink-soft"
      >
        <option value="">All branches</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>

      <span className="tabular ml-auto flex items-center gap-2 text-[11px] text-ink-faint">
        {pending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
        {total} {total === 1 ? "person" : "people"}
      </span>

      {dirty ? (
        <button
          type="button"
          onClick={() => start(() => router.replace("?", { scroll: false }))}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint hover:bg-sunk hover:text-ink"
        >
          <X className="size-3" aria-hidden />
          Clear
        </button>
      ) : null}
    </div>
  );
}
