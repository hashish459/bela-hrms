"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { CalendarRange, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { adToBs, formatBs } from "@/lib/bs";
import { matchPreset, PERIOD_KEYS, periodPresets, resolvePeriod } from "@/lib/reports/period";
import { shiftBsMonth } from "@/components/bs-month-nav";
import { Select } from "@/components/ui";
import { cn } from "@/lib/utils";

type Option = { id: string; name: string };

/** Keys that describe *what* is shown; paging and sorting reset when they change. */
const RESETS = ["page", "sort", "dir", "print"];

function safeBs(iso: string) {
  try {
    return formatBs(adToBs(iso));
  } catch {
    return iso;
  }
}

/**
 * The filter bar every report shares: period, department, branch, and a name
 * search. Everything lives in the URL, so a filtered report is a link somebody
 * can bookmark or paste to a colleague — and the CSV export, which reads the
 * same URL, always exports exactly what is on screen.
 */
export function ReportToolbar({
  today,
  departments,
  branches,
  clipsToToday = true,
}: {
  today: string;
  departments: Option[];
  branches: Option[];
  /**
   * Whether figures stop at today. Attendance does — a future day has no
   * punches. Leave does not: leave approved for next week is already a fact.
   */
  clipsToToday?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const params = useMemo(() => Object.fromEntries(search.entries()), [search]);
  const presets = useMemo(() => periodPresets(today), [today]);
  const period = useMemo(() => resolvePeriod(params, today), [params, today]);
  const activePreset = matchPreset(presets, params);
  const [custom, setCustom] = useState(activePreset === null && !period.bsMonth);
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  function apply(changes: Record<string, string | null>) {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    for (const k of RESETS) next.delete(k);
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  function choosePeriod(query: Record<string, string>) {
    const changes: Record<string, string | null> = {};
    for (const k of PERIOD_KEYS) changes[k] = query[k] ?? null;
    apply(changes);
  }

  const stepMonth = (delta: number) => {
    if (!period.bsMonth) return;
    const next = shiftBsMonth(period.bsMonth, delta);
    if (next) choosePeriod({ y: String(next.year), m: String(next.month) });
  };

  const q = search.get("q") ?? "";
  const dept = search.get("dept") ?? "";
  const branch = search.get("branch") ?? "";
  const dirty = Boolean(q || dept || branch || PERIOD_KEYS.some((k) => search.get(k)));

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3 print:hidden"
      aria-busy={pending}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {period.bsMonth ? (
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              className="rounded border border-line p-1.5 text-ink-soft hover:bg-sunk hover:text-ink"
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </button>
          ) : null}

          <div className="relative">
            <CalendarRange className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-faint" />
            <Select
              aria-label="Report period"
              className="w-64 pl-7"
              value={custom ? "custom" : (activePreset ?? "custom")}
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setCustom(true);
                  return;
                }
                const preset = presets.find((p) => p.id === e.target.value);
                if (preset) {
                  setCustom(false);
                  choosePeriod(preset.query);
                }
              }}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              {activePreset === null && period.bsMonth ? (
                <option value="custom">{period.label}</option>
              ) : (
                <option value="custom">Custom range…</option>
              )}
            </Select>
          </div>

          {period.bsMonth ? (
            <button
              type="button"
              onClick={() => stepMonth(1)}
              className="rounded border border-line p-1.5 text-ink-soft hover:bg-sunk hover:text-ink"
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </button>
          ) : null}
        </div>

        {custom ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              aria-label="From"
              defaultValue={period.from}
              max={today}
              onChange={(e) =>
                e.target.value && choosePeriod({ from: e.target.value, to: period.to > today ? today : period.to })
              }
              className="tabular rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
            <span className="text-xs text-ink-faint">to</span>
            <input
              type="date"
              aria-label="To"
              defaultValue={period.to}
              onChange={(e) => e.target.value && choosePeriod({ from: period.from, to: e.target.value })}
              className="tabular rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
          </div>
        ) : null}

        <span className="hidden h-6 w-px bg-line sm:block" aria-hidden />

        <Select
          aria-label="Department"
          value={dept}
          onChange={(e) => apply({ dept: e.target.value || null })}
          className="w-48"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>

        {branches.length > 1 ? (
          <Select
            aria-label="Branch"
            value={branch}
            onChange={(e) => apply({ branch: e.target.value || null })}
            className="w-44"
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        ) : null}

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            defaultValue={q}
            ref={searchInput}
            placeholder="Employee name or code"
            onChange={(e) => {
              // debounced: a server render per keystroke is wasted work
              const value = e.target.value.trim();
              if (typing.current) clearTimeout(typing.current);
              typing.current = setTimeout(() => apply({ q: value || null }), 300);
            }}
            className="w-56 rounded border border-line bg-surface py-1.5 pr-2.5 pl-7 text-sm text-ink placeholder:text-ink-faint"
          />
        </div>

        {dirty ? (
          <button
            type="button"
            onClick={() => {
              setCustom(false);
              if (searchInput.current) searchInput.current.value = "";
              startTransition(() => router.replace(pathname, { scroll: false }));
            }}
            className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs text-ink-faint hover:bg-sunk hover:text-ink"
          >
            <X className="size-3.5" />
            Reset
          </button>
        ) : null}
      </div>

      <p className={cn("tabular text-[11px] text-ink-faint", pending && "animate-pulse")}>
        {period.label}
        <span className="mx-1.5" aria-hidden>
          ·
        </span>
        {period.from === period.to ? period.from : `${period.from} → ${period.to}`}
        {clipsToToday && period.effectiveTo < period.to && period.hasElapsed ? (
          <> · counted to {safeBs(period.effectiveTo)} (today)</>
        ) : null}
        {!clipsToToday && period.to > today ? <> · includes leave already booked after today</> : null}
        {clipsToToday && !period.hasElapsed ? <> · this period has not started yet</> : null}
        {period.truncated ? <> · shortened to the most recent year</> : null}
      </p>
    </div>
  );
}
