/**
 * Database lifecycle for development.
 *
 *   pnpm db:fresh            drop, create, migrate, seed — one command, clean slate
 *   pnpm db:fresh --full     …and a complete closed previous fiscal year
 *   pnpm db:fresh --empty    …schema only, no demo data
 *   pnpm db:status           what is there now
 *   node scripts/dev/db.mjs create | drop
 *
 * Two things this gets right that a hand-typed `createdb` does not.
 *
 * **Encoding.** The database is created with `ENCODING 'UTF8'` and
 * `TEMPLATE template0` explicitly. A Windows PostgreSQL install defaults its
 * templates to WIN1252, which cannot store Devanagari — and the failure does not
 * surface as an encoding error, it surfaces as a constraint violation on the
 * first Nepali name somebody types, weeks later. Passing template0 is the only
 * way to override an encoding the template already has.
 *
 * **Open connections.** `DROP DATABASE` fails outright if anything is connected,
 * and in development something always is: a dev server, a Drizzle Studio tab, a
 * psql left open yesterday. Sessions are terminated first, and the drop is
 * retried, rather than telling the developer to go and find them.
 */
import {
  ROOT,
  c,
  confirm,
  fatal,
  heading,
  icon,
  line,
  loadEnv,
  migrationStatus,
  parseDbUrl,
  probeDatabase,
  redact,
  step,
  withDatabase,
  withPg,
} from "./lib.mjs";

const env = loadEnv();
const url = env.DATABASE_URL;
if (!url) fatal("DATABASE_URL is not set.", "cp .env.example .env and fill it in");

const target = parseDbUrl(url);
if (!target) fatal("DATABASE_URL is not a valid connection string.");

/**
 * The maintenance connection.
 *
 * You cannot create or drop a database while connected to it, so this borrows
 * the same credentials pointed at `postgres` — the database every server has.
 */
const maintenanceUrl = withDatabase(url, "postgres");

/* ------------------------------------------------------------------ create */

async function databaseExists() {
  return withPg(maintenanceUrl, async (pool) => {
    const r = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [target.database]);
    return r.rowCount > 0;
  });
}

async function createDatabase() {
  await withPg(maintenanceUrl, async (pool) => {
    // Identifiers cannot be parameterised, so the name is quoted rather than
    // interpolated raw. It comes from our own .env, but a database name with a
    // quote in it should fail loudly rather than execute as SQL.
    const name = `"${target.database.replace(/"/g, '""')}"`;
    await pool.query(
      `CREATE DATABASE ${name}
         ENCODING 'UTF8'
         LC_COLLATE 'C'
         LC_CTYPE 'C'
         TEMPLATE template0`,
    );
  });
  line(icon.ok, "Created", `${target.database} · UTF8 · collate C`);
}

async function dropDatabase() {
  await withPg(maintenanceUrl, async (pool) => {
    // Terminate first: a single forgotten Drizzle Studio tab is enough to make
    // the drop fail, and "there is 1 other session using the database" sends
    // people hunting for a process they will not find.
    const killed = await pool.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [target.database],
    );
    if (killed.rowCount > 0) {
      line(icon.info, "Disconnected", `${killed.rowCount} open session(s)`);
    }

    const name = `"${target.database.replace(/"/g, '""')}"`;
    await pool.query(`DROP DATABASE IF EXISTS ${name}`);
  });
  line(icon.ok, "Dropped", target.database);
}

/* ------------------------------------------------------------------ status */

async function status() {
  console.log(c.bold("\nDatabase"));
  console.log(c.grey(`  ${redact(url)}\n`));

  const db = await probeDatabase(url);
  if (!db.reachable) {
    line(icon.fail, "Unreachable", db.error);
    console.log(
      c.grey(
        /does not exist/i.test(db.error ?? "")
          ? "\n  It has not been created yet. Run: pnpm db:fresh\n"
          : "\n  Is PostgreSQL running?\n",
      ),
    );
    process.exit(1);
  }

  line(icon.ok, "Server", `PostgreSQL ${db.server} · ${db.latencyMs}ms`);
  line(
    db.encoding === "UTF8" ? icon.ok : icon.fail,
    "Encoding",
    `${db.encoding} · collate ${db.collate}`,
  );
  line(icon.ok, "Size", `${db.size} across ${db.tables} tables`);

  const m = await migrationStatus(url);
  line(
    m.pending === 0 && m.initialised ? icon.ok : icon.warn,
    "Migrations",
    `${m.applied} applied of ${m.onDisk.length} · ${m.pending} pending`,
  );

  if (db.tables === 0) {
    console.log(c.grey("\n  Schema is empty. Run: pnpm db:migrate\n"));
    return;
  }

  // A row count per interesting table, so "is there data" is answered without
  // opening a client.
  try {
    const rows = await withPg(url, async (pool) => {
      const r = await pool.query(`
        SELECT
          (SELECT count(*) FROM organizations)::int   AS organisations,
          (SELECT count(*) FROM employees)::int       AS employees,
          (SELECT count(*) FROM user_accounts)::int   AS logins,
          (SELECT count(*) FROM fiscal_years)::int    AS fiscal_years,
          (SELECT count(*) FROM leave_requests)::int  AS leave_requests,
          (SELECT count(*) FROM attendance_days)::int AS attendance_days,
          (SELECT count(*) FROM notices)::int         AS notices,
          (SELECT count(*) FROM domain_events WHERE status = 'pending')::int AS queued_events
      `);
      return r.rows[0];
    });

    console.log();
    for (const [key, value] of Object.entries(rows)) {
      line(icon.info, key.replace(/_/g, " "), Number(value).toLocaleString());
    }

    const years = await withPg(url, async (pool) => {
      const r = await pool.query(
        `SELECT code, is_current, is_closed FROM fiscal_years ORDER BY start_date`,
      );
      return r.rows;
    });
    if (years.length) {
      console.log();
      for (const y of years) {
        line(
          y.is_current ? icon.ok : icon.info,
          `FY ${y.code}`,
          y.is_current ? "current" : y.is_closed ? "closed" : "open",
        );
      }
    }
  } catch {
    line(icon.warn, "Data", "tables exist but could not be read — migrations may be partial");
  }

  console.log();
}

/* ------------------------------------------------------------------- fresh */

async function fresh() {
  const full = process.argv.includes("--full");
  const empty = process.argv.includes("--empty");

  console.log(c.bold("\nRebuilding the database from scratch"));
  console.log(c.grey(`  ${redact(url)}`));

  const exists = await databaseExists().catch((error) => {
    fatal(
      `Cannot reach PostgreSQL at ${target.host}:${target.port}.`,
      `${error.message}\n  Is the server running? Check the credentials in .env.`,
    );
  });

  if (exists) {
    // Show what is about to be lost. "Are you sure" is easy to click through;
    // "24 employees and 9,335 attendance days" is not.
    const db = await probeDatabase(url);
    heading("This will permanently delete");
    if (db.reachable) {
      line(icon.warn, "Database", `${target.database} · ${db.size} · ${db.tables} tables`);
      try {
        const counts = await withPg(url, async (pool) => {
          const r = await pool.query(`
            SELECT (SELECT count(*) FROM employees)::int AS e,
                   (SELECT count(*) FROM attendance_days)::int AS d,
                   (SELECT count(*) FROM leave_requests)::int AS l`);
          return r.rows[0];
        });
        line(
          icon.warn,
          "Contents",
          `${counts.e} employees · ${counts.d.toLocaleString()} attendance days · ${counts.l} leave requests`,
        );
      } catch {
        /* schema may predate these tables; the size above is enough */
      }
    }

    console.log();
    const ok = await confirm(
      `  Type ${c.bold(target.database)} to confirm:`,
      target.database,
    );
    if (!ok) {
      console.log(c.grey("\n  Nothing was changed.\n"));
      process.exit(1);
    }

    await dropDatabase();
  } else {
    line(icon.info, "Database", `${target.database} does not exist yet`);
  }

  await createDatabase();

  // Migrations through the same runtime migrator production uses, so a fresh
  // development database is built by exactly the code that builds the server's.
  /*
   * The connection string is passed through the child's environment rather than
   * with --env-file, so a one-off run against a scratch database actually goes
   * there. --env-file would re-read .env and quietly migrate the real database
   * instead - which is the worst possible outcome for a command whose entire
   * purpose is to be destructive somewhere safe.
   */
  await step("Applying migrations", process.execPath, ["scripts/migrate.mjs"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
  });

  if (empty) {
    console.log(c.green("\n  Schema is ready. No demo data (--empty).\n"));
    return;
  }

  await step("Seeding the current year", "pnpm", ["db:seed"], {
    env: { ...process.env, DATABASE_URL: url },
  });

  if (full) {
    await step("Seeding a closed previous year", "pnpm", ["db:seed:history"], {
      env: { ...process.env, DATABASE_URL: url },
    });
  }

  console.log(c.green(`\n  Done. ${target.database} is fresh.`));
  console.log(
    c.grey(
      full
        ? "  Two fiscal years: one open, one closed and locked.\n"
        : "  Add a full closed previous year with: pnpm db:fresh --full\n",
    ),
  );
}

/* -------------------------------------------------------------------- main */

const command = process.argv[2] ?? "status";

const commands = {
  fresh,
  status,
  create: async () => {
    if (await databaseExists()) {
      line(icon.info, "Exists", `${target.database} is already there`);
      return;
    }
    await createDatabase();
  },
  drop: async () => {
    if (!(await databaseExists())) {
      line(icon.info, "Nothing to drop", `${target.database} does not exist`);
      return;
    }
    const ok = await confirm(`  Type ${c.bold(target.database)} to drop it:`, target.database);
    if (!ok) {
      console.log(c.grey("\n  Nothing was changed.\n"));
      process.exit(1);
    }
    await dropDatabase();
  },
};

const handler = commands[command];
if (!handler) {
  fatal(`Unknown command "${command}".`, `Try: ${Object.keys(commands).join(", ")}`);
}

handler().catch((error) => {
  console.error(`\n${c.red("✗")} ${error.message}\n`);
  process.exit(1);
});
