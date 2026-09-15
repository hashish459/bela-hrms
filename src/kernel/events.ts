import "server-only";

import { sql } from "drizzle-orm";
import { db, type Db } from "@/db/client";
import { domainEvents } from "@/db/schema/kernel";
import type { ModuleId } from "./ports";
import { markDegraded } from "./registry";

/**
 * The transactional outbox.
 *
 * A module publishes an event **inside its own transaction**, so the event and
 * the state change it describes commit or roll back together. Other modules
 * react afterwards, in a separate transaction, and their failure is recorded
 * against the event rather than thrown back at the publisher.
 *
 * That ordering is the whole design. The alternative — leave calling into
 * attendance inside leave's transaction — means an attendance bug rolls back an
 * approval that the approver has already been told succeeded, which is precisely
 * what the legacy system did.
 *
 * Delivery is at-least-once, so every handler must be idempotent. `dedupeKey`
 * makes publishing idempotent too: replaying an approval inserts nothing.
 */

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Events the system publishes. Adding one is a type change, not a string. */
export type DomainEventName =
  | "leave.request.approved"
  | "leave.request.rejected"
  | "leave.request.withdrawn"
  | "attendance.day.recalculated"
  | "attendance.request.approved"
  | "org.structure.changed"
  | "calendar.holiday.changed"
  | "period.locked"
  | "period.unlocked";

export type DomainEvent<P = Record<string, unknown>> = {
  orgId: string;
  module: ModuleId | "core";
  name: DomainEventName;
  payload: P;
  /**
   * Stable business key. A second publish with the same key is dropped, which
   * makes retrying a whole action safe.
   */
  dedupeKey?: string;
};

type Handler = {
  /** Stable id, recorded on the event so a retry does not re-run it. */
  id: string;
  module: ModuleId;
  event: DomainEventName;
  run: (payload: Record<string, unknown>, orgId: string) => Promise<void>;
};

const globalForEvents = globalThis as unknown as { __erpHandlers?: Map<string, Handler> };
const handlers: Map<string, Handler> = (globalForEvents.__erpHandlers ??= new Map());

/** Maximum attempts before an event is parked as `dead` for an operator to look at. */
const MAX_ATTEMPTS = 5;

/**
 * Registers a subscriber. Called from a module's `module.ts` at boot; the id
 * must be stable across deploys or completed work will be repeated.
 */
export function subscribe(handler: Handler): void {
  handlers.set(handler.id, handler);
}

/** Publishes inside the caller's transaction. Do not call this outside one. */
export async function publish(tx: Tx, event: DomainEvent): Promise<void> {
  await tx
    .insert(domainEvents)
    .values({
      orgId: event.orgId,
      module: event.module,
      name: event.name,
      payload: event.payload,
      dedupeKey: event.dedupeKey ?? null,
    })
    .onConflictDoNothing();
}

type ClaimedRow = {
  id: string;
  org_id: string;
  name: string;
  payload: Record<string, unknown>;
  attempts: number;
  completed_handlers: string[];
};

/**
 * Runs pending events. Safe to call concurrently: rows are claimed with
 * `FOR UPDATE SKIP LOCKED`, so two workers never take the same event.
 *
 * Returns counts rather than throwing — a caller draining the queue after a
 * request must not fail the request because a subscriber is broken.
 */
export async function drain(options: { orgId?: string; limit?: number } = {}): Promise<{
  processed: number;
  failed: number;
}> {
  const limit = options.limit ?? 25;
  const orgFilter = options.orgId ?? null;

  let claimed: ClaimedRow[];
  try {
    const result = await db.execute(sql`
      UPDATE domain_events
         SET attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM domain_events
          WHERE status = 'pending'
            AND (${orgFilter}::uuid IS NULL OR org_id = ${orgFilter}::uuid)
          ORDER BY occurred_at
          LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
       )
      RETURNING id, org_id, name, payload, attempts, completed_handlers
    `);
    claimed = result.rows as unknown as ClaimedRow[];
  } catch (error) {
    console.error("[kernel] could not claim events:", error);
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const row of claimed) {
    const done = new Set<string>(Array.isArray(row.completed_handlers) ? row.completed_handlers : []);
    const subscribers = [...handlers.values()].filter((h) => h.event === row.name && !done.has(h.id));

    const errors: string[] = [];
    for (const handler of subscribers) {
      try {
        await handler.run(row.payload ?? {}, row.org_id);
        done.add(handler.id);
      } catch (error) {
        // One subscriber failing must not stop the others from running.
        markDegraded(handler.module, error);
        errors.push(`${handler.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const settled = errors.length === 0;
    if (settled) processed += 1;
    else failed += 1;

    await db.execute(sql`
      UPDATE domain_events
         SET status = ${settled ? "done" : row.attempts >= MAX_ATTEMPTS ? "dead" : "pending"},
             completed_handlers = ${JSON.stringify([...done])}::jsonb,
             last_error = ${errors.length ? errors.join(" | ") : null},
             processed_at = ${settled ? sql`now()` : sql`NULL`}
       WHERE id = ${row.id}::uuid
    `);
  }

  return { processed, failed };
}

/**
 * Drains without blocking the caller. Use after committing a transaction that
 * published events: the user's request returns as soon as its own work is safe,
 * and cross-module reactions catch up immediately afterwards.
 */
export function drainInBackground(orgId?: string): void {
  void drain({ orgId }).catch((error) => {
    console.error("[kernel] background drain failed:", error);
  });
}

/** Queue depth, for the module health screen. */
export async function queueDepth(orgId?: string): Promise<{
  pending: number;
  dead: number;
  oldestPendingAt: Date | null;
}> {
  const result = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'pending')::int AS pending,
      count(*) FILTER (WHERE status = 'dead')::int    AS dead,
      min(occurred_at) FILTER (WHERE status = 'pending') AS oldest
    FROM domain_events
    WHERE (${orgId ?? null}::uuid IS NULL OR org_id = ${orgId ?? null}::uuid)
  `);
  const row = result.rows[0] as { pending: number; dead: number; oldest: Date | null };
  return {
    pending: row?.pending ?? 0,
    dead: row?.dead ?? 0,
    oldestPendingAt: row?.oldest ?? null,
  };
}

/** Requeues parked events after the cause has been fixed. */
export async function replayDead(orgId: string): Promise<number> {
  const result = await db.execute(sql`
    UPDATE domain_events
       SET status = 'pending', attempts = 0, last_error = NULL
     WHERE org_id = ${orgId}::uuid AND status = 'dead'
    RETURNING id
  `);
  return result.rows.length;
}
