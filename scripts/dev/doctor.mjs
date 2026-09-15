/**
 * Environment diagnostics.
 *
 * The question this answers is "why does it not work on my machine", and it
 * answers it in one pass instead of the usual twenty minutes of guessing. Every
 * check either passes, or prints the exact command that fixes it — a diagnostic
 * that reports a problem without a remedy has only moved the guessing later.
 *
 * Exit code is 0 when everything that would stop the app is fine, 1 otherwise.
 * Warnings do not fail: a missing optional tool is worth mentioning and not
 * worth blocking on.
 *
 *   pnpm run dev:doctor
 *   ./bela doctor
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ROOT,
  c,
  heading,
  icon,
  isPortFree,
  line,
  loadEnv,
  migrationStatus,
  parseDbUrl,
  probeDatabase,
  redact,
  whoHasPort,
} from "./lib.mjs";

let failures = 0;
let warnings = 0;
const remedies = [];

function pass(label, detail) {
  line(icon.ok, label, detail);
}
function warn(label, detail, fix) {
  warnings += 1;
  line(icon.warn, c.yellow(label), detail);
  if (fix) remedies.push({ level: "warn", label, fix });
}
function fail(label, detail, fix) {
  failures += 1;
  line(icon.fail, c.red(label), detail);
  if (fix) remedies.push({ level: "fail", label, fix });
}

/* ------------------------------------------------------------------ toolchain */

function checkToolchain() {
  heading("Toolchain");

  const node = process.versions.node;
  const major = Number(node.split(".")[0]);
  if (major >= 20) pass("Node", `v${node}`);
  else fail("Node", `v${node} — 20 or newer required`, "Install Node 20 LTS");

  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const declared = pkg.packageManager ?? "";
  const agent = process.env.npm_config_user_agent ?? "";
  const running = /pnpm\/([\d.]+)/.exec(agent)?.[1];

  if (!running) {
    // Run directly with `node` rather than through pnpm: that is a normal way to
    // invoke this and says nothing about whether pnpm is installed, so it is
    // reported rather than warned about.
    line(icon.info, "pnpm", `project pins ${declared || "no version"}`);
  } else if (declared.includes(running)) {
    pass("pnpm", `v${running}`);
  } else {
    warn("pnpm", `v${running}, project pins ${declared}`, "corepack enable");
  }

  if (existsSync(path.join(ROOT, "node_modules"))) pass("Dependencies", "installed");
  else fail("Dependencies", "node_modules is missing", "pnpm install");
}

/* ----------------------------------------------------------- configuration */

function checkEnv() {
  heading("Configuration");

  const envPath = path.join(ROOT, ".env");
  if (!existsSync(envPath)) {
    fail(".env", "missing", "cp .env.example .env  — then fill in DATABASE_URL and the secret");
    return {};
  }
  pass(".env", "present");

  const env = loadEnv();

  // DATABASE_URL
  const parsed = parseDbUrl(env.DATABASE_URL);
  if (!env.DATABASE_URL) {
    fail("DATABASE_URL", "not set", "Set it in .env — see .env.example");
  } else if (!parsed) {
    fail("DATABASE_URL", "not a valid connection string", "postgres://user:pass@host:5432/dbname");
  } else {
    pass("DATABASE_URL", redact(env.DATABASE_URL));
    if (!parsed.hasPassword) {
      warn("DATABASE_URL", "no password in the URL", "Fine for trust auth; unusual otherwise");
    }
  }

  // The secret that signs every session cookie.
  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (!secret) {
    fail("BETTER_AUTH_SECRET", "not set — sign-in will not work", "openssl rand -base64 48");
  } else if (secret.length < 32) {
    fail("BETTER_AUTH_SECRET", `only ${secret.length} characters`, "openssl rand -base64 48");
  } else if (/^(change|secret|test|dev)/i.test(secret)) {
    warn("BETTER_AUTH_SECRET", "looks like a placeholder", "openssl rand -base64 48");
  } else {
    pass("BETTER_AUTH_SECRET", `${secret.length} characters`);
  }

  // The origin the browser sees. A mismatch here is the classic "sign-in does
  // nothing" — the cookie is set for the wrong host and silently dropped.
  const url = env.BETTER_AUTH_URL ?? "";
  if (!url) {
    warn("BETTER_AUTH_URL", "not set, defaulting to http://localhost:3000");
  } else if (url.endsWith("/")) {
    warn("BETTER_AUTH_URL", `${url} — trailing slash`, "Remove it; it breaks the callback origin");
  } else {
    pass("BETTER_AUTH_URL", url);
  }

  return env;
}

/* -------------------------------------------------------------------- data */

async function checkDatabase(env) {
  heading("Database");

  if (!env.DATABASE_URL) {
    fail("Connection", "skipped — DATABASE_URL is not set");
    return;
  }

  const db = await probeDatabase(env.DATABASE_URL);

  if (!db.reachable) {
    fail("Connection", db.error ?? "unreachable");
    const hint = /ECONNREFUSED/.test(db.error ?? "")
      ? `Nothing is listening on ${db.host}:${db.port} — start PostgreSQL`
      : /does not exist/i.test(db.error ?? "")
        ? `Database "${db.database}" does not exist — run: pnpm db:fresh`
        : /password|authentication/i.test(db.error ?? "")
          ? "Credentials rejected — check the user and password in DATABASE_URL"
          : "Check that PostgreSQL is running and the URL is correct";
    remedies.push({ level: "fail", label: "Database connection", fix: hint });
    return;
  }

  pass("Connection", `${db.host}:${db.port}/${db.database} as ${db.user} — ${db.latencyMs}ms`);
  pass("Server", `PostgreSQL ${db.server}`);

  // The trap this project has actually hit: a Windows install defaults its
  // templates to WIN1252, which cannot store Devanagari, and the failure
  // surfaces as a constraint error on the first Nepali name.
  if (db.encoding === "UTF8") {
    pass("Encoding", `${db.encoding} · collate ${db.collate}`);
  } else {
    fail(
      "Encoding",
      `${db.encoding} — cannot store Devanagari`,
      "Recreate it: pnpm db:fresh  (drops and recreates with UTF8)",
    );
  }

  pass("Size", `${db.size} across ${db.tables} tables`);

  const migrations = await migrationStatus(env.DATABASE_URL);
  if (!migrations.initialised) {
    fail("Migrations", `none applied, ${migrations.onDisk.length} on disk`, "pnpm db:migrate");
  } else if (migrations.pending > 0) {
    fail(
      "Migrations",
      `${migrations.applied} applied, ${migrations.pending} pending`,
      "pnpm db:migrate",
    );
  } else {
    pass("Migrations", `${migrations.applied} applied, up to date`);
  }

  // Seeded or empty? Not a failure either way, but it explains an empty screen.
  if (db.tables > 0) {
    const { withPg } = await import("./lib.mjs");
    try {
      const counts = await withPg(env.DATABASE_URL, async (pool) => {
        const r = await pool.query(`
          SELECT
            (SELECT count(*) FROM employees)::int       AS employees,
            (SELECT count(*) FROM user_accounts)::int    AS accounts,
            (SELECT count(*) FROM attendance_days)::int  AS days,
            (SELECT count(*) FROM fiscal_years)::int     AS years,
            (SELECT count(*) FROM user_accounts WHERE is_system_admin)::int AS admins
        `);
        return r.rows[0];
      });

      if (counts.employees === 0) {
        warn("Demo data", "no employees", "pnpm db:seed  — or pnpm db:fresh for everything");
      } else {
        pass(
          "Data",
          `${counts.employees} employees · ${counts.accounts} logins · ` +
            `${counts.days.toLocaleString()} attendance days · ${counts.years} fiscal years`,
        );
      }

      // The lockout this project shipped a recovery script for.
      if (counts.accounts > 0 && counts.admins === 0) {
        warn(
          "System administrator",
          "nobody holds the break-glass flag",
          "pnpm admin:unlock <email>  — otherwise a role edit can lock everyone out",
        );
      } else if (counts.admins > 0) {
        pass("System administrator", `${counts.admins} account(s)`);
      }
    } catch {
      warn("Data", "schema present but not readable — migrations may be partial");
    }
  }
}

/* ------------------------------------------------------------------- ports */

async function checkPorts(env) {
  heading("Ports");

  const wanted = Number(process.env.PORT ?? 3000);

  if (await isPortFree(wanted)) {
    pass(`Port ${wanted}`, "free");
  } else {
    const owner = await whoHasPort(wanted);
    if (owner.ours) {
      pass(`Port ${wanted}`, `already running — ${owner.detail}`);
    } else {
      warn(
        `Port ${wanted}`,
        `in use by ${owner.detail}`,
        "pnpm run dev:up  — it moves to the next free port automatically",
      );
    }
  }

  const db = parseDbUrl(env.DATABASE_URL);
  if (db) {
    // Answered by the connection attempt above rather than by a bind: a bind
    // says whether *we* could listen on that address, which for a remote
    // database host is not the question and for a local one is only a proxy
    // for it.
    const probe = await probeDatabase(env.DATABASE_URL);
    if (probe.reachable || /does not exist/i.test(probe.error ?? "")) {
      // "database does not exist" still means the server answered.
      pass(`Port ${db.port}`, `PostgreSQL listening on ${db.host}`);
    } else {
      fail(`Port ${db.port}`, `nothing answering on ${db.host} — PostgreSQL is down`);
    }
  }
}

/* ------------------------------------------------------------------- build */

function checkBuild() {
  heading("Build");

  const next = path.join(ROOT, ".next");
  if (existsSync(next)) {
    const standalone = existsSync(path.join(next, "standalone"));
    pass(".next", standalone ? "present, standalone output built" : "present (dev build)");
  } else {
    line(icon.info, ".next", "not built yet — pnpm build");
  }

  for (const file of ["Dockerfile", "docker-compose.yml", "DEPLOYMENT.md"]) {
    if (existsSync(path.join(ROOT, file))) pass(file, "present");
    else warn(file, "missing");
  }
}

/* -------------------------------------------------------------------- main */

async function main() {
  console.log(c.bold("\nBela-HRMS · environment check"));
  console.log(c.grey(`  ${ROOT}`));

  checkToolchain();
  const env = checkEnv();
  await checkDatabase(env);
  await checkPorts(env);
  checkBuild();

  if (remedies.length > 0) {
    heading("What to do");
    for (const r of remedies) {
      const mark = r.level === "fail" ? c.red("✗") : c.yellow("!");
      console.log(`  ${mark} ${r.label}`);
      console.log(`    ${c.cyan(r.fix)}`);
    }
  }

  console.log();
  if (failures > 0) {
    console.log(c.red(`  ${failures} problem(s) will stop the app from working.`));
    if (warnings) console.log(c.yellow(`  ${warnings} warning(s).`));
    console.log();
    process.exit(1);
  }

  if (warnings > 0) {
    console.log(c.yellow(`  Ready, with ${warnings} warning(s).`));
  } else {
    console.log(c.green("  Everything checks out."));
  }
  console.log(c.grey("  Start it with: pnpm run dev:up\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
