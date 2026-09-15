"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Filter, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Holiday filters, held in the URL.
 *
 * The query string is the state container, not React: a filtered view is then
 * linkable, survives a refresh, and is restored by the back button — none of
 * which is true of a `useState` filter, and all of which somebody expects when
 * they send a colleague "the holidays that clash with a Saturday".
 *
 * Filtering happens on the server against the full set. Filtering a paginated
 * page in the browser would silently filter only the page you can see, which is
 * the most common way a filter lies.
 */

export type HolidayFilterValues = {
  q: string;
  scope: "all" | "upcoming" | "past";
  status: "all" | "active" | "disabled";
  clash: "all" | "saturday";
};

export function HolidayFilters({
  values,
  total,
  showing,
}: {
  values: HolidayFilterValues;
  total: number;
  showing: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  /** Writes one key, drops it when it returns to the default, and resets paging. */
  function set(key: string, value: string, isDefault: boolean) {
    const next = new URLSearchParams(params.toString());
    if (isDefault) next.delete(key);
    else next.set(key, value);
    // Any filter change invalidates the current page number — page 4 of a
    // narrower result set is usually empty, which reads as "no results".
    next.delete("page");
    start(() => router.replace(next.toString() ? `?${next}` : "?", { scroll: false }));
  }

  const dirty =
    values.q !== "" || values.scope !== "all" || values.status !== "all" || values.clash !== "all";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
      <Filter className="size-3.5 shrink-0 text-ink-faint" aria-hidden />

      <input
        type="search"
        defaultValue={values.q}
        placeholder="Search holidays…"
        aria-label="Search holidays"
        onChange={(e) => set("q", e.target.value.trim(), e.target.value.trim() === "")}
        className="min-w-40 flex-1 rounded border border-line bg-surface px-2 py-1 text-xs text-ink placeholder:text-ink-faint"
      />

      <Segmented
        label="Period"
        value={values.scope}
        options={[
          { value: "all", label: "All" },
          { value: "upcoming", label: "Upcoming" },
          { value: "past", label: "Past" },
        ]}
        onChange={(v) => set("scope", v, v === "all")}
      />

      <Segmented
        label="Status"
        value={values.status}
        options={[
          { value: "all", label: "All" },
          { value: "active", label: "Active" },
          { value: "disabled", label: "Disabled" },
        ]}
        onChange={(v) => set("status", v, v === "all")}
      />

      <button
        type="button"
        onClick={() => set("clash", "saturday", values.clash === "saturday")}
        aria-pressed={values.clash === "saturday"}
        title="Holidays that fall on a Saturday are already a weekly off"
        className={cn(
          "rounded border px-2 py-1 text-[11px] transition-colors",
          values.clash === "saturday"
            ? "border-warn bg-warn-soft text-warn"
            : "border-line text-ink-soft hover:bg-sunk",
        )}
      >
        Saturday clash
      </button>

      <span className="tabular ml-auto flex items-center gap-2 text-[11px] text-ink-faint">
        {pending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
        {showing === total ? `${total} holidays` : `${showing} of ${total}`}
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

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded border border-line" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "px-2 py-1 text-[11px] transition-colors",
            value === o.value
              ? "bg-accent-soft font-medium text-accent"
              : "text-ink-soft hover:bg-sunk",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
