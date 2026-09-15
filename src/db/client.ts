import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// One pool per process. Next.js re-evaluates modules on every hot reload in dev,
// which would otherwise leak a pool per edit until Postgres refuses connections.
const globalForDb = globalThis as unknown as { __erpPool?: Pool };

const pool =
  globalForDb.__erpPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__erpPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
export type Db = typeof db;
