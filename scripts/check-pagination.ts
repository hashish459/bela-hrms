/**
 * Pagination invariants, asserted without a browser.
 *
 * Both strategies are pure functions of their inputs, which is the point of
 * keeping them out of the page components: the failure modes that matter —
 * a clamped page, a dropped filter, a repeated row at a page boundary, a
 * tampered cursor — are all reachable here in milliseconds.
 *
 * Run with:  pnpm check:pagination
 */
import {
  decodeCursor,
  encodeCursor,
  keysetPage,
  offsetPage,
  sliceOffsetPage,
  withParam,
  MAX_PAGE_SIZE,
} from "@/lib/pagination";

let failures = 0;

function check(condition: boolean, label: string, detail = "") {
  if (condition) console.log(`  ok   ${label}${detail ? `  — ${detail}` : ""}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

function main() {
  console.log("\nPagination\n");

  /* ---------------------------------------------------------------- offset */

  console.log("Offset pages are clamped, never empty by accident");

  const p1 = offsetPage({ page: 1, total: 130, defaultSize: 25 });
  check(p1.pageCount === 6 && p1.from === 1 && p1.to === 25, "first page of 130", `${p1.from}-${p1.to} of ${p1.total}`);

  const last = offsetPage({ page: 6, total: 130, defaultSize: 25 });
  check(last.to === 130 && !last.hasNext, "last page stops at the total", `${last.from}-${last.to}`);

  // The bug this exists to prevent: ?page=999 rendering an empty table that
  // reads as "no records".
  const beyond = offsetPage({ page: 999, total: 130, defaultSize: 25 });
  check(beyond.page === 6, "a page past the end clamps to the last page", `asked 999, got ${beyond.page}`);

  const negative = offsetPage({ page: -4, total: 130, defaultSize: 25 });
  check(negative.page === 1, "a negative page clamps to the first");

  const junk = offsetPage({ page: "drop table", total: 130, defaultSize: 25 });
  check(junk.page === 1 && junk.offset === 0, "junk in the URL falls back to page 1");

  const empty = offsetPage({ page: 3, total: 0, defaultSize: 25 });
  check(
    empty.pageCount === 1 && empty.from === 0 && empty.to === 0 && !empty.hasNext,
    "an empty set is one page, not zero",
  );

  const huge = offsetPage({ page: 1, size: 1_000_000, total: 500 });
  check(huge.size === MAX_PAGE_SIZE, "an absurd page size is capped", `${huge.size}`);

  // Every row appears exactly once across the pages, and none appears twice.
  const rows = Array.from({ length: 57 }, (_, i) => i);
  const seen: number[] = [];
  for (let n = 1; n <= offsetPage({ page: 1, total: 57, defaultSize: 10 }).pageCount; n++) {
    seen.push(...sliceOffsetPage(rows, offsetPage({ page: n, total: 57, defaultSize: 10 })));
  }
  check(
    seen.length === 57 && new Set(seen).size === 57 && seen.every((v, i) => v === i),
    "walking every page yields each row exactly once",
    `${seen.length} rows`,
  );

  /* ---------------------------------------------------------------- keyset */

  console.log("\nKeyset pages do not repeat or skip");

  const at = "2026-09-08T10:00:00.000Z";
  const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const round = decodeCursor(encodeCursor({ at, id }));
  check(round?.at === at && round?.id === id, "a cursor survives a round trip");

  check(decodeCursor("not-base64!!") === null, "a malformed cursor is refused");
  check(decodeCursor(encodeCursor({ at: "nonsense", id })) === null, "a cursor with a bad date is refused");
  check(
    decodeCursor(encodeCursor({ at, id: "'; drop table audit_log; --" })) === null,
    "a cursor whose id is not a uuid is refused",
  );
  check(decodeCursor(null) === null, "no cursor is not an error");

  // The over-fetch: size + 1 rows in, size rows out, and a cursor only when
  // there genuinely is more.
  const feed = Array.from({ length: 51 }, (_, i) => ({
    id: `3f2504e0-4f89-11d3-9a0c-0305e82c33${String(i).padStart(2, "0")}`,
    createdAt: new Date(Date.UTC(2026, 8, 8, 10, 0, i)),
  }));

  const full = keysetPage(feed, 50, (r) => ({ at: r.createdAt.toISOString(), id: r.id }));
  check(full.rows.length === 50, "the extra row is not rendered", `${full.rows.length} shown of 51 fetched`);
  check(full.hasMore && full.next !== null, "a next cursor is issued when there is more");
  check(
    decodeCursor(full.next)?.id === full.rows.at(-1)!.id,
    "the cursor points at the last row shown, not the peeked one",
  );

  const partial = keysetPage(feed.slice(0, 20), 50, (r) => ({
    at: r.createdAt.toISOString(),
    id: r.id,
  }));
  check(!partial.hasMore && partial.next === null, "the final page issues no cursor");

  /* ----------------------------------------------------------- query string */

  console.log("\nPaging preserves the filters");

  const q = withParam({ status: "rejected", q: "dashain", page: "2" }, "page", "3");
  check(
    q.includes("status=rejected") && q.includes("q=dashain") && q.includes("page=3"),
    "changing the page keeps every other filter",
    q,
  );

  const cleared = withParam({ status: "rejected", page: "4" }, "page", null);
  check(
    cleared === "?status=rejected",
    "page 1 drops the parameter rather than writing page=1",
    cleared,
  );

  const multi = withParam({ tag: ["a", "b"], page: "2" }, "page", "5");
  check(
    (multi.match(/tag=/g) ?? []).length === 2,
    "repeated parameters survive",
    multi,
  );

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
