import "server-only";

import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, retentionPolicies } from "@/db/schema/core";
import { devicePunches } from "@/db/schema/devices";
import { domainEvents } from "@/db/schema/kernel";
import { announcements, notificationDeliveries, notifications } from "@/db/schema/notifications";
import { listBin, purgeItem } from "@/lib/recycle-bin";

/**
 * Data retention: how long operational data is kept, and the job that clears
 * what has outlived its use.
 *
 * Every dataset here is *operational exhaust* — read notifications, sent email,
 * delivered events, old audit entries, raw device readings already folded into
 * attendance, things deleted long ago. None of it is a business record: leave,
 * attendance days, payroll inputs, employee files and approvals are never on
 * this list, however old.
 *
 * Three rules keep it safe:
 *
 *   Floors      — each dataset has a minimum period the policy cannot go
 *                 below, so a mis-set field cannot erase last week's audit trail.
 *   Batches     — rows go in chunks of `BATCH` under a short statement each,
 *                 with a time budget per run; a purge of a million rows never
 *                 holds one long lock on a table the app is writing to.
 *   A trace     — every purge writes one audit entry saying what went and up to
 *                 when, so "where did the 2081 log go" always has an answer.
 */

export type DatasetKey =
  | "audit"
  | "notifications_read"
  | "notifications_all"
  | "email_outbox"
  | "domain_events"
  | "announcements"
  | "device_punches"
  | "recycle_bin";

export type Dataset = {
  key: DatasetKey;
  label: string;
  description: string;
  /** Days kept when the organisation has not chosen; null keeps forever. */
  defaultDays: number | null;
  /** The shortest period anybody may set. */
  minDays: number;
  /** Purged by the daily run unless the organisation turns it off. */
  automaticByDefault: boolean;
  /** Where the rows live, for the size panel. */
  table: string;
};

export const DATASETS: Dataset[] = [
  {
    key: "notifications_read",
    label: "Read & archived notifications",
    description: "Bell and inbox items somebody has already read or archived. Their email copies go with them.",
    defaultDays: 90,
    minDays: 14,
    automaticByDefault: true,
    table: "notification",
  },
  {
    key: "notifications_all",
    label: "All notifications",
    description: "Anything older than this goes, read or not — nobody acts on a year-old reminder.",
    defaultDays: 365,
    minDays: 60,
    automaticByDefault: true,
    table: "notification",
  },
  {
    key: "email_outbox",
    label: "Email outbox",
    description: "Delivery rows for emails already sent, logged, skipped or given up on. Queued mail is never touched.",
    defaultDays: 60,
    minDays: 7,
    automaticByDefault: true,
    table: "notification_delivery",
  },
  {
    key: "domain_events",
    label: "Delivered system events",
    description: "The internal event queue, once every module has handled an event. Failed events are kept for inspection.",
    defaultDays: 30,
    minDays: 7,
    automaticByDefault: true,
    table: "domain_events",
  },
  {
    key: "announcements",
    label: "Announcements",
    description: "The announcement records on the admin screen. The notifications they produced follow the rules above.",
    defaultDays: 365,
    minDays: 30,
    automaticByDefault: false,
    table: "announcement",
  },
  {
    key: "audit",
    label: "Audit trail",
    description: "Who changed what. Kept two years by default; exports first if your auditors want the history.",
    defaultDays: 730,
    minDays: 180,
    automaticByDefault: false,
    table: "audit_log",
  },
  {
    key: "device_punches",
    label: "Raw device punches",
    description: "Readings from attendance devices that were matched and applied to a day. The attendance days themselves are kept.",
    defaultDays: null,
    minDays: 400,
    automaticByDefault: false,
    table: "attendance_device_punches",
  },
  {
    key: "recycle_bin",
    label: "Recycle bin",
    description: "Items deleted longer ago than this are purged for good. Anything the owning module refuses to purge stays.",
    defaultDays: null,
    minDays: 7,
    automaticByDefault: false,
    table: "(several)",
  },
];

export const DATASET_BY_KEY = new Map(DATASETS.map((d) => [d.key, d]));

/** Rows per delete statement. */
const BATCH = 2000;
/** Wall-clock budget per dataset per run, so one run cannot occupy the pool. */
const BUDGET_MS = 20_000;

export class RetentionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetentionError";
  }
}

const cutoffOf = (days: number) => sql`now() - make_interval(days => ${days})`;

/** The rows a dataset would purge for an organisation at a given age. */
function eligible(key: DatasetKey, orgId: string, days: number): { table: SQL; where: SQL } | null {
  const before = cutoffOf(days);
  switch (key) {
    case "audit":
      return { table: sql`${auditLog}`, where: sql`${auditLog.orgId} = ${orgId} and ${auditLog.createdAt} < ${before}` };
    case "notifications_read":
      return {
        table: sql`${notifications}`,
        where: sql`${notifications.orgId} = ${orgId} and ${notifications.createdAt} < ${before}
          and (${notifications.readAt} is not null or ${notifications.archivedAt} is not null)`,
      };
    case "notifications_all":
      return { table: sql`${notifications}`, where: sql`${notifications.orgId} = ${orgId} and ${notifications.createdAt} < ${before}` };
    case "email_outbox":
      return {
        table: sql`${notificationDeliveries}`,
        where: sql`${notificationDeliveries.orgId} = ${orgId} and ${notificationDeliveries.createdAt} < ${before}
          and ${notificationDeliveries.status} in ('sent', 'logged', 'skipped', 'failed')`,
      };
    case "domain_events":
      return {
        table: sql`${domainEvents}`,
        where: sql`${domainEvents.orgId} = ${orgId} and ${domainEvents.occurredAt} < ${before} and ${domainEvents.status} = 'done'`,
      };
    case "announcements":
      return { table: sql`${announcements}`, where: sql`${announcements.orgId} = ${orgId} and ${announcements.createdAt} < ${before}` };
    case "device_punches":
      return {
        table: sql`${devicePunches}`,
        where: sql`${devicePunches.orgId} = ${orgId} and ${devicePunches.punchedAt} < ${before} and ${devicePunches.status} = 'applied'`,
      };
    case "recycle_bin":
      return null;
  }
}

export type PolicyView = Dataset & {
  retentionDays: number | null;
  isAutomatic: boolean;
  lastRunAt: Date | null;
  lastPurged: number | null;
  updatedByLabel: string | null;
  /** Rows the current policy would purge right now. */
  eligible: number;
  /** Rows in the dataset for this organisation. */
  total: number;
};

async function countWhere(table: SQL, where: SQL | null): Promise<number> {
  const result = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${table}${where ? sql` where ${where}` : sql``}`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

function totalFor(key: DatasetKey, orgId: string) {
  // the widest possible filter for the dataset, at age zero
  return eligible(key, orgId, 0);
}

/** Every dataset with the organisation's policy and how much it holds. */
export async function policiesFor(orgId: string): Promise<PolicyView[]> {
  const rows = await db.select().from(retentionPolicies).where(eq(retentionPolicies.orgId, orgId));
  const byKey = new Map(rows.map((r) => [r.dataset, r]));
  const bin = await listBin(orgId, null);

  return Promise.all(
    DATASETS.map(async (d) => {
      const row = byKey.get(d.key);
      const days = row ? row.retentionDays : d.defaultDays;
      let eligibleCount = 0;
      let total = 0;
      if (d.key === "recycle_bin") {
        total = bin.length;
        if (days !== null) {
          const cutoff = Date.now() - days * 86_400_000;
          eligibleCount = bin.filter((i) => i.deletedAt.getTime() < cutoff).length;
        }
      } else {
        const all = totalFor(d.key, orgId)!;
        // "total" for a filtered dataset is everything the filter could ever
        // reach, so the two notification rows each show their own scope
        total = await countWhere(all.table, all.where);
        if (days !== null) {
          const e = eligible(d.key, orgId, days)!;
          eligibleCount = await countWhere(e.table, e.where);
        }
      }
      return {
        ...d,
        retentionDays: days,
        isAutomatic: row ? row.isAutomatic : d.automaticByDefault,
        lastRunAt: row?.lastRunAt ?? null,
        lastPurged: row?.lastPurged ?? null,
        updatedByLabel: row?.updatedByLabel ?? null,
        eligible: eligibleCount,
        total,
      };
    }),
  );
}

export async function savePolicy(
  orgId: string,
  key: DatasetKey,
  input: { retentionDays: number | null; isAutomatic: boolean },
  byLabel: string,
) {
  const d = DATASET_BY_KEY.get(key);
  if (!d) throw new RetentionError("Unknown dataset.");
  if (input.retentionDays !== null) {
    if (!Number.isInteger(input.retentionDays) || input.retentionDays < d.minDays) {
      throw new RetentionError(`${d.label} must be kept at least ${d.minDays} days.`);
    }
    if (input.retentionDays > 3650) throw new RetentionError("Ten years is the longest period that can be set; choose Keep forever instead.");
  }
  // automatic purging of something kept forever means nothing; store it off
  const isAutomatic = input.retentionDays === null ? false : input.isAutomatic;
  const values = { retentionDays: input.retentionDays, isAutomatic, updatedByLabel: byLabel, updatedAt: new Date() };
  await db
    .insert(retentionPolicies)
    .values({ orgId, dataset: key, ...values })
    .onConflictDoUpdate({ target: [retentionPolicies.orgId, retentionPolicies.dataset], set: values });
}

/** Deletes one dataset's eligible rows in batches. Returns how many went. */
async function purgeDataset(orgId: string, key: DatasetKey, days: number): Promise<{ purged: number; skipped: number }> {
  if (key === "recycle_bin") {
    const cutoff = Date.now() - days * 86_400_000;
    const old = (await listBin(orgId, null)).filter((i) => i.deletedAt.getTime() < cutoff);
    let purged = 0;
    let skipped = 0;
    const started = Date.now();
    for (const item of old) {
      if (Date.now() - started > BUDGET_MS) break;
      try {
        await purgeItem(orgId, item.type, item.id);
        purged++;
      } catch {
        // the owning module refused (history, references): it stays in the bin
        skipped++;
      }
    }
    return { purged, skipped };
  }

  const e = eligible(key, orgId, days)!;
  let purged = 0;
  const started = Date.now();
  for (;;) {
    const result = await db.execute(
      sql`delete from ${e.table} where ctid in (select ctid from ${e.table} where ${e.where} limit ${BATCH})`,
    );
    const n = result.rowCount ?? 0;
    purged += n;
    if (n < BATCH || Date.now() - started > BUDGET_MS) break;
  }
  return { purged, skipped: 0 };
}

export type RunResult = { dataset: DatasetKey; label: string; purged: number; skipped: number };

/**
 * Applies retention for an organisation.
 *
 * `only` limits it to one dataset (the "Purge now" button); `automaticOnly`
 * is the daily run, which skips datasets the organisation keeps manual.
 */
export async function runRetention(
  orgId: string,
  options: { only?: DatasetKey; automaticOnly?: boolean; actor?: { userId: string | null; label: string } } = {},
): Promise<RunResult[]> {
  const policies = await policiesFor(orgId);
  const results: RunResult[] = [];

  for (const p of policies) {
    if (options.only && p.key !== options.only) continue;
    if (p.retentionDays === null) continue;
    if (options.automaticOnly && !p.isAutomatic) continue;
    // the daily run is daily per dataset, whatever the cron interval
    if (options.automaticOnly && p.lastRunAt && Date.now() - p.lastRunAt.getTime() < 20 * 3_600_000) continue;
    if (p.eligible === 0 && p.key !== "recycle_bin") {
      await touch(orgId, p.key, 0);
      continue;
    }

    const { purged, skipped } = await purgeDataset(orgId, p.key, Math.max(p.retentionDays, p.minDays));
    await touch(orgId, p.key, purged);
    results.push({ dataset: p.key, label: p.label, purged, skipped });

    if (purged > 0) {
      await db.insert(auditLog).values({
        orgId,
        actorUserId: options.actor?.userId ?? null,
        actorLabel: options.actor?.label ?? "Retention (scheduled)",
        action: "purge",
        entityType: "retention",
        entityId: p.key,
        summary: `Purged ${purged.toLocaleString("en-IN")} ${p.label.toLowerCase()} older than ${p.retentionDays} days${skipped ? `; ${skipped} kept because other records depend on them` : ""}`,
      });
    }
  }
  return results;
}

/** Records a run. The first run of a dataset stores its defaults as the policy, unchanged. */
async function touch(orgId: string, key: DatasetKey, purged: number) {
  const d = DATASET_BY_KEY.get(key)!;
  await db
    .insert(retentionPolicies)
    .values({
      orgId,
      dataset: key,
      retentionDays: d.defaultDays,
      isAutomatic: d.automaticByDefault,
      lastRunAt: new Date(),
      lastPurged: purged,
    })
    .onConflictDoUpdate({
      target: [retentionPolicies.orgId, retentionPolicies.dataset],
      set: { lastRunAt: new Date(), lastPurged: purged },
    });
}

/**
 * The daily run, for the cron endpoint. Each automatic dataset runs at most
 * once in twenty hours, so a five-minute scheduler does not become a
 * five-minute purge loop.
 */
export function dailyRetention(orgId: string): Promise<RunResult[]> {
  return runRetention(orgId, { automaticOnly: true });
}

/* ----------------------------------------------------------- database health */

export type TableHealth = {
  table: string;
  rows: number;
  totalBytes: number;
  deadRows: number;
  lastVacuum: Date | null;
  lastAnalyze: Date | null;
};

/** Size and bloat for the largest tables, from Postgres' own statistics. */
export async function databaseHealth() {
  const [size] = (
    await db.execute<{ bytes: string }>(sql`select pg_database_size(current_database())::text as bytes`)
  ).rows;
  const tables = await db.execute<{
    table: string;
    rows: string;
    total_bytes: string;
    dead_rows: string;
    last_vacuum: Date | null;
    last_analyze: Date | null;
  }>(sql`
    select s.relname as table,
           -- live-tuple counts are zero until statistics are first gathered
           -- (after a restore, say); the planner's estimate stands in then
           greatest(s.n_live_tup, c.reltuples::bigint, 0)::text as rows,
           pg_total_relation_size(s.relid)::text as total_bytes,
           s.n_dead_tup::text as dead_rows,
           greatest(s.last_vacuum, s.last_autovacuum) as last_vacuum,
           greatest(s.last_analyze, s.last_autoanalyze) as last_analyze
    from pg_stat_user_tables s
    join pg_class c on c.oid = s.relid
    order by pg_total_relation_size(s.relid) desc
    limit 15`);
  return {
    databaseBytes: Number(size?.bytes ?? 0),
    tables: tables.rows.map(
      (t): TableHealth => ({
        table: t.table,
        rows: Number(t.rows),
        totalBytes: Number(t.total_bytes),
        deadRows: Number(t.dead_rows),
        lastVacuum: t.last_vacuum ? new Date(t.last_vacuum) : null,
        lastAnalyze: t.last_analyze ? new Date(t.last_analyze) : null,
      }),
    ),
  };
}

/** Tables a purge touches, so "Optimise" reclaims exactly where rows went. */
const OPTIMISE_TABLES = [
  "audit_log",
  "notification",
  "notification_delivery",
  "domain_events",
  "announcement",
  "attendance_device_punches",
  "session",
  "verification",
];

/**
 * VACUUM (ANALYZE) on the purge-heavy tables: marks the space deleted rows held
 * as reusable and refreshes the planner's statistics so it keeps choosing the
 * indexes. Plain VACUUM, not FULL — FULL rewrites the table under an exclusive
 * lock, which on a live system means every request waits.
 */
export async function optimiseTables(): Promise<string[]> {
  const done: string[] = [];
  for (const table of OPTIMISE_TABLES) {
    try {
      // VACUUM cannot run inside a transaction; db.execute runs it on its own
      await db.execute(sql`vacuum (analyze) ${sql.identifier(table)}`);
      done.push(table);
    } catch (error) {
      console.error(`[retention] could not vacuum ${table}:`, (error as Error).message);
    }
  }
  // fresh statistics everywhere else too: cheap, and it is what keeps the
  // planner choosing indexes as tables grow
  try {
    await db.execute(sql`analyze`);
  } catch (error) {
    console.error("[retention] could not analyze:", (error as Error).message);
  }
  return done;
}
