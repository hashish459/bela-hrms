/**
 * Pagination, as two strategies rather than one.
 *
 * Which one a screen uses is a property of the data, not a style preference:
 *
 *   Offset (`page=3`)   Bounded sets somebody navigates deliberately — holidays,
 *                       employees, roles. A person wants "page 4 of 9" and to
 *                       jump to the last page. The cost is that `OFFSET n` makes
 *                       the database walk and discard n rows, and that a row
 *                       inserted mid-browse shifts everything down a place.
 *                       At a few thousand rows neither matters.
 *
 *   Keyset (`after=…`)  Unbounded, append-heavy, time-ordered sets — the audit
 *                       log above all. `WHERE (created_at, id) < (…)` uses the
 *                       index directly, so page 900 costs the same as page 1,
 *                       and new rows arriving at the head cannot shift a reader
 *                       onto a row they have already seen. The trade is that you
 *                       cannot jump to an arbitrary page, which is exactly what
 *                       nobody does with a log.
 *
 * Choosing offset for an audit log is the classic mistake: it is correct on a
 * demo database and quietly becomes a table scan in production, at the moment
 * somebody is trying to investigate an incident.
 *
 * This module is pure — no database, no React — so both strategies can be
 * asserted directly.
 */

/** Page sizes, named so a screen does not invent its own number. */
export const PAGE_SIZE = {
  /** Dense master-data tables. */
  compact: 25,
  /** Card and detail lists. */
  comfortable: 12,
  /** Log-style feeds. */
  feed: 50,
} as const;

/** Hard ceiling on anything a URL can ask for. A `?size=100000` is a denial of service. */
export const MAX_PAGE_SIZE = 200;

/* --------------------------------------------------------------- offset */

export type OffsetPage = {
  /** 1-based, clamped into range. */
  page: number;
  size: number;
  /** For SQL `LIMIT`/`OFFSET`. */
  limit: number;
  offset: number;
  total: number;
  pageCount: number;
  hasPrevious: boolean;
  hasNext: boolean;
  /** 1-based index of the first row on this page; 0 when there are none. */
  from: number;
  /** 1-based index of the last row on this page. */
  to: number;
};

/**
 * Resolves a page request against a known total.
 *
 * Clamps rather than rejects: a page number past the end lands on the last page,
 * which is what a stale bookmark or a filter change should do. Returning an
 * empty page there reads as "no results" and sends people looking for a bug.
 */
export function offsetPage(input: {
  page?: number | string | null;
  size?: number | string | null;
  total: number;
  defaultSize?: number;
}): OffsetPage {
  const size = clampInt(input.size, input.defaultSize ?? PAGE_SIZE.compact, 1, MAX_PAGE_SIZE);
  const total = Math.max(0, Math.trunc(input.total));
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = clampInt(input.page, 1, 1, pageCount);
  const offset = (page - 1) * size;

  return {
    page,
    size,
    limit: size,
    offset,
    total,
    pageCount,
    hasPrevious: page > 1,
    hasNext: page < pageCount,
    from: total === 0 ? 0 : offset + 1,
    to: Math.min(offset + size, total),
  };
}

/**
 * Applies a page to an in-memory array.
 *
 * For sets already fully loaded — because the same rows drive a summary, a chart
 * or a calendar on the same screen. Paging those in SQL would mean querying the
 * table twice to draw one page, which is slower than slicing a few hundred rows.
 * Past a few thousand, page in SQL with `limit`/`offset` instead.
 */
export function sliceOffsetPage<T>(rows: readonly T[], page: OffsetPage): T[] {
  return rows.slice(page.offset, page.offset + page.size);
}

/* --------------------------------------------------------------- keyset */

/**
 * An opaque cursor. Base64 only to discourage hand-editing — it is not secret,
 * and it is validated on the way back in, because a crafted cursor must fail
 * closed rather than reach a query builder.
 */
export type Cursor = { at: string; id: string };

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.at}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, "base64url").toString("utf8");
    const separator = raw.lastIndexOf("|");
    if (separator < 1) return null;

    const at = raw.slice(0, separator);
    const id = raw.slice(separator + 1);

    // A timestamp that does not parse, or an id that is not a uuid, is a
    // tampered cursor. Refuse it; the caller starts from the top.
    if (Number.isNaN(Date.parse(at))) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;

    return { at, id };
  } catch {
    return null;
  }
}

export type KeysetPage<T> = {
  rows: T[];
  /** Cursor for the next page, or null at the end. */
  next: string | null;
  hasMore: boolean;
  size: number;
};

/**
 * Turns an over-fetch into a page.
 *
 * The query asks for `size + 1` rows; the extra one is never rendered, it only
 * answers "is there more" without a second `COUNT(*)` over a table that grows
 * for ever.
 */
export function keysetPage<T extends { id: string }>(
  fetched: readonly T[],
  size: number,
  cursorOf: (row: T) => Cursor,
): KeysetPage<T> {
  const hasMore = fetched.length > size;
  const rows = hasMore ? fetched.slice(0, size) : [...fetched];
  const last = rows.at(-1);

  return {
    rows,
    hasMore,
    size,
    next: hasMore && last ? encodeCursor(cursorOf(last)) : null,
  };
}

/* ---------------------------------------------------------------- shared */

function clampInt(
  value: number | string | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (parsed === null || parsed === undefined || !Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * Rebuilds a query string with one key changed, preserving every other filter.
 *
 * Paging that drops the filters is the single most common pagination bug: page 2
 * of a filtered list silently becomes page 2 of everything.
 */
export function withParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
  value: string | null,
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || k === key) continue;
    if (Array.isArray(v)) v.forEach((item) => next.append(k, item));
    else next.set(k, v);
  }
  if (value !== null && value !== "") next.set(key, value);

  const query = next.toString();
  return query ? `?${query}` : "?";
}
