/**
 * Kernel tables: the machinery that keeps functional modules independent.
 *
 * Two concerns, both deliberately owned by the kernel rather than any module:
 *
 *   module_states  — whether a module is enabled for an organisation. Disabling
 *                    attendance must remove it from the menu and stop its jobs
 *                    without leave noticing.
 *   domain_events  — the transactional outbox. A module publishes an event in
 *                    the same transaction as its own state change, and other
 *                    modules react afterwards. That is what stops a subscriber's
 *                    failure from rolling back the publisher's work.
 *
 * The legacy system had neither. Leave wrote directly into attendance tables, so
 * a fault in attendance calculation aborted leave approval — one module taking
 * another down is exactly the failure mode this replaces.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./core";

export const eventStatus = pgEnum("event_status", ["pending", "done", "failed", "dead"]);

/**
 * Per-organisation module enablement. A row is written only when somebody
 * changes the default, so an absent row means "enabled" — a new module does not
 * need a backfill before it can be used.
 */
export const moduleStates = pgTable(
  "module_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Matches ModuleId in src/kernel/registry.ts. Text, not an enum: adding a module must not need a migration. */
    moduleId: text("module_id").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    disabledReason: text("disabled_reason"),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("module_states_org_module_key").on(t.orgId, t.moduleId)],
);

/**
 * The outbox. `dedupeKey` makes a publish idempotent: re-running an approval
 * that already emitted its event inserts nothing rather than double-marking
 * attendance days.
 */
export const domainEvents = pgTable(
  "domain_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Publishing module — for the health screen, and for draining one module's backlog. */
    module: text("module").notNull(),
    /** Dotted event name, e.g. "leave.request.approved". */
    name: text("name").notNull(),
    payload: jsonb("payload").notNull(),

    status: eventStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Which subscribers have already run, so a retry does not repeat them. */
    completedHandlers: jsonb("completed_handlers").notNull().default([]),

    dedupeKey: text("dedupe_key"),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (t) => [
    unique("domain_events_dedupe_key").on(t.orgId, t.dedupeKey),
    index("domain_events_pending_idx").on(t.status, t.occurredAt),
    index("domain_events_org_name_idx").on(t.orgId, t.name),
  ],
);
