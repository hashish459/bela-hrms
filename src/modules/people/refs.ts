import "server-only";

import { sql } from "drizzle-orm";
import type { Tx } from "@/kernel/events";

/**
 * The next human reference in a series — `TRF-2083-0007`, `SEP-2083-0002`.
 *
 * Counting rows and adding one is only safe if two requests cannot count at the
 * same moment, so the count runs under a transaction-scoped advisory lock keyed
 * on the series. The lock is released on commit or rollback; nothing else in
 * the database waits on it.
 */
export async function nextReference(
  tx: Tx,
  input: { orgId: string; prefix: string; year: number; table: "employee_movements" | "employee_separations" },
): Promise<string> {
  const series = `${input.orgId}:${input.prefix}-${input.year}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${series}))`);
  const like = `${input.prefix}-${input.year}-%`;
  const result = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(input.table)} where org_id = ${input.orgId} and reference like ${like}`,
  );
  const n = Number(result.rows[0]?.n ?? 0);
  return `${input.prefix}-${input.year}-${String(n + 1).padStart(4, "0")}`;
}
