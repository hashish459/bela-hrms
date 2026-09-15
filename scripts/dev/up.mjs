/**
 * Bring the whole thing up with one command.
 *
 *   pnpm run dev:up                 checks, migrates if needed, starts the dev server
 *   pnpm run dev:up --port 4000     on a specific port
 *   pnpm run dev:up --fresh         rebuild the database first
 *   pnpm run dev:up --prod          production build and start, not the dev server
 *   pnpm run dev:up --studio        also open Drizzle Studio
 *
 * The steps in order, because the order is the point:
 *
 *   1. Is PostgreSQL reachable, and is the database the right encoding?
 *   2. Is the schema behind the code? Apply migrations if so.
 *   3. Is there any data? Say so rather than presenting an empty app.
 *   4. Is the port free? If not, move — and move BETTER_AUTH_URL with it.
 *   5. Start, and print the credentials somebody needs to sign in.
 *
 * Step four matters more than it looks. Starting on a different port without
 * changing BETTER_AUTH_URL produces an app that loads, accepts a password, and
 * then silently fails to sign in — the cookie is scoped to the wrong origin and
 * the browser drops it. Every "the login button does nothing" report on this
 * project has been that.
 */
import {
  ROOT,
  c,
  fatal,
  findFreePort,
  heading,
  icon,
  isPortFree,
  line,
  loadEnv,
  migrationStatus,
  parseDbUrl,
  probeDatabase,
  run,
  step,
  whoHasPort,
  withPg,
} from "./lib.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const wantProd = flag("prod");
const wantFresh = flag("fresh");
const wantStudio = flag("studio");
const requestedPort = Number(value("port", process.env.PORT ?? 3000));

async function main() {
  console.log(c.bold("\nBela-HRMS"));
  console.log(c.grey(`  ${ROOT}\n`));

  const env = loadEnv();
  if (!env.DATABASE_URL) {
    fatal("DATABASE_URL is not set.", "cp .env.example .env, then run: pnpm run dev:doctor");
  }

  /* ------------------------------------------------------------ 1 · database */

  heading("Database");

  if (wantFresh) {
    await step("Rebuilding from scratch", "pnpm", ["db:fresh", "--full"]);
  }

  const db = await probeDatabase(env.DATABASE_URL);
  const target = parseDbUrl(env.DATABASE_URL);

  if (!db.reachable) {
    if (/does not exist/i.test(db.error ?? "")) {
      line(icon.warn, "Missing", `"${target.database}" has not been created`);
      console.log(c.grey("\n  Create and seed it now with:  pnpm db:fresh --full\n"));
      process.exit(1);
    }
    line(icon.fail, "Unreachable", db.error ?? "");
    console.log(
      c.grey(
        `\n  Nothing is answering at ${target.host}:${target.port}.` +
          "\n  Start PostgreSQL, then run: pnpm run dev:doctor\n",
      ),
    );
    process.exit(1);
  }

  line(icon.ok, "Connected", `${target.host}:${target.port}/${target.database} · ${db.latencyMs}ms`);

  // The encoding trap. Refuse to start rather than let somebody discover it
  // three weeks later when a Nepali name fails to save.
  if (db.encoding !== "UTF8") {
    line(icon.fail, "Encoding", `${db.encoding} — cannot store Devanagari`);
    console.log(c.grey("\n  Rebuild it with the right encoding:  pnpm db:fresh\n"));
    process.exit(1);
  }
  line(icon.ok, "Encoding", `${db.encoding} · collate ${db.collate}`);

  /* ---------------------------------------------------------- 2 · migrations */

  const migrations = await migrationStatus(env.DATABASE_URL);
  if (migrations.pending > 0 || !migrations.initialised) {
    line(icon.warn, "Migrations", `${migrations.pending} pending — applying`);
    await step("Applying migrations", process.execPath, ["scripts/migrate.mjs"], {
      env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
    });
  } else {
    line(icon.ok, "Migrations", `${migrations.applied} applied, up to date`);
  }

  /* ---------------------------------------------------------------- 3 · data */

  let logins = [];
  try {
    const info = await withPg(env.DATABASE_URL, async (pool) => {
      const counts = await pool.query(`
        SELECT (SELECT count(*) FROM employees)::int AS employees,
               (SELECT count(*) FROM attendance_days)::int AS days,
               (SELECT count(*) FROM fiscal_years)::int AS years`);
      // Aggregated, not joined row-per-role: an account holding two roles was
      // being listed twice, which reads as two different logins.
      const accounts = await pool.query(`
        SELECT u.email,
               string_agg(DISTINCT r.name, ', ' ORDER BY r.name) AS role,
               bool_or(ua.is_system_admin) AS is_system_admin
          FROM user_accounts ua
          JOIN "user" u ON u.id = ua.user_id
          LEFT JOIN user_roles ur ON ur.user_id = ua.user_id
          LEFT JOIN roles r ON r.id = ur.role_id
         GROUP BY u.email
         ORDER BY bool_or(ua.is_system_admin) DESC, u.email
         LIMIT 8`);
      return { counts: counts.rows[0], accounts: accounts.rows };
    });

    if (info.counts.employees === 0) {
      line(icon.warn, "Data", "no employees — the app will look empty");
      console.log(c.grey("     Seed it with: pnpm db:seed  (or pnpm db:fresh --full)"));
    } else {
      line(
        icon.ok,
        "Data",
        `${info.counts.employees} employees · ${info.counts.days.toLocaleString()} attendance days · ` +
          `${info.counts.years} fiscal years`,
      );
    }
    logins = info.accounts;
  } catch {
    line(icon.warn, "Data", "could not be read — schema may be partial");
  }

  /* ---------------------------------------------------------------- 4 · port */

  heading("Port");

  let port = requestedPort;
  if (await isPortFree(port)) {
    line(icon.ok, `Port ${port}`, "free");
  } else {
    const owner = await whoHasPort(port);

    if (owner.ours) {
      line(icon.warn, `Port ${port}`, `already serving Bela-HRMS (${owner.status})`);
      console.log(
        c.grey(
          `\n  It is already running: ${c.cyan(`http://localhost:${port}`)}` +
            "\n  Stop it first, or start a second instance on another port with --port.\n",
        ),
      );
      process.exit(0);
    }

    const next = await findFreePort(port + 1);
    if (!next) fatal(`Ports ${port}–${port + 20} are all in use.`);

    line(icon.warn, `Port ${port}`, `taken by ${owner.detail}`);
    line(icon.ok, `Port ${next}`, "free — using this instead");
    port = next;
  }

  /*
   * The session cookie is scoped to this origin. If the port moved and the
   * environment still names the old one, sign-in fails silently — so the value
   * is corrected for this run rather than left to be discovered.
   */
  const origin = `http://localhost:${port}`;
  const childEnv = { ...process.env, PORT: String(port) };
  if ((env.BETTER_AUTH_URL ?? "").replace(/\/$/, "") !== origin) {
    childEnv.BETTER_AUTH_URL = origin;
    if (env.BETTER_AUTH_URL) {
      line(icon.info, "Auth origin", `overridden to ${origin} for this run`);
    }
  }

  /* --------------------------------------------------------------- 5 · start */

  if (wantStudio) {
    // Detached and quiet: Studio is a side car, and its output interleaved with
    // the dev server's is unreadable.
    run("pnpm", ["db:studio"], { stdio: "ignore", detached: true });
    line(icon.ok, "Drizzle Studio", "starting at https://local.drizzle.studio");
  }

  heading(wantProd ? "Production build" : "Development server");

  if (logins.length > 0) {
    console.log(c.grey("  Sign in with:"));
    for (const l of logins.slice(0, 4)) {
      const badge = l.is_system_admin ? c.cyan(" [system admin]") : "";
      console.log(`    ${c.bold(l.email.padEnd(34))} ${c.grey(l.role ?? "no role")}${badge}`);
    }
    console.log(c.grey("  Demo passwords are listed on the sign-in page.\n"));
  }

  console.log(`  ${c.bold("→")} ${c.cyan(origin)}\n`);

  if (wantProd) {
    await step("Building", "pnpm", ["build"], { env: childEnv });
    await run("pnpm", ["start", "--", "--port", String(port)], { env: childEnv });
  } else {
    await run("pnpm", ["exec", "next", "dev", "--port", String(port)], { env: childEnv });
  }
}

main().catch((error) => {
  console.error(`\n${c.red("✗")} ${error.message}\n`);
  process.exit(1);
});
