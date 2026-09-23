/**
 * Scale benchmark against production-shaped data.
 *
 *   node scripts/dev/bench.mjs --build   generate the dataset (destructive, scratch DB)
 *   node scripts/dev/bench.mjs           measure the hot queries
 *   node scripts/dev/bench.mjs --explain also print the plans
 *
 * The numbers this targets come from the recovered production database, not
 * from a guess: 459 employees, 52 branches, 19 departments, and 1.74 M
 * attendance rows over ten years. The demo database has 24 employees and 9 K
 * attendance rows — three orders of magnitude off, which is exactly the gap
 * where a query that looks instant in development becomes a thirty-second page
 * in production.
 *
 * It runs against a **scratch database** (`bela_bench`), never the one the app
 * is using. The connection string is derived from DATABASE_URL, so it follows
 * whatever server you are pointed at without a second set of credentials.
 *
 * What it measures is the SQL the pages actually issue. A benchmark of invented
 * queries measures the benchmark.
 */
import pg from "pg";
import { c, heading, icon, line, loadEnv, withDatabase } from "./lib.mjs";

const BENCH_DB = "bela_bench";
const EMPLOYEES = 459;
const YEARS = 2;

const env = loadEnv();
if (!env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const benchUrl = withDatabase(env.DATABASE_URL, BENCH_DB);
const wantBuild = process.argv.includes("--build");
const wantExplain = process.argv.includes("--explain");

async function connect(url) {
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  return pool;
}

/* ------------------------------------------------------------------ build */

async function build() {
  heading(`Building a ${EMPLOYEES}-employee dataset in ${BENCH_DB}`);

  const admin = await connect(withDatabase(env.DATABASE_URL, "postgres"));
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [BENCH_DB],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${BENCH_DB}"`);
  await admin.query(
    `CREATE DATABASE "${BENCH_DB}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`,
  );
  await admin.end();
  line(icon.ok, "Created", BENCH_DB);

  const { run } = await import("./lib.mjs");
  const childEnv = { ...process.env, DATABASE_URL: benchUrl };

  if ((await run(process.execPath, ["scripts/migrate.mjs"], { env: childEnv })) !== 0) {
    console.error("Migration failed.");
    process.exit(1);
  }
  line(icon.ok, "Migrated", "schema applied");

  if ((await run("pnpm", ["db:seed"], { env: childEnv, stdio: "ignore" })) !== 0) {
    console.error("Seed failed.");
    process.exit(1);
  }
  line(icon.ok, "Seeded", "organisation, structure, 24 employees");

  const pool = await connect(benchUrl);

  const [{ id: orgId }] = (await pool.query("SELECT id FROM organizations LIMIT 1")).rows;
  const branches = (await pool.query("SELECT id FROM branches WHERE org_id = $1", [orgId])).rows;
  const departments = (await pool.query("SELECT id FROM departments WHERE org_id = $1", [orgId]))
    .rows;
  const shifts = (await pool.query("SELECT id FROM shifts WHERE org_id = $1 LIMIT 1", [orgId])).rows;

  /*
   * Bulk generation in SQL, not in JavaScript.
   *
   * 335,000 rows through the driver one INSERT at a time is minutes of round
   * trips; `generate_series` builds them inside the server in seconds. The
   * point of the harness is to reach production scale quickly enough that
   * somebody will actually run it.
   */
  heading("Generating");

  const started = Date.now();

  await pool.query(
    `
    INSERT INTO employees (
      org_id, employee_code, first_name, last_name, gender, date_of_join,
      status, branch_id, department_id, work_email, mobile
    )
    SELECT
      $1,
      'BEN' || lpad(g::text, 5, '0'),
      (ARRAY['Aarav','Sita','Ram','Gita','Bikash','Sunita','Hari','Maya','Kiran','Nabin'])[1 + (g % 10)],
      (ARRAY['Sharma','Thapa','Gurung','Rai','Magar','Shrestha','Tamang','Limbu'])[1 + (g % 8)],
      (ARRAY['male','female']::gender[])[1 + (g % 2)],
      DATE '2019-01-01' + ((g * 7) % 2000),
      'active',
      ($2::uuid[])[1 + (g % $3)],
      ($4::uuid[])[1 + (g % $5)],
      'bench' || g || '@bela.example.np',
      '98' || lpad(g::text, 8, '0')
    FROM generate_series(1, $6) g
    ON CONFLICT DO NOTHING
    `,
    [
      orgId,
      branches.map((b) => b.id),
      branches.length,
      departments.map((d) => d.id),
      departments.length,
      EMPLOYEES - 24,
    ],
  );

  const empCount = (await pool.query("SELECT count(*)::int n FROM employees")).rows[0].n;
  line(icon.ok, "Employees", `${empCount}`);

  /*
   * Attendance: every employee, every day, for the requested span. This is the
   * table that reached 1.74 M rows in production.
   *
   * The variation is driven by the day number since an epoch rather than by
   * random(): a deterministic dataset means two runs of the benchmark are
   * comparable, which is the whole point of measuring.
   */
  await pool.query(
    `
    INSERT INTO attendance_days (
      org_id, employee_id, date, date_bs, shift_id,
      check_in, check_out, worked_minutes, late_minutes, ot_minutes, status, source
    )
    SELECT
      $1,
      e.id,
      d::date,
      to_char(d, 'YYYY-MM-DD'),
      $2,
      CASE WHEN extract(dow from d) = 6 THEN NULL
           ELSE TIME '09:00' + ((dn % 25) * INTERVAL '1 minute') END,
      CASE WHEN extract(dow from d) = 6 THEN NULL ELSE TIME '17:30' END,
      CASE WHEN extract(dow from d) = 6 THEN 0 ELSE 480 END,
      CASE WHEN (dn % 7) = 0 THEN 12 ELSE 0 END,
      0,
      (CASE
         WHEN extract(dow from d) = 6 THEN 'weekly_off'
         WHEN (dn % 23) = 0 THEN 'absent'
         WHEN (dn % 17) = 0 THEN 'on_leave'
         WHEN (dn % 31) = 0 THEN 'half_day'
         ELSE 'present'
       END)::attendance_status,
      'device'
    FROM employees e
    CROSS JOIN LATERAL (
      SELECT d, (d::date - DATE '2000-01-01') AS dn
        FROM generate_series(
               CURRENT_DATE - ($3 * 365), CURRENT_DATE, INTERVAL '1 day'
             ) AS d
    ) days
    WHERE e.org_id = $1
    ON CONFLICT DO NOTHING
    `,
    [orgId, shifts[0]?.id ?? null, YEARS],
  );

  const dayCount = (await pool.query("SELECT count(*)::int n FROM attendance_days")).rows[0].n;
  line(icon.ok, "Attendance days", `${dayCount.toLocaleString()}`);

  // The planner needs statistics before any of this means anything.
  await pool.query("ANALYZE");
  line(icon.ok, "Analyzed", `${((Date.now() - started) / 1000).toFixed(1)}s total`);

  await pool.end();
}

/* ---------------------------------------------------------------- measure */

/**
 * The queries the hot pages actually run.
 *
 * Kept as SQL rather than called through the services so the harness can run
 * without booting Next, and so a plan can be read next to the statement that
 * produced it.
 */
function queries(orgId, employeeId, from, to) {
  return [
    {
      name: "dashboard · attendance mix (month)",
      page: "/dashboard",
      sql: `SELECT status, count(*) FROM attendance_days
             WHERE org_id = $1 AND date BETWEEN $2 AND $3 GROUP BY status`,
      params: [orgId, from, to],
    },
    {
      name: "dashboard · mix by department",
      page: "/dashboard",
      sql: `SELECT d.name, a.status, count(*)
              FROM attendance_days a
              JOIN employees e ON e.id = a.employee_id
              JOIN departments d ON d.id = e.department_id
             WHERE a.org_id = $1 AND a.date BETWEEN $2 AND $3
               AND a.status IN ('present','field_work','half_day','absent','on_leave')
             GROUP BY d.name, a.status`,
      params: [orgId, from, to],
    },
    {
      name: "monthly sheet · all staff, one month",
      page: "/attendance/monthly",
      sql: `SELECT employee_id, date, status, worked_minutes
              FROM attendance_days
             WHERE org_id = $1 AND date BETWEEN $2 AND $3`,
      params: [orgId, from, to],
    },
    {
      name: "my attendance · one employee, one month",
      page: "/me · /attendance/my",
      sql: `SELECT * FROM attendance_days
             WHERE employee_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`,
      params: [employeeId, from, to],
    },
    {
      name: "desk · last 30 days",
      page: "/me",
      sql: `SELECT date, status, worked_minutes, late_minutes, ot_minutes
              FROM attendance_days
             WHERE employee_id = $1 AND date >= CURRENT_DATE - 30 AND date <= CURRENT_DATE
             ORDER BY date DESC`,
      params: [employeeId],
    },
    {
      name: "payroll · period summary, all staff",
      page: "payroll port",
      sql: `SELECT employee_id,
                   count(*) FILTER (WHERE status IN ('present','field_work')) AS present,
                   count(*) FILTER (WHERE status = 'absent') AS absent,
                   sum(worked_minutes) AS worked
              FROM attendance_days
             WHERE org_id = $1 AND date BETWEEN $2 AND $3
             GROUP BY employee_id`,
      params: [orgId, from, to],
    },
    {
      name: "employees · page 1 of the register",
      page: "/hr/employees",
      sql: `SELECT e.id, e.employee_code, e.first_name, e.last_name, d.name, b.name
              FROM employees e
              LEFT JOIN departments d ON d.id = e.department_id
              LEFT JOIN branches b ON b.id = e.branch_id
             WHERE e.org_id = $1
             ORDER BY e.employee_code LIMIT 25 OFFSET 0`,
      params: [orgId],
    },
    {
      name: "employees · deep page (offset 400)",
      page: "/hr/employees?page=17",
      sql: `SELECT e.id, e.employee_code FROM employees e
             WHERE e.org_id = $1 ORDER BY e.employee_code LIMIT 25 OFFSET 400`,
      params: [orgId],
    },
    {
      name: "directory · every active employee",
      page: "/me/directory",
      sql: `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.work_email,
                   des.name, d.name, b.name
              FROM employees e
              LEFT JOIN designations des ON des.id = e.designation_id
              LEFT JOIN departments d ON d.id = e.department_id
              LEFT JOIN branches b ON b.id = e.branch_id
             WHERE e.org_id = $1 AND e.status <> 'resigned'
             ORDER BY e.employee_code`,
      params: [orgId],
    },
    {
      name: "audit · keyset page",
      page: "/admin/audit",
      sql: `SELECT * FROM audit_log WHERE org_id = $1
             ORDER BY created_at DESC, id DESC LIMIT 51`,
      params: [orgId],
    },
  ];
}

async function measure() {
  const pool = await connect(benchUrl);

  const org = (await pool.query("SELECT id, name FROM organizations LIMIT 1")).rows[0];
  if (!org) {
    console.error(`\n${BENCH_DB} has no data. Run: node scripts/dev/bench.mjs --build\n`);
    process.exit(1);
  }

  const emp = (await pool.query("SELECT id FROM employees ORDER BY employee_code LIMIT 1")).rows[0];
  const span = (
    await pool.query(
      "SELECT min(date)::text lo, max(date)::text hi, count(*)::int n FROM attendance_days",
    )
  ).rows[0];

  const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  const employees = (await pool.query("SELECT count(*)::int n FROM employees")).rows[0].n;

  console.log(c.bold(`\nScale benchmark · ${BENCH_DB}`));
  console.log(
    c.grey(
      `  ${employees} employees · ${span.n.toLocaleString()} attendance rows · ${span.lo} to ${span.hi}\n`,
    ),
  );

  const results = [];

  for (const q of queries(org.id, emp.id, from, to)) {
    // Warm once so the first result is not measuring a cold buffer cache, then
    // take the best of three: the fastest run is the one least polluted by
    // whatever else the machine was doing.
    await pool.query(q.sql, q.params);

    const runs = [];
    let rows = 0;
    for (let i = 0; i < 3; i++) {
      const t0 = process.hrtime.bigint();
      const r = await pool.query(q.sql, q.params);
      runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
      rows = r.rowCount;
    }
    const ms = Math.min(...runs);

    results.push({ ...q, ms, rows });

    const mark = ms < 50 ? icon.ok : ms < 250 ? icon.warn : icon.fail;
    const tone = ms < 50 ? c.green : ms < 250 ? c.yellow : c.red;
    console.log(
      `  ${mark} ${q.name.padEnd(42)} ${tone(`${ms.toFixed(1).padStart(7)} ms`)} ${c.grey(`${rows.toLocaleString()} rows`)}`,
    );

    if (wantExplain && ms >= 50) {
      const plan = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ${q.sql}`, q.params);
      for (const row of plan.rows) console.log(c.grey(`       ${row["QUERY PLAN"]}`));
    }
  }

  const slow = results.filter((r) => r.ms >= 250);
  const warn = results.filter((r) => r.ms >= 50 && r.ms < 250);

  console.log();
  if (slow.length === 0 && warn.length === 0) {
    console.log(c.green(`  Everything under 50 ms at ${employees} employees.`));
  } else {
    if (slow.length) console.log(c.red(`  ${slow.length} over 250 ms — these need attention.`));
    if (warn.length) console.log(c.yellow(`  ${warn.length} between 50 and 250 ms.`));
    console.log(c.grey("  Re-run with --explain to see the plans."));
  }
  console.log();

  await pool.end();
}

if (wantBuild) await build();
await measure();
