import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * The database behind the product, for the administrator: what it is, how it
 * is doing, and a fixed set of read-only diagnostics.
 *
 * There is deliberately no free-text SQL here. Each diagnostic is a query
 * written into this file, picked by key, and run inside a READ ONLY
 * transaction with a short statement timeout — so the screen can answer the
 * questions an operator asks without becoming a way to run arbitrary code
 * against the database.
 */

export class DiagnosticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagnosticError";
  }
}

const bigint = (v: unknown) => Number(v ?? 0);

export async function serverInfo() {
  const t0 = performance.now();
  await db.execute(sql`select 1`);
  const first = performance.now() - t0;
  // three more round trips; the median is what a page actually feels
  const samples: number[] = [first];
  for (let i = 0; i < 3; i++) {
    const s = performance.now();
    await db.execute(sql`select 1`);
    samples.push(performance.now() - s);
  }
  samples.sort((a, b) => a - b);

  const [row] = (
    await db.execute<Record<string, unknown>>(sql`
      select current_database() as name,
             version() as version_full,
             current_setting('server_version') as version,
             current_user as db_user,
             inet_server_port() as port,
             pg_database_size(current_database())::bigint as size,
             extract(epoch from (now() - pg_postmaster_start_time()))::bigint as uptime_s,
             current_setting('max_connections')::int as max_connections,
             current_setting('TimeZone') as timezone,
             pg_encoding_to_char(d.encoding) as encoding,
             d.datcollate as collation,
             pg_is_in_recovery() as replica,
             (select count(*) from pg_stat_activity where datname = current_database())::int as connections,
             (select count(*) from pg_stat_activity where datname = current_database() and state = 'active')::int as active,
             s.xact_commit::bigint as commits,
             s.xact_rollback::bigint as rollbacks,
             s.deadlocks::bigint as deadlocks,
             s.temp_bytes::bigint as temp_bytes,
             case when s.blks_hit + s.blks_read = 0 then null
                  else round(100.0 * s.blks_hit / (s.blks_hit + s.blks_read), 2) end as cache_hit,
             (select count(*) from pg_stat_user_tables)::int as tables,
             (select count(*) from pg_stat_user_indexes)::int as indexes,
             (select count(*) from pg_stat_user_indexes where idx_scan = 0)::int as unused_indexes,
             (select coalesce(max(extract(epoch from now() - xact_start)), 0)::int from pg_stat_activity
               where datname = current_database() and state <> 'idle' and pid <> pg_backend_pid()) as longest_tx_s,
             (select count(*) from pg_locks where not granted)::int as waiting_locks,
             (select string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension) as extensions
      from pg_database d
      join pg_stat_database s on s.datid = d.oid
      where d.datname = current_database()`)
  ).rows;

  const pool = db.$client;
  let host = "—";
  try {
    host = new URL(process.env.DATABASE_URL ?? "").hostname || "local socket";
  } catch {
    /* an unparsable URL still works for pg; just don't show it */
  }

  return {
    name: String(row.name),
    version: String(row.version),
    versionFull: String(row.version_full),
    user: String(row.db_user),
    host,
    port: row.port === null ? null : Number(row.port),
    sizeBytes: bigint(row.size),
    uptimeSeconds: bigint(row.uptime_s),
    maxConnections: Number(row.max_connections),
    connections: Number(row.connections),
    activeConnections: Number(row.active),
    timezone: String(row.timezone),
    encoding: String(row.encoding),
    collation: String(row.collation),
    replica: Boolean(row.replica),
    commits: bigint(row.commits),
    rollbacks: bigint(row.rollbacks),
    deadlocks: bigint(row.deadlocks),
    tempBytes: bigint(row.temp_bytes),
    cacheHit: row.cache_hit === null ? null : Number(row.cache_hit),
    tables: Number(row.tables),
    indexes: Number(row.indexes),
    unusedIndexes: Number(row.unused_indexes),
    longestTransactionSeconds: Number(row.longest_tx_s),
    waitingLocks: Number(row.waiting_locks),
    extensions: row.extensions ? String(row.extensions) : "",
    latency: { firstMs: first, medianMs: samples[Math.floor(samples.length / 2)], bestMs: samples[0] },
    pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: pool.options.max ?? 10 },
  };
}

export type ServerInfo = Awaited<ReturnType<typeof serverInfo>>;

/* -------------------------------------------------------------- diagnostics */

export const DIAGNOSTIC_ROW_CAP = 200;

/** Every query the screen can run. Keys are what the form posts; nothing else is accepted. */
export const DIAGNOSTICS = {
  "largest-tables": {
    label: "Largest tables",
    hint: "Total size including indexes and TOAST, with live and dead rows.",
    sql: sql`select relname as table, pg_size_pretty(pg_total_relation_size(relid)) as total_size,
                  pg_size_pretty(pg_indexes_size(relid)) as index_size, n_live_tup as live_rows, n_dead_tup as dead_rows
           from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 25`,
  },
  "active-sessions": {
    label: "Connections",
    hint: "Who is connected to this database and what each connection is doing.",
    sql: sql`select pid, usename as db_user, application_name as app, state,
                  to_char(now() - backend_start, 'HH24:MI:SS') as connected_for,
                  to_char(now() - query_start, 'HH24:MI:SS') as query_age, wait_event_type as waiting_on
           from pg_stat_activity where datname = current_database() order by backend_start`,
  },
  "slow-running": {
    label: "Long-running statements",
    hint: "Statements running for more than a second right now.",
    sql: sql`select pid, usename as db_user, state, to_char(now() - query_start, 'HH24:MI:SS') as running_for,
                  left(regexp_replace(query, '\s+', ' ', 'g'), 160) as statement
           from pg_stat_activity
           where datname = current_database() and state <> 'idle' and pid <> pg_backend_pid()
             and now() - query_start > interval '1 second'
           order by query_start`,
  },
  "index-usage": {
    label: "Index usage",
    hint: "How often each index is used. Large indexes with no scans are candidates for review.",
    sql: sql`select relname as table, indexrelname as index, idx_scan as scans,
                  pg_size_pretty(pg_relation_size(indexrelid)) as size
           from pg_stat_user_indexes order by idx_scan asc, pg_relation_size(indexrelid) desc limit 50`,
  },
  "seq-scans": {
    label: "Sequential scans",
    hint: "Tables read end-to-end most often — where a missing index would show.",
    sql: sql`select relname as table, seq_scan, seq_tup_read as rows_read, idx_scan, n_live_tup as live_rows
           from pg_stat_user_tables order by seq_tup_read desc limit 25`,
  },
  locks: {
    label: "Waiting locks",
    hint: "Lock requests not yet granted, and the statement waiting on each.",
    sql: sql`select l.pid, l.locktype, l.mode, l.relation::regclass::text as relation, a.state,
                  to_char(now() - a.query_start, 'HH24:MI:SS') as waiting_for
           from pg_locks l join pg_stat_activity a on a.pid = l.pid where not l.granted`,
  },
  vacuum: {
    label: "Vacuum & analyse",
    hint: "When each table was last cleaned up and its statistics refreshed.",
    sql: sql`select relname as table, n_dead_tup as dead_rows,
                  to_char(greatest(last_vacuum, last_autovacuum), 'YYYY-MM-DD HH24:MI') as last_vacuum,
                  to_char(greatest(last_analyze, last_autoanalyze), 'YYYY-MM-DD HH24:MI') as last_analyse,
                  vacuum_count + autovacuum_count as vacuums
           from pg_stat_user_tables order by n_dead_tup desc limit 30`,
  },
  settings: {
    label: "Key settings",
    hint: "The server settings that most affect this application.",
    sql: sql`select name, setting, unit, short_desc as description from pg_settings
           where name in ('max_connections','shared_buffers','work_mem','maintenance_work_mem','effective_cache_size',
                          'statement_timeout','idle_in_transaction_session_timeout','autovacuum','wal_level',
                          'max_wal_size','random_page_cost','TimeZone','log_min_duration_statement')
           order by name`,
  },
  "row-counts": {
    label: "HR data volumes",
    hint: "How many business records the system holds.",
    sql: sql`select 'employees' as dataset, count(*)::bigint as rows from employees where deleted_at is null
           union all select 'leave requests', count(*) from leave_requests
           union all select 'attendance days', count(*) from attendance_days
           union all select 'overtime claims', count(*) from overtime_claims
           union all select 'work-book days', count(*) from work_book_entries
           union all select 'audit entries', count(*) from audit_log`,
  },
} as const;

export type DiagnosticKey = keyof typeof DIAGNOSTICS;

export function isDiagnosticKey(v: string): v is DiagnosticKey {
  return Object.hasOwn(DIAGNOSTICS, v);
}

export type DiagnosticResult = { columns: string[]; rows: string[][]; truncated: boolean; durationMs: number };

function cell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 500 ? `${s.slice(0, 500)}…` : s;
}

/** Runs one of the fixed diagnostics, read-only, with a 10-second ceiling. */
export async function runDiagnostic(key: DiagnosticKey): Promise<DiagnosticResult> {
  const started = performance.now();
  const rows = await db.transaction(
    async (tx) => {
      await tx.execute(sql`set local statement_timeout = 10000`);
      await tx.execute(sql`set local lock_timeout = 2000`);
      return (await tx.execute<Record<string, unknown>>(DIAGNOSTICS[key].sql)).rows;
    },
    { accessMode: "read only" },
  ).catch((error: { code?: string; message?: string }) => {
    if (error.code === "57014") throw new DiagnosticError("The diagnostic took longer than 10 seconds and was stopped.");
    throw new DiagnosticError(error.message ?? "The diagnostic failed.");
  });
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return {
    columns,
    rows: rows.slice(0, DIAGNOSTIC_ROW_CAP).map((r) => columns.map((c) => cell(r[c]))),
    truncated: rows.length > DIAGNOSTIC_ROW_CAP,
    durationMs: performance.now() - started,
  };
}
