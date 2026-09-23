import { and, asc, eq, lt, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { can, getViewer } from "@/lib/session";

/**
 * The audit rows the current policy is about to clear, as CSV — so an
 * organisation that must keep its trail elsewhere downloads it first.
 *
 * `?days=730` exports everything older than that many days. Capped at 200,000
 * rows per file; export again after purging for the next slice.
 */
const LIMIT = 200_000;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "object" ? JSON.stringify(value) : String(value);
  // a spreadsheet would run a leading = + - @ as a formula
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer || !can(viewer, "admin.retention.manage")) return new Response("Not found", { status: 404 });

  const days = Math.max(0, Math.min(36500, Number(request.nextUrl.searchParams.get("days") ?? 730) || 0));
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.orgId, viewer.orgId), lt(auditLog.createdAt, sql`now() - make_interval(days => ${days})`)))
    .orderBy(asc(auditLog.createdAt))
    .limit(LIMIT);

  const header = ["created_at", "actor", "action", "entity_type", "entity_id", "summary", "changes", "ip_address"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [r.createdAt.toISOString(), r.actorLabel, r.action, r.entityType, r.entityId, r.summary, r.changes, r.ipAddress]
        .map(cell)
        .join(","),
    );
  }

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-older-than-${days}-days.csv"`,
      "cache-control": "no-store",
    },
  });
}
