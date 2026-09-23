import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// One pool per process. Next.js re-evaluates modules on every hot reload in dev,
// which would otherwise leak a pool per edit until Postgres refuses connections.
const globalForDb = globalThis as unknown as { __erpPool?: Pool };

const int = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/*
 * Pool settings, each a guard against a failure seen in practice:
 *
 *   max                 — Postgres defaults to 100 connections for everything;
 *                         the app keeps well inside that so backups, migrations
 *                         and a console session always get one.
 *   statement_timeout   — one pathological report must not hold a connection
 *                         (and its locks) for minutes while every other request
 *                         queues behind it. 30s is far above any screen's need.
 *   idle_in_transaction — a transaction left open by a crashed request releases
 *                         its row locks instead of blocking approvals all day.
 *   connectionTimeout   — fail fast when the database is down rather than
 *                         hanging the request until the proxy gives up.
 *   application_name    — shows up in pg_stat_activity, so an operator can tell
 *                         the app's connections from a cron job's.
 */
const pool =
  globalForDb.__erpPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: int(process.env.DB_POOL_MAX, 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: int(process.env.DB_CONNECT_TIMEOUT_MS, 10_000),
    statement_timeout: int(process.env.DB_STATEMENT_TIMEOUT_MS, 30_000),
    idle_in_transaction_session_timeout: 60_000,
    application_name: process.env.DB_APPLICATION_NAME ?? "bela-hrms",
    keepAlive: true,
  });

// A dropped idle connection (database restart, network blip) must not crash the
// process; the pool replaces it on the next checkout.
if (!globalForDb.__erpPool) {
  pool.on("error", (error) => console.error("[db] idle client error:", error.message));
}

if (process.env.NODE_ENV !== "production") globalForDb.__erpPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
export type Db = typeof db;
