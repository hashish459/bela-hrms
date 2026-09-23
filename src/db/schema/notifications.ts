/**
 * Notifications: what somebody is told, how, and whether they have seen it.
 *
 * Four tables, one job each:
 *
 *   notification            — the inbox. One row per recipient per thing that
 *                             happened. `dedupe_key` is unique per user, so an
 *                             event delivered twice (the queue is at-least-once)
 *                             still lands in the inbox exactly once.
 *   notification_rule       — an organisation's *override* of the catalogue in
 *                             code. No row means "use the default", so a new
 *                             event type added by a release works on day one
 *                             without anybody configuring it.
 *   notification_preference — a person muting a category, per channel.
 *   notification_delivery   — the email outbox: queued, sent, failed, skipped,
 *                             with the error. Email is slow and fallible; the
 *                             in-app row never waits for it.
 *
 * Plus `announcement`, the record of a broadcast an administrator sent.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organizations } from "./core";

export const notifications = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Catalogue key, e.g. "leave.submitted". */
    eventKey: text("event_key").notNull(),
    /** Catalogue category, which is what preferences mute. */
    category: text("category").notNull(),
    /** info | success | warning | danger — colours the row, nothing else. */
    severity: text("severity").notNull().default("info"),
    title: text("title").notNull(),
    body: text("body"),
    /** Where clicking it goes. Always an in-app path. */
    href: text("href"),
    /** Who caused it, as shown ("Sunita Maharjan"). Null for the system. */
    actorLabel: text("actor_label"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("notification_user_dedupe_key").on(t.userId, t.dedupeKey),
    index("notification_user_created_idx").on(t.userId, t.createdAt),
    index("notification_org_created_idx").on(t.orgId, t.createdAt),
    // the bell asks "how many unread?" once a minute for every open tab
    index("notification_user_unread_idx").on(t.userId).where(sql`read_at is null and archived_at is null`),
  ],
);

export const notificationRules = pgTable(
  "notification_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    isEnabled: boolean("is_enabled").notNull(),
    inApp: boolean("in_app").notNull(),
    email: boolean("email").notNull(),
    /** Recipient groups, from the catalogue entry's allowed list. */
    recipients: jsonb("recipients").$type<string[]>().notNull(),
    titleTemplate: text("title_template").notNull(),
    bodyTemplate: text("body_template").notNull(),
    /** For reminders: how many days before or after. */
    thresholdDays: integer("threshold_days"),
    updatedByLabel: text("updated_by_label"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("notification_rule_org_event_key").on(t.orgId, t.eventKey)],
);

export const notificationPreferences = pgTable(
  "notification_preference",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(true),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("notification_preference_user_category_key").on(t.userId, t.category)],
);

export const notificationDeliveries = pgTable(
  "notification_delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    channel: text("channel").notNull().default("email"),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    /** queued | sent | failed | skipped */
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("notification_delivery_status_idx").on(t.status, t.createdAt),
    index("notification_delivery_org_idx").on(t.orgId, t.createdAt),
    index("notification_delivery_notification_idx").on(t.notificationId),
  ],
);

export const announcements = pgTable(
  "announcement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    severity: text("severity").notNull().default("info"),
    /** { kind: "everyone" } | { kind: "department", id } | { kind: "branch", id } | { kind: "role", id } */
    audience: jsonb("audience").$type<{ kind: string; id?: string; label?: string }>().notNull(),
    alsoEmail: boolean("also_email").notNull().default(false),
    recipientCount: integer("recipient_count").notNull().default(0),
    sentByLabel: text("sent_by_label"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("announcement_org_created_idx").on(t.orgId, t.createdAt)],
);
