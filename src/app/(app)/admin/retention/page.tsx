import { requirePermission } from "@/lib/session";
import { adToBs, formatBs } from "@/lib/bs";
import { Badge, Card, CardHeader, PageHeader, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { databaseHealth, policiesFor } from "@/lib/retention";
import { DIAGNOSTICS, serverInfo } from "@/lib/db-console";
import { OptimiseButton, PolicyRow } from "./policy-row";
import { Diagnostics } from "./diagnostics";

export const metadata = { title: "Data Retention" };

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

const bs = (d: Date | null) => (d ? formatBs(adToBs(d.toISOString().slice(0, 10))) : "—");
const n = (v: number) => v.toLocaleString("en-IN");

function duration(seconds: number) {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

const ms = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`;

/**
 * What the system keeps, for how long, and how big it has got.
 *
 * Only operational data is listed — the business records (leave, attendance
 * days, employee files, approvals) are never cleared from here. Each row can
 * run on the daily schedule or be cleared by hand; every clear is audited.
 */
export default async function RetentionPage() {
  const viewer = await requirePermission("admin.retention.manage");
  const [policies, health, server] = await Promise.all([policiesFor(viewer.orgId), databaseHealth(), serverInfo()]);
  const latencyTone = server.latency.medianMs < 5 ? "ok" : server.latency.medianMs < 25 ? "warn" : "danger";

  const clearable = policies.reduce((sum, p) => sum + p.eligible, 0);
  const automatic = policies.filter((p) => p.isAutomatic && p.retentionDays !== null).length;
  const dead = health.tables.reduce((sum, t) => sum + t.deadRows, 0);

  return (
    <>
      <PageHeader
        title="Data Retention"
        description="How long operational data is kept before it is cleared. Leave, attendance, employee records and approvals are never touched here."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Database size" value={bytes(health.databaseBytes)} tone="accent" />
        <StatTile label="Ready to clear" value={n(clearable)} sub="rows past their retention period" tone={clearable ? "warn" : "ok"} />
        <StatTile label="Cleared automatically" value={`${automatic} of ${policies.length}`} sub="datasets on the daily run" />
        <StatTile label="Dead rows" value={n(dead)} sub="space a VACUUM can reuse" tone={dead > 50_000 ? "warn" : "neutral"} />
      </div>

      <Card className="mb-4">
        <CardHeader
          title="Database server"
          description={server.versionFull}
          action={
            <span className="flex items-center gap-1.5 text-xs text-ok">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-ok" />
              </span>
              {server.replica ? "Online · read replica" : "Online · primary"}
            </span>
          }
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Round-trip latency" value={ms(server.latency.medianMs)} sub={`best ${ms(server.latency.bestMs)} · first ${ms(server.latency.firstMs)}`} tone={latencyTone} />
          <StatTile
            label="Connections"
            value={`${server.connections}/${server.maxConnections}`}
            sub={`${server.activeConnections} active · app pool ${server.pool.total}/${server.pool.max} (${server.pool.idle} idle${server.pool.waiting ? `, ${server.pool.waiting} waiting` : ""})`}
            tone={server.connections / server.maxConnections > 0.8 ? "danger" : "info"}
          />
          <StatTile
            label="Cache hit ratio"
            value={server.cacheHit === null ? "—" : `${server.cacheHit}%`}
            sub="reads served from memory"
            tone={server.cacheHit === null || server.cacheHit >= 99 ? "ok" : server.cacheHit >= 95 ? "warn" : "danger"}
          />
          <StatTile label="Uptime" value={duration(server.uptimeSeconds)} sub={`since the server last started`} />
        </div>
        <dl className="grid gap-x-6 gap-y-2 border-t border-line-soft px-4 py-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["Database", server.name],
              ["PostgreSQL", server.version],
              ["Host", `${server.host}${server.port ? `:${server.port}` : ""}`],
              ["Connected as", server.user],
              ["Size", bytes(server.sizeBytes)],
              ["Tables · indexes", `${server.tables} · ${server.indexes} (${server.unusedIndexes} never used)`],
              ["Transactions", `${n(server.commits)} committed · ${n(server.rollbacks)} rolled back`],
              ["Deadlocks", n(server.deadlocks)],
              ["Waiting locks", n(server.waitingLocks)],
              ["Longest open transaction", server.longestTransactionSeconds ? duration(server.longestTransactionSeconds) : "none"],
              ["Temp files written", bytes(server.tempBytes)],
              ["Time zone · encoding", `${server.timezone} · ${server.encoding}`],
              ["Collation", server.collation],
              ["Extensions", server.extensions || "none"],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] text-ink-faint">{k}</dt>
              <dd className="truncate font-medium text-ink" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title="Diagnostics"
          description="Ready-made read-only queries against the live database — connections, locks, slow statements, index and table health. Each run is audited."
        />
        <Diagnostics options={Object.entries(DIAGNOSTICS).map(([key, d]) => ({ key, label: d.label, hint: d.hint }))} />
      </Card>

      <Card className="mb-4">
        <CardHeader
          title="Retention policies"
          description="Each dataset has a minimum below which it cannot be set. The daily run clears datasets marked Auto; Clear now runs one immediately."
        />
        <TableShell className="rounded-none border-0">
          <thead>
            <tr>
              <Th>Data</Th>
              <Th className="text-right">Rows</Th>
              <Th className="text-right">Past retention</Th>
              <Th>Last cleared</Th>
              <Th className="text-right">Policy</Th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <Tr key={p.key}>
                <Td className="max-w-md">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    {p.label}
                    {p.retentionDays === null ? <Badge>kept forever</Badge> : p.isAutomatic ? <Badge tone="ok">auto</Badge> : <Badge tone="info">manual</Badge>}
                  </span>
                  <span className="block text-xs text-ink-faint">{p.description}</span>
                  <span className="block text-[11px] text-ink-faint">Minimum {p.minDays} days</span>
                </Td>
                <Td className="tabular text-right">{n(p.total)}</Td>
                <Td className={`tabular text-right ${p.eligible ? "font-medium text-warn" : "text-ink-faint"}`}>{n(p.eligible)}</Td>
                <Td className="text-xs text-ink-soft">
                  {p.lastRunAt ? (
                    <>
                      {bs(p.lastRunAt)}
                      <span className="block text-[11px] text-ink-faint">{n(p.lastPurged ?? 0)} cleared</span>
                    </>
                  ) : (
                    "Never"
                  )}
                </Td>
                <Td>
                  <PolicyRow
                    dataset={p.key}
                    minDays={p.minDays}
                    retentionDays={p.retentionDays}
                    isAutomatic={p.isAutomatic}
                    eligible={p.eligible}
                    canExport={p.key === "audit"}
                  />
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>
      </Card>

      <Card>
        <CardHeader
          title="Database health"
          description="The largest tables. Deleting rows leaves space Postgres reuses after a VACUUM; autovacuum does this on its own, Optimise does it now and refreshes the query planner's statistics."
          action={<OptimiseButton />}
        />
        <TableShell className="rounded-none border-0">
          <thead>
            <tr>
              <Th>Table</Th>
              <Th className="text-right">Rows</Th>
              <Th className="text-right">Size</Th>
              <Th className="text-right">Dead rows</Th>
              <Th>Last vacuum</Th>
              <Th>Last analyse</Th>
            </tr>
          </thead>
          <tbody>
            {health.tables.map((t) => {
              const bloat = t.rows + t.deadRows > 0 ? t.deadRows / (t.rows + t.deadRows) : 0;
              return (
                <Tr key={t.table}>
                  <Td className="font-mono text-xs">{t.table}</Td>
                  <Td className="tabular text-right">{n(t.rows)}</Td>
                  <Td className="tabular text-right">{bytes(t.totalBytes)}</Td>
                  <Td className={`tabular text-right ${bloat > 0.2 ? "text-warn" : "text-ink-soft"}`}>
                    {n(t.deadRows)}
                    {bloat > 0.2 ? <span className="block text-[10px]">{Math.round(bloat * 100)}% of the table</span> : null}
                  </Td>
                  <Td className="text-xs text-ink-soft">{bs(t.lastVacuum)}</Td>
                  <Td className="text-xs text-ink-soft">{bs(t.lastAnalyze)}</Td>
                </Tr>
              );
            })}
          </tbody>
        </TableShell>
      </Card>
    </>
  );
}
