/**
 * Report periods and filters, shared by every reporting screen.
 *
 * Pure — no database, no React — so the attendance reports, the CSV export and
 * the leave reports that follow them all read a URL the same way. Two screens
 * disagreeing on what "last month" means is how a payroll clerk ends up with two
 * absence figures for one person.
 *
 * A period is either a Bikram Sambat month (`?y=2083&m=5`), which is what payroll
 * closes on, or an arbitrary Gregorian range (`?from=…&to=…`). Anything
 * malformed falls back to the current BS month rather than failing: a stale
 * bookmark should land somewhere sensible, not on an error page.
 */
import {
  addDays,
  adToBs,
  BS_MONTHS,
  bsToAd,
  daysBetween,
  daysInBsMonth,
  fiscalYearOf,
  formatBs,
} from "@/lib/bs";

export type SearchParams = Record<string, string | string[] | undefined>;

/** A year is the longest window a report will compute in one request. */
export const MAX_REPORT_DAYS = 366;

export type ReportPeriod = {
  mode: "month" | "range";
  /** First day, inclusive. */
  from: string;
  /** Last day as asked for, inclusive. */
  to: string;
  /**
   * The last day that can have happened yet — `to` clipped to today. Every
   * figure is computed up to here; counting future days as "not marked" would
   * make every current-month report look like a data-quality failure.
   */
  effectiveTo: string;
  /** False when the whole period is still in the future. */
  hasElapsed: boolean;
  bsMonth: { year: number; month: number } | null;
  /** "Bhadra 2083", or "1 Bhadra 2083 – 15 Asoj 2083". */
  label: string;
  /** Short, filename-safe: "2083-05", or "2026-08-17_2026-09-22". */
  slug: string;
  /** Inclusive days from `from` to `effectiveTo`; 0 when nothing has elapsed. */
  elapsedDays: number;
  /** Set when the requested range was longer than MAX_REPORT_DAYS and its start was moved up. */
  truncated: boolean;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isRealIso(value: string | undefined): value is string {
  if (!value || !ISO.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function monthPeriod(year: number, month: number, today: string): ReportPeriod | null {
  try {
    const from = bsToAd({ year, month, day: 1 });
    const to = bsToAd({ year, month, day: daysInBsMonth(year, month) });
    return finish({ mode: "month", from, to, bsMonth: { year, month }, truncated: false }, today);
  } catch {
    return null;
  }
}

function finish(
  p: Pick<ReportPeriod, "mode" | "from" | "to" | "bsMonth" | "truncated">,
  today: string,
): ReportPeriod {
  const effectiveTo = p.to > today ? today : p.to;
  const hasElapsed = effectiveTo >= p.from;

  let label: string;
  let slug: string;
  if (p.bsMonth) {
    label = `${BS_MONTHS[p.bsMonth.month - 1]} ${p.bsMonth.year}`;
    slug = `${p.bsMonth.year}-${String(p.bsMonth.month).padStart(2, "0")}`;
  } else {
    let fromBs = p.from;
    let toBs = p.to;
    try {
      fromBs = formatBs(adToBs(p.from));
      toBs = formatBs(adToBs(p.to));
    } catch {
      // outside the published calendar: show the Gregorian dates instead
    }
    label = p.from === p.to ? fromBs : `${fromBs} – ${toBs}`;
    slug = `${p.from}_${p.to}`;
  }

  return {
    ...p,
    effectiveTo,
    hasElapsed,
    label,
    slug,
    elapsedDays: hasElapsed ? daysBetween(p.from, effectiveTo) : 0,
  };
}

/** Reads the period from a URL. Always returns one. */
export function resolvePeriod(params: SearchParams, today: string): ReportPeriod {
  const from = first(params.from);
  const to = first(params.to);

  if (isRealIso(from) && isRealIso(to)) {
    const [start, end] = from <= to ? [from, to] : [to, from];
    const tooLong = daysBetween(start, end) > MAX_REPORT_DAYS;
    // Too long keeps the most recent year: "2020 to today" is almost always a
    // question about lately, not about 2020.
    return finish(
      {
        mode: "range",
        from: tooLong ? addDays(end, -(MAX_REPORT_DAYS - 1)) : start,
        to: end,
        bsMonth: null,
        truncated: tooLong,
      },
      today,
    );
  }

  const nowBs = adToBs(today);
  const year = Number(first(params.y));
  const month = Number(first(params.m));
  if (Number.isInteger(year) && Number.isInteger(month)) {
    const period = monthPeriod(year, month, today);
    if (period) return period;
  }

  return monthPeriod(nowBs.year, nowBs.month, today)!;
}

/* ------------------------------------------------------------------ presets */

export type PeriodPreset = {
  id: string;
  label: string;
  /** The query keys that select this period; every other period key is cleared. */
  query: Record<string, string>;
};

/** The keys that describe a period, cleared together when a new one is chosen. */
export const PERIOD_KEYS = ["y", "m", "from", "to"] as const;

/**
 * The quick choices in the period picker.
 *
 * Months come first because that is what payroll closes on; the rolling windows
 * are for the supervisor who wants "how has this fortnight gone" without doing
 * calendar arithmetic.
 */
export function periodPresets(today: string): PeriodPreset[] {
  const bs = adToBs(today);
  const prevMonth = bs.month === 1 ? { year: bs.year - 1, month: 12 } : { year: bs.year, month: bs.month - 1 };
  const fy = fiscalYearOf(today);

  const month = (m: { year: number; month: number }) => ({ y: String(m.year), m: String(m.month) });
  const range = (from: string, to: string) => ({ from, to });

  return [
    { id: "this-month", label: `This month · ${BS_MONTHS[bs.month - 1]}`, query: month(bs) },
    {
      id: "last-month",
      label: `Last month · ${BS_MONTHS[prevMonth.month - 1]}`,
      query: month(prevMonth),
    },
    { id: "last-7", label: "Last 7 days", query: range(addDays(today, -6), today) },
    { id: "last-30", label: "Last 30 days", query: range(addDays(today, -29), today) },
    { id: "last-90", label: "Last 90 days", query: range(addDays(today, -89), today) },
    {
      id: "fy-to-date",
      label: `Fiscal year ${fy.code} to date`,
      query: range(bsToAd(fy.startBs), today),
    },
  ];
}

/** Which preset, if any, the current period is. */
export function matchPreset(presets: PeriodPreset[], params: SearchParams): string | null {
  for (const preset of presets) {
    const matches = PERIOD_KEYS.every((k) => (first(params[k]) ?? "") === (preset.query[k] ?? ""));
    if (matches) return preset.id;
  }
  // no period keys at all is the default, which is the current month
  if (PERIOD_KEYS.every((k) => !first(params[k]))) return presets[0]?.id ?? null;
  return null;
}

/* ------------------------------------------------------------------ filters */

export type ReportFilters = {
  departmentId: string | null;
  branchId: string | null;
  /** Free-text match on name or employee code. */
  q: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids are validated here so a crafted URL never reaches a query as anything but a uuid. */
export function resolveFilters(params: SearchParams): ReportFilters {
  const dept = first(params.dept);
  const branch = first(params.branch);
  const q = first(params.q)?.trim().slice(0, 80);
  return {
    departmentId: dept && UUID.test(dept) ? dept : null,
    branchId: branch && UUID.test(branch) ? branch : null,
    q: q ? q : null,
  };
}

/* ------------------------------------------------------------------ sorting */

export type SortState = { key: string; dir: "asc" | "desc" };

/** Reads `?sort=&dir=`, accepting only keys the screen declares. */
export function resolveSort(
  params: SearchParams,
  allowed: readonly string[],
  fallback: SortState,
): SortState {
  const key = first(params.sort);
  const dir = first(params.dir);
  if (!key || !allowed.includes(key)) return fallback;
  return { key, dir: dir === "asc" ? "asc" : "desc" };
}

/** Sorts a copy. Nulls always last, whichever way the column runs. */
export function sortRows<T>(
  rows: readonly T[],
  sort: SortState,
  value: (row: T, key: string) => string | number | null,
): T[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a, sort.key);
    const vb = value(b, sort.key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === "string" || typeof vb === "string") {
      return String(va).localeCompare(String(vb)) * factor;
    }
    return (va - vb) * factor;
  });
}
