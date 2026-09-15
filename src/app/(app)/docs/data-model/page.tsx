import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { requirePermission } from "@/lib/session";
import { PageHeader, StatTile } from "@/components/ui";
import { Arrow, ArrowDefs, Callout, DefTable, DocSection, Figure, Pill, Prose } from "../parts";

export const metadata = { title: "Data model" };

export default async function DataModelPage() {
  await requirePermission("docs.read");

  // read the live shape rather than describing it from memory
  const [{ rows: counts }, { rows: sizes }] = await Promise.all([
    db.execute(sql`
      SELECT
        (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')::int AS tables,
        (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public')::int AS indexes,
        (SELECT count(*) FROM information_schema.table_constraints
          WHERE constraint_schema = 'public' AND constraint_type = 'FOREIGN KEY')::int AS fks,
        (SELECT count(*) FROM information_schema.table_constraints
          WHERE constraint_schema = 'public' AND constraint_type = 'UNIQUE')::int AS uniques
    `),
    db.execute(sql`
      SELECT relname AS name, n_live_tup::int AS live_rows
      FROM pg_stat_user_tables
      WHERE n_live_tup > 0
      ORDER BY n_live_tup DESC
      LIMIT 8
    `),
  ]);

  const stat = counts[0] as Record<string, number>;
  const biggest = sizes as { name: string; live_rows: number }[];

  return (
    <>
      <PageHeader
        title="Data model"
        description="Tables, how they relate, and the invariants the database enforces on its own."
      />

      <div className="flex flex-col gap-8">
        <DocSection title="Live shape" lead="Read from this database as the page renders.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Tables" value={stat.tables} tone="accent" />
            <StatTile label="Indexes" value={stat.indexes} />
            <StatTile label="Foreign keys" value={stat.fks} />
            <StatTile label="Unique constraints" value={stat.uniques} />
          </div>
          {biggest.length === 0 ? (
            <p className="mt-4 text-sm text-ink-faint">
              PostgreSQL has not gathered row estimates yet — they appear once the statistics
              collector has run over the seeded data.
            </p>
          ) : (
          <div className="mt-4 overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-line bg-sunk px-3 py-2 text-left text-[11px] tracking-wide text-ink-faint uppercase">
                    Largest tables
                  </th>
                  <th className="border-b border-line bg-sunk px-3 py-2 text-right text-[11px] tracking-wide text-ink-faint uppercase">
                    Rows
                  </th>
                </tr>
              </thead>
              <tbody>
                {biggest.map((t) => (
                  <tr key={t.name}>
                    <td className="border-b border-line-soft px-3 py-1.5 font-mono text-xs text-ink-soft">
                      {t.name}
                    </td>
                    <td className="tabular border-b border-line-soft px-3 py-1.5 text-right text-ink">
                      {t.live_rows.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </DocSection>

        <DocSection
          title="How the tables relate"
          lead="Everything hangs off an organisation; almost every figure also hangs off a fiscal year."
        >
          <Figure caption="Core entities. Solid lines are foreign keys; the dashed line is the generic approval link, which is keyed by (entityType, entityId) rather than by a foreign key.">
            <svg viewBox="0 0 860 470" width="860" height="470" role="img" aria-label="Entity relationship diagram">
              <ArrowDefs />

              <Pill x={340} y={10} w={170} label="organizations" sub="the tenant" tone="accent" />

              <Pill x={110} y={90} w={160} label="fiscal_years" sub="one current, enforced" tone="accent" />
              <Pill x={340} y={90} w={170} label="employees" sub="the people master" />
              <Pill x={580} y={90} w={160} label="roles + grants" sub="permissions" />

              <Pill x={10} y={180} w={150} label="period_locks" sub="closed months" tone="sunk" />
              <Pill x={180} y={180} w={150} label="holidays" sub="excluded days" tone="sunk" />
              <Pill x={360} y={180} w={150} label="branches · depts" sub="placement" tone="sunk" />
              <Pill x={580} y={180} w={160} label="user_accounts" sub="login ↔ employee" tone="sunk" />

              <Pill x={70} y={280} w={160} label="leave_types" sub="the policy" />
              <Pill x={260} y={280} w={160} label="leave_balances" sub="per year" />
              <Pill x={450} y={280} w={160} label="leave_requests" />
              <Pill x={640} y={280} w={160} label="shifts" sub="the pattern" />

              <Pill x={260} y={380} w={170} h={40} label="approval_steps" sub="entityType + entityId" tone="warn" />
              <Pill x={470} y={380} w={160} label="attendance_days" sub="one row per day" />
              <Pill x={650} y={380} w={160} label="attendance_requests" />

              <Arrow from={[400, 44]} to={[400, 86]} />
              <Arrow from={[360, 44]} to={[210, 86]} />
              <Arrow from={[490, 44]} to={[650, 86]} />

              <Arrow from={[150, 124]} to={[95, 176]} />
              <Arrow from={[190, 124]} to={[250, 176]} />
              <Arrow from={[420, 124]} to={[430, 176]} />
              <Arrow from={[500, 124]} to={[640, 176]} />

              <Arrow from={[190, 124]} to={[330, 276]} label="scopes" dashed />
              <Arrow from={[400, 124]} to={[340, 276]} />
              <Arrow from={[430, 124]} to={[520, 276]} />
              <Arrow from={[150, 314]} to={[256, 300]} />
              <Arrow from={[720, 124]} to={[720, 276]} dashed />
              <Arrow from={[720, 314]} to={[600, 376]} />
              <Arrow from={[430, 124]} to={[540, 376]} />

              <Arrow from={[500, 314]} to={[380, 376]} label="leave_request" dashed />
              <Arrow from={[700, 414]} to={[435, 404]} label="attendance_request" dashed />

              <text x={10} y={455} fill="var(--color-ink-faint)" fontSize="10">
                One approval engine serves both request types — travel, expense and procurement
                attach to it without new tables.
              </text>
            </svg>
          </Figure>
        </DocSection>

        <DocSection title="The invariants worth knowing">
          <DefTable
            rows={[
              [
                "One current fiscal year",
                <>
                  Partial unique index on{" "}
                  <code className="font-mono text-xs">org_id WHERE is_current</code>. Switching
                  years is one transaction, so it is never violated in between.
                </>,
              ],
              [
                "One attendance row per person per day",
                <>
                  <code className="font-mono text-xs">unique (employee_id, date)</code>, and a row
                  exists for weekly offs, holidays and leave too. The legacy schema only wrote a row
                  when somebody punched, so <em>absent</em> and <em>no record yet</em> were
                  indistinguishable.
                </>,
              ],
              [
                "One balance per person, type and year",
                <>
                  <code className="font-mono text-xs">
                    unique (employee_id, leave_type_id, fiscal_year_id)
                  </code>{" "}
                  — the row a submission locks while it reserves days.
                </>,
              ],
              [
                "One approval step per level",
                <>
                  <code className="font-mono text-xs">
                    unique (entity_type, entity_id, level)
                  </code>
                  . The whole chain is written at submission, so the UI can name who it is waiting
                  on rather than just saying “pending”.
                </>,
              ],
              [
                "Codes are unique inside a tenant, not globally",
                <>
                  Employee codes, branch codes, leave type codes and role codes are all{" "}
                  <code className="font-mono text-xs">unique (org_id, code)</code>. Two
                  organisations can both have an EMP001.
                </>,
              ],
              [
                "Dates are stored Gregorian",
                "Bikram Sambat is derived for display and accepted for input. Storing BS strings would break ordering and range queries; the legacy schema kept both and they drifted.",
              ],
            ]}
          />
        </DocSection>

        <DocSection title="Balances are maintained, not recomputed">
          <Prose>
            <p>
              A leave submission <strong>reserves the days before it checks them</strong>. The
              <code className="mx-1 font-mono text-xs">UPDATE</code> takes a row lock, so a second
              concurrent submission blocks there rather than reading a stale balance and both being
              approved.
            </p>
            <p>
              Approval moves days from <code className="font-mono text-xs">pending</code> to{" "}
              <code className="font-mono text-xs">used</code>, rejection releases them, withdrawal
              returns them — each in the same transaction as the status change. A balance therefore
              cannot disagree with the request that moved it.
            </p>
          </Prose>
          <div className="mt-3">
            <Callout tone="info" title="Migrating real data">
              When importing from the legacy database, recompute{" "}
              <code className="font-mono text-xs">used</code> from approved requests and compare it
              with the stored balance before trusting either side. They will not always agree.
            </Callout>
          </div>
        </DocSection>
      </div>
    </>
  );
}
