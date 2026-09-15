/**
 * Applies pending migrations. Runtime dependencies only.
 *
 * `drizzle-kit migrate` is the development command; it is a devDependency and
 * needs the TypeScript config, neither of which exists in the production image.
 * This does the same work through `drizzle-orm`'s own migrator, which is a
 * runtime dependency — so the image that runs the migration is the same image
 * that runs the application, and there is no second dependency tree to keep in
 * step.
 *
 * Run as a one-shot container *before* the app starts, never from the app's own
 * boot. Two app replicas starting together would otherwise race for the
 * migration lock, and the loser either crashes or serves traffic against a
 * half-migrated schema.
 *
 *   docker compose run --rm migrate
 *   node scripts/migrate.mjs
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

// A short connect timeout, because the usual failure here is Postgres not being
// up yet and the useful behaviour is to fail fast and be restarted, not to hang
// for the default two minutes while a deploy appears to be stuck.
const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });

const started = Date.now();

try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log(`Migrations applied in ${Date.now() - started}ms.`);
  process.exitCode = 0;
} catch (error) {
  console.error("Migration failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
