/**
 * Shared plumbing for the development automation.
 *
 * Written in Node rather than shell, deliberately. The team runs Git Bash on
 * Windows, zsh on macOS and bash on a Linux VPS, and the shell tools these
 * scripts would otherwise need — `lsof`, `psql`, `pg_isready`, `timeout` — are
 * absent or subtly different on at least one of them. Node is already a hard
 * requirement, `pg` is already a dependency, and both behave the same way
 * everywhere. A "portable" shell script that only ever ran on the author's
 * machine is worse than no script.
 *
 * Nothing here writes to the database. Anything destructive lives in db.mjs
 * behind a confirmation.
 */
import { createServer } from "node:net";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/* ------------------------------------------------------------------ output */

// Colour only when a human is watching. Piping into a log file or CI should
// produce plain text, not escape codes nobody can grep.
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
// Built from a char code rather than written as a literal escape. An ESC byte
// sitting in source is invisible in review and easy to destroy with a careless
// find-and-replace, which is what happened to this line once already.
const ESC = String.fromCharCode(27);
const wrap = (code) => (s) => (tty ? `${ESC}[${code}m${s}${ESC}[0m` : String(s));

export const c = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  cyan: wrap(36),
  grey: wrap(90),
};

export const icon = {
  ok: c.green("✓"),
  warn: c.yellow("!"),
  fail: c.red("✗"),
  info: c.blue("·"),
};

export function heading(text) {
  console.log(`\n${c.bold(text)}`);
}

/** Aligned status line: `✓ label     detail`. */
export function line(mark, label, detail = "") {
  console.log(`  ${mark} ${label.padEnd(30)} ${detail ? c.grey(detail) : ""}`);
}

export function fatal(message, hint) {
  console.error(`\n${c.red("✗")} ${message}`);
  if (hint) console.error(`  ${c.grey(hint)}\n`);
  process.exit(1);
}

/* --------------------------------------------------------------------- env */

/**
 * Reads .env without a dependency.
 *
 * Node's own `--env-file` would do this, but these scripts need the values
 * *before* deciding which flags to pass to the process they spawn — the port,
 * for one — so the file has to be parsed here as well.
 */
export function loadEnv(file = ".env") {
  const full = path.join(ROOT, file);
  if (!existsSync(full)) return {};

  const out = {};
  for (const raw of readFileSync(full, "utf8").split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // Strip matching quotes, which people add when a password contains a #
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }

  /*
   * The real environment overrides the file.
   *
   * Standard precedence, and it is what makes these scripts usable outside a
   * developer's laptop: CI has no .env, and a one-off run against a scratch
   * database should be `DATABASE_URL=... pnpm db:fresh` rather than editing a
   * file and remembering to change it back.
   */
  for (const key of new Set([
    ...Object.keys(out),
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
  ])) {
    if (process.env[key]) out[key] = process.env[key];
  }

  return out;
}

/** Parses DATABASE_URL into parts, without throwing on a malformed one. */
export function parseDbUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 5432),
      database: decodeURIComponent(u.pathname.replace(/^\//, "")),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      hasPassword: u.password !== "",
    };
  } catch {
    return null;
  }
}

/**
 * The same URL pointed at a different database.
 *
 * Creating or dropping a database requires a connection to a *different* one —
 * you cannot drop the database you are connected to — so this builds the
 * maintenance URL from the application's own credentials rather than asking for
 * a second set nobody would keep in step.
 */
export function withDatabase(url, database) {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/**
 * Hides the password when a connection string has to be printed.
 *
 * Rebuilt by hand rather than by setting `url.password` and calling toString():
 * WHATWG URL percent-encodes whatever you assign, so a mask of bullets came out
 * as `%E2%80%A2%E2%80%A2%E2%80%A2` — technically redacted, unreadable in a
 * terminal, and it made the host look wrong at a glance.
 */
export function redact(url) {
  if (!url) return "(not set)";
  try {
    const u = new URL(url);
    const auth = u.username ? `${u.username}${u.password ? ":***" : ""}@` : "";
    const port = u.port ? `:${u.port}` : "";
    return `${u.protocol}//${auth}${u.hostname}${port}${u.pathname}`;
  } catch {
    return "(unparseable)";
  }
}

/* -------------------------------------------------------------------- ports */

/**
 * Is a TCP port free?
 *
 * Binds and immediately closes, rather than shelling out to netstat or lsof.
 * Those name the *owner*, which is occasionally useful, but they differ across
 * platforms and neither exists everywhere. Binding answers the only question
 * that matters — can the server start here.
 *
 * The host argument defaults to *unspecified*, and that detail is the whole
 * correctness of this function. Next binds `::` (dual-stack, every interface);
 * binding a probe to `127.0.0.1` only asks about IPv4 loopback, so a port held
 * by our own dev server came back "free" and Next then died with EADDRINUSE a
 * second later. Omitting the host makes the probe bind the same way the server
 * will, so it fails whenever the server would.
 *
 * Pass a host explicitly only when the question really is about one interface —
 * "is PostgreSQL listening on this address", for instance.
 */
export function isPortFree(port, host) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    if (host) server.listen(port, host);
    else server.listen(port);
  });
}

/**
 * The first free port at or after `start`.
 *
 * Sequential rather than random: a developer who was on 3000 yesterday and is on
 * 3001 today can still guess where the app went. A random high port is
 * technically fine and practically infuriating.
 */
export async function findFreePort(start, limit = 20) {
  for (let port = start; port < start + limit; port++) {
    if (await isPortFree(port)) return port;
  }
  return null;
}

/**
 * Whether whatever holds a port is this application.
 *
 * A previous `pnpm dev` left running is worth reusing or replacing; somebody
 * else's Postgres on 3000 is not something to kill. The health endpoint
 * identifies us without needing to inspect the process table.
 */
export async function whoHasPort(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    const body = await res.json().catch(() => null);
    if (body && typeof body.status === "string" && "database" in body) {
      return { ours: true, status: body.status, detail: `Bela-HRMS, database ${body.database}` };
    }
    return { ours: false, detail: `something answering HTTP ${res.status}` };
  } catch {
    return { ours: false, detail: "an unknown process" };
  }
}

/* ----------------------------------------------------------------- postgres */

/**
 * Connects, runs `fn`, and always closes.
 *
 * A short connect timeout because the usual failure is "Postgres is not
 * running", and the useful behaviour is to say so in two seconds rather than
 * hang for the driver's default two minutes.
 */
export async function withPg(connectionString, fn, { timeoutMs = 4000 } = {}) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: timeoutMs,
    // Never let a diagnostic hang a terminal.
    statement_timeout: 15_000,
  });
  try {
    return await fn(pool);
  } finally {
    await pool.end().catch(() => {});
  }
}

/** Reachability plus the facts worth knowing about the server. */
export async function probeDatabase(url) {
  const parsed = parseDbUrl(url);
  if (!parsed) return { reachable: false, error: "DATABASE_URL is not a valid connection string" };

  try {
    return await withPg(url, async (pool) => {
      const started = Date.now();
      const version = await pool.query("SELECT version()");
      const latencyMs = Date.now() - started;

      const encoding = await pool.query(
        `SELECT pg_encoding_to_char(encoding) AS encoding, datcollate, datctype
           FROM pg_database WHERE datname = current_database()`,
      );

      const size = await pool.query(
        "SELECT pg_size_pretty(pg_database_size(current_database())) AS size",
      );

      const tables = await pool.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'",
      );

      return {
        reachable: true,
        latencyMs,
        server: /PostgreSQL ([\d.]+)/.exec(version.rows[0].version)?.[1] ?? "unknown",
        encoding: encoding.rows[0]?.encoding ?? "unknown",
        collate: encoding.rows[0]?.datcollate ?? "unknown",
        size: size.rows[0]?.size ?? "unknown",
        tables: tables.rows[0]?.n ?? 0,
        ...parsed,
      };
    });
  } catch (error) {
    return { reachable: false, error: error.message, ...parsed };
  }
}

/**
 * Which migrations have been applied, and which are still on disk.
 *
 * Drizzle records a hash per applied migration in `drizzle.__drizzle_migrations`.
 * Comparing counts is enough to answer the question that matters before starting
 * a dev server: is the schema behind the code.
 */
export async function migrationStatus(url) {
  const dir = path.join(ROOT, "drizzle");
  const { readdirSync } = await import("node:fs");

  const onDisk = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];

  try {
    return await withPg(url, async (pool) => {
      const exists = await pool.query(
        `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`,
      );
      if (!exists.rows[0]?.present) {
        return { onDisk, applied: 0, pending: onDisk.length, initialised: false };
      }

      const applied = await pool.query(
        "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
      );
      const count = applied.rows[0]?.n ?? 0;
      return {
        onDisk,
        applied: count,
        pending: Math.max(0, onDisk.length - count),
        initialised: true,
      };
    });
  } catch (error) {
    return { onDisk, applied: 0, pending: onDisk.length, initialised: false, error: error.message };
  }
}

/* ------------------------------------------------------------------ process */

/**
 * Runs a command, inheriting stdio, and resolves with its exit code.
 *
 * `shell: true` on Windows only: pnpm is a .cmd there and will not spawn
 * without it, while on POSIX a shell would mangle arguments containing spaces.
 */
export function run(command, args, options = {}) {
  return new Promise((resolve) => {
    // Windows needs `shell: true` because pnpm is a .cmd and will not spawn
    // otherwise. But cmd.exe splits on spaces, so an absolute path like
    // "C:\\Program Files\\nodejs\\node.exe" becomes the command "C:\\Program"
    // with a stray argument — quoting it is the whole fix, and forgetting to is
    // the single most common way a cross-platform script dies on Windows.
    const win = process.platform === "win32";
    const useShell = options.shell ?? win;
    const bin = useShell && win && /\s/.test(command) ? `"${command}"` : command;

    const child = spawn(bin, args, {
      cwd: ROOT,
      stdio: "inherit",
      ...options,
      shell: useShell,
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

/** Runs a step and aborts the whole script if it fails. */
export async function step(label, command, args, options) {
  console.log(`\n${c.cyan("▸")} ${c.bold(label)} ${c.grey(`${command} ${args.join(" ")}`)}`);
  const code = await run(command, args, options);
  if (code !== 0) fatal(`${label} failed (exit ${code}).`);
  return code;
}

/** Yes/no on the terminal. Defaults to no: destructive things need a real yes. */
export async function confirm(question, expected) {
  if (process.env.CI || process.argv.includes("--yes") || process.argv.includes("-y")) {
    return true;
  }

  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} `)).trim();
    return expected ? answer === expected : /^y(es)?$/i.test(answer);
  } finally {
    rl.close();
  }
}
