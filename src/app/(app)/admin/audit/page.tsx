import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { Badge, Card, EmptyState, PageHeader, type Tone } from "@/components/ui";
import { CursorPagination } from "@/components/pagination";
import { decodeCursor, keysetPage, PAGE_SIZE } from "@/lib/pagination";

export const metadata = { title: "Audit trail" };

const ACTION_TONE: Record<string, Tone> = {
  create: "ok",
  update: "info",
  delete: "danger",
  approve: "ok",
  reject: "danger",
  cancel: "neutral",
  login: "neutral",
  logout: "neutral",
  login_failed: "warn",
};

type Search = { [key: string]: string | string[] | undefined };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requirePermission("admin.audit.view");
  const params = await searchParams;

  const after = decodeCursor(Array.isArray(params.after) ? params.after[0] : params.after);
  const size = PAGE_SIZE.feed;

  /*
   * Keyset, not offset — and the audit log is the reason the distinction is in
   * the codebase at all.
   *
   * It is append-only, time-ordered and unbounded: it is the one table
   * guaranteed to be large in production. `OFFSET 20000` makes Postgres walk and
   * discard twenty thousand rows to render fifty, so the deeper somebody digs
   * the slower it gets — precisely while they are investigating an incident.
   *
   * The seek predicate below rides the (created_at, id) ordering straight to the
   * right place, so page 400 costs what page 1 costs. It also cannot skip or
   * repeat a row when new entries arrive at the head mid-read, which offset
   * paging over a live log does constantly.
   *
   * `id` breaks ties on identical timestamps. Without it, two rows written in
   * the same millisecond straddle a page boundary and one of them is never seen.
   */
  const seek = after
    ? or(
        lt(auditLog.createdAt, new Date(after.at)),
        and(eq(auditLog.createdAt, new Date(after.at)), lt(auditLog.id, after.id)),
      )
    : undefined;

  // One row more than the page: the extra answers "is there more" without a
  // COUNT(*) over a table that only grows.
  const fetched = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.orgId, viewer.orgId), seek))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(size + 1);

  const page = keysetPage(fetched, size, (row) => ({
    at: row.createdAt.toISOString(),
    id: row.id,
  }));
  const rows = page.rows;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(eq(auditLog.orgId, viewer.orgId));

  return (
    <>
      <PageHeader
        title="Audit trail"
        description={`Every write records who, what and which fields changed. ${total.toLocaleString()} entries.`}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="Nothing recorded yet" />
        </Card>
      ) : (
        <Card>
          <ol className="divide-y divide-line-soft">
            {rows.map((r) => {
              const changes = r.changes ?? {};
              const keys = Object.keys(changes);
              return (
                <li key={r.id} className="flex gap-3 px-4 py-3">
                  <div className="w-36 shrink-0">
                    <p className="tabular text-xs text-ink-soft">
                      {new Date(r.createdAt).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <p className="truncate text-[11px] text-ink-faint">{r.actorLabel ?? "System"}</p>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                      <Badge tone={ACTION_TONE[r.action] ?? "neutral"}>
                        {r.action.replace(/_/g, " ")}
                      </Badge>
                      <span>{r.summary}</span>
                      <span className="font-mono text-[11px] text-ink-faint">{r.entityType}</span>
                    </p>

                    {keys.length > 0 ? (
                      <ul className="mt-1.5 flex flex-col gap-0.5">
                        {keys.slice(0, 6).map((k) => (
                          <li key={k} className="text-xs text-ink-soft">
                            <span className="font-mono text-[11px] text-ink-faint">{k}</span>{" "}
                            <span className="text-ink-faint line-through">
                              {String(changes[k].from ?? "—")}
                            </span>{" "}
                            <span aria-hidden>→</span>{" "}
                            <span className="text-ink">{String(changes[k].to ?? "—")}</span>
                          </li>
                        ))}
                        {keys.length > 6 ? (
                          <li className="text-[11px] text-ink-faint">
                            and {keys.length - 6} more field(s)
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>

          <CursorPagination
            next={page.next}
            previous={Array.isArray(params.after) ? (params.after[0] ?? null) : (params.after ?? null)}
            params={params}
            shown={rows.length}
          />
        </Card>
      )}
    </>
  );
}
