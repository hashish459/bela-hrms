/**
 * Page-level plumbing every report screen shares: links that keep the filters,
 * sort-then-page, print mode, and the one-line scope a report states.
 *
 * Pure, and module-neutral, so the attendance and leave reports behave
 * identically — page two, a sorted column and a printout all work the same way
 * on both, because it is the same code.
 */
import { offsetPage, PAGE_SIZE, sliceOffsetPage, type OffsetPage } from "@/lib/pagination";
import {
  resolveSort,
  sortRows,
  type ReportFilters,
  type SearchParams,
  type SortState,
} from "./period";

/** The keys that describe *what* a report shows, carried between reports. */
export const FILTER_KEYS = ["y", "m", "from", "to", "dept", "branch", "q"] as const;

/**
 * Builds links that keep the current period and filters — to sibling reports,
 * or to an export. Extra query keys (`report=late-days`, `dept=…`) are set on
 * top, and win, so a drill-down can replace a carried filter.
 */
export function carryFilters(params: SearchParams): (path: string, extra?: Record<string, string>) => string {
  return (path, extra) => {
    const query = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = params[k];
      if (typeof v === "string" && v) query.set(k, v);
    }
    for (const [k, v] of Object.entries(extra ?? {})) query.set(k, v);
    const qs = query.toString();
    return qs ? `${path}?${qs}` : path;
  };
}

/**
 * One page of rows — or all of them in print mode, because a printed report
 * that silently stops at row 25 is worse than no printout.
 */
export function pageRows<T>(rows: readonly T[], params: SearchParams): { page: OffsetPage; visible: T[] } {
  if (params.print === "1") {
    const all = offsetPage({ total: rows.length, defaultSize: PAGE_SIZE.compact });
    return {
      page: { ...all, size: rows.length, limit: rows.length, to: rows.length, pageCount: 1, hasNext: false },
      visible: [...rows],
    };
  }
  const page = offsetPage({
    page: typeof params.page === "string" ? params.page : null,
    total: rows.length,
    defaultSize: PAGE_SIZE.compact,
  });
  return { page, visible: sliceOffsetPage(rows, page) };
}

/**
 * Sorts, then pages. Paging after sorting, over every row, so page two of
 * "most absent" continues page one rather than restarting it.
 */
export function sortedPage<T>(
  rows: readonly T[],
  params: SearchParams,
  keys: readonly string[],
  value: (row: T, key: string) => string | number | null,
  fallback: SortState,
): { sort: SortState; page: OffsetPage; visible: T[]; sorted: T[] } {
  const sort = resolveSort(params, keys, fallback);
  const sorted = sortRows(rows, sort, value);
  return { sort, sorted, ...pageRows(sorted, params) };
}

/** "Bhadra 2083 · Finance · matching “ram” · 24 employees". */
export function scopeLine(
  periodLabel: string,
  filters: ReportFilters,
  headcount: number,
  names: { department?: string | null; branch?: string | null },
): string {
  const parts = [periodLabel];
  if (filters.departmentId) parts.push(names.department ?? "Selected department");
  if (filters.branchId) parts.push(names.branch ?? "Selected branch");
  if (filters.q) parts.push(`matching “${filters.q}”`);
  parts.push(`${headcount} ${headcount === 1 ? "employee" : "employees"}`);
  return parts.join(" · ");
}
