import "server-only";

import { and, count, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { cached, cacheTags, invalidate } from "@/kernel/cache";
import { db } from "@/db/client";
import { user } from "@/db/schema/auth";
import { roleGrants, roles, userAccounts, userRoles } from "@/db/schema/core";
import { employees, onStrength } from "@/db/schema/hr";
import { approvalSteps } from "@/db/schema/approvals";
import { leaveRequests, leaveTypes } from "@/db/schema/leave";
import { employeeDocuments } from "@/db/schema/selfservice";
import {
  announcements,
  notificationDeliveries,
  notificationPreferences,
  notificationRules,
  notifications,
} from "@/db/schema/notifications";
import { addDays, adToBs, daysUntil, formatBsKey, todayInNepal } from "@/lib/bs";
import { offsetPage, type OffsetPage } from "@/lib/pagination";
import {
  CATALOGUE,
  CATALOGUE_BY_KEY,
  effectiveRule,
  render,
  type Category,
  type EffectiveRule,
  type Recipient,
  type Severity,
} from "./catalogue";
import { flushEmailInBackground } from "./email";

/**
 * The notification service.
 *
 * `notify()` is the one way anything is told anything. Given a catalogue key
 * and a context, it applies the organisation's rule, works out who the
 * recipients are, drops the person who caused it (nobody needs telling what
 * they just did), honours each recipient's preferences, and writes one inbox
 * row per person plus an email to the outbox where email is on.
 *
 * Idempotent by construction: every row carries a dedupe key that is unique
 * per user, so the at-least-once event queue delivering an event twice — or
 * a reminder sweep running twice in a day — produces exactly one notification.
 */

type Recipients = { userId: string; email: string; name: string }[];

/* -------------------------------------------------------------------- rules */

export async function loadRules(orgId: string): Promise<Map<string, EffectiveRule>> {
  // every notification reads the rules; they change when an admin edits one
  const overrides = await cached(
    `notify-rules:${orgId}`,
    () => db.select().from(notificationRules).where(eq(notificationRules.orgId, orgId)),
    { ttl: 300, tags: [cacheTags.notificationRules(orgId), cacheTags.org(orgId)] },
  );
  const byKey = new Map(overrides.map((o) => [o.eventKey, o]));
  return new Map(CATALOGUE.map((entry) => [entry.key, effectiveRule(entry, byKey.get(entry.key))]));
}

export type RuleInput = {
  isEnabled: boolean;
  inApp: boolean;
  email: boolean;
  recipients: Recipient[];
  titleTemplate: string;
  bodyTemplate: string;
  thresholdDays: number | null;
};

export async function saveRule(orgId: string, key: string, input: RuleInput, byLabel: string): Promise<void> {
  const entry = CATALOGUE_BY_KEY.get(key);
  if (!entry) throw new Error("Unknown notification.");
  const values = {
    ...input,
    recipients: input.recipients.filter((r) => entry.allowedRecipients.includes(r)),
    updatedByLabel: byLabel,
    updatedAt: new Date(),
  };
  await db
    .insert(notificationRules)
    .values({ orgId, eventKey: key, ...values })
    .onConflictDoUpdate({ target: [notificationRules.orgId, notificationRules.eventKey], set: values });
  invalidate(cacheTags.notificationRules(orgId));
}

/** Back to the catalogue default: the override row simply goes. */
export async function resetRule(orgId: string, key: string): Promise<void> {
  await db.delete(notificationRules).where(and(eq(notificationRules.orgId, orgId), eq(notificationRules.eventKey, key)));
  invalidate(cacheTags.notificationRules(orgId));
}

/* --------------------------------------------------------------- recipients */

const employedNow = (): SQL => onStrength();

/** Active user accounts behind a set of employees. */
async function usersForEmployees(orgId: string, employeeIds: (string | null | undefined)[]): Promise<Recipients> {
  const ids = [...new Set(employeeIds.filter((v): v is string => !!v))];
  if (ids.length === 0) return [];
  return db
    .select({ userId: userAccounts.userId, email: user.email, name: user.name })
    .from(userAccounts)
    .innerJoin(user, eq(user.id, userAccounts.userId))
    .where(and(eq(userAccounts.orgId, orgId), eq(userAccounts.isActive, true), inArray(userAccounts.employeeId, ids)));
}

/** Everybody who holds a permission through a role — plus system administrators, who hold them all. */
async function usersWithPermission(orgId: string, permission: string): Promise<Recipients> {
  const viaRole = await db
    .selectDistinct({ userId: userAccounts.userId, email: user.email, name: user.name })
    .from(userAccounts)
    .innerJoin(user, eq(user.id, userAccounts.userId))
    .innerJoin(userRoles, eq(userRoles.userId, userAccounts.userId))
    .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.orgId, userAccounts.orgId)))
    .innerJoin(roleGrants, eq(roleGrants.roleId, roles.id))
    .where(and(eq(userAccounts.orgId, orgId), eq(userAccounts.isActive, true), eq(roleGrants.permission, permission)));
  const admins = await db
    .select({ userId: userAccounts.userId, email: user.email, name: user.name })
    .from(userAccounts)
    .innerJoin(user, eq(user.id, userAccounts.userId))
    .where(and(eq(userAccounts.orgId, orgId), eq(userAccounts.isActive, true), eq(userAccounts.isSystemAdmin, true)));
  return [...viaRole, ...admins];
}

async function supervisorOf(employeeId: string | null | undefined): Promise<string | null> {
  if (!employeeId) return null;
  const [row] = await db.select({ s: employees.supervisorId }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  return row?.s ?? null;
}

async function resolveRecipients(
  orgId: string,
  rule: EffectiveRule,
  who: { subjectEmployeeId?: string | null; approverEmployeeId?: string | null },
): Promise<Recipients> {
  const lists: Recipients[] = [];
  for (const r of rule.recipients) {
    if (r === "subject") lists.push(await usersForEmployees(orgId, [who.subjectEmployeeId]));
    if (r === "approver") lists.push(await usersForEmployees(orgId, [who.approverEmployeeId]));
    if (r === "supervisor") lists.push(await usersForEmployees(orgId, [await supervisorOf(who.subjectEmployeeId)]));
    if (r === "hr" && rule.entry.hrPermission) lists.push(await usersWithPermission(orgId, rule.entry.hrPermission));
  }
  const byId = new Map<string, Recipients[number]>();
  for (const list of lists) for (const u of list) byId.set(u.userId, u);
  return [...byId.values()];
}

/* ------------------------------------------------------------------ notify */

export type NotifyInput = {
  context: Record<string, string | number | null | undefined>;
  subjectEmployeeId?: string | null;
  approverEmployeeId?: string | null;
  /** The user who caused it — never notified about their own action. */
  actorUserId?: string | null;
  actorLabel?: string | null;
  /** Stable per occurrence; combined with the user it makes delivery idempotent. */
  dedupeKey: string;
  /** Explicit recipients, bypassing the rule's groups (announcements, tests). */
  recipients?: Recipients;
  severity?: Severity;
  href?: string;
  /** Tests ignore the enabled switch and preferences, so the admin sees what it looks like. */
  force?: boolean;
  /** Announcements carry their own email choice. */
  email?: boolean;
  /** A test of wording not yet saved: these templates instead of the rule's. */
  templates?: { title: string; body: string };
};

/** Sends one catalogue notification. Returns how many people it reached. */
export async function notify(orgId: string, key: string, input: NotifyInput): Promise<number> {
  const rules = await loadRules(orgId);
  const rule = rules.get(key);
  if (!rule || (!rule.enabled && !input.force)) return 0;

  const people = (input.recipients ?? (await resolveRecipients(orgId, rule, input))).filter(
    (p) => input.force || p.userId !== input.actorUserId,
  );
  if (people.length === 0) return 0;

  const category = rule.entry.category;
  const prefs = input.force
    ? []
    : await db
        .select()
        .from(notificationPreferences)
        .where(
          and(
            inArray(
              notificationPreferences.userId,
              people.map((p) => p.userId),
            ),
            eq(notificationPreferences.category, category),
          ),
        );
  const prefBy = new Map(prefs.map((p) => [p.userId, p]));

  const context = { ...input.context };
  const title = render(input.templates?.title ?? rule.title, context).slice(0, 300) || rule.entry.label;
  const body = render(input.templates?.body ?? rule.body, context).slice(0, 2000) || null;
  const href = input.href ?? rule.entry.href;
  const wantsEmail = input.email ?? rule.email;

  let reached = 0;
  for (const person of people) {
    const pref = prefBy.get(person.userId);
    const inApp = rule.inApp && (pref?.inApp ?? true);
    const email = wantsEmail && (pref?.email ?? true) && !!person.email;
    if (!inApp && !email) continue;

    const [row] = await db
      .insert(notifications)
      .values({
        orgId,
        userId: person.userId,
        eventKey: key,
        category,
        severity: input.severity ?? rule.entry.severity,
        title,
        body,
        href,
        actorLabel: input.actorLabel ?? null,
        dedupeKey: input.dedupeKey,
        // muted in-app but wanted by email: kept for the delivery, hidden from the inbox
        archivedAt: inApp ? null : new Date(),
      })
      .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
      .returning({ id: notifications.id });
    if (!row) continue; // already delivered — the queue replayed this event
    reached++;

    if (email) {
      await db.insert(notificationDeliveries).values({
        orgId,
        notificationId: row.id,
        toAddress: person.email,
        subject: title,
        body: [body, href ? `Open: ${href}` : null].filter(Boolean).join("\n\n"),
      });
    }
  }

  if (reached > 0) flushEmailInBackground();
  return reached;
}

/* ------------------------------------------------------------------ names */

/** Display names for employees, users and the organisation, for templates. */
export async function employeeNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter((v): v is string => !!v))];
  if (clean.length === 0) return new Map();
  const rows = await db
    .select({ id: employees.id, name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}` })
    .from(employees)
    .where(inArray(employees.id, clean));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function userName(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return row?.name ?? null;
}

/** "2083-06-10", or "2083-06-10 → 2083-06-14". */
export function bsSpan(fromBs: unknown, toBs: unknown): string {
  const a = String(fromBs ?? "");
  const b = String(toBs ?? "");
  return !b || a === b ? a : `${a} → ${b}`;
}

/** "half a day", "1 day", "4 days". */
export function dayCount(days: unknown): string {
  const n = Number(days);
  if (!Number.isFinite(n)) return "";
  if (n === 0.5) return "half a day";
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? "day" : "days"}`;
}

/* ------------------------------------------------------------------ inbox */

export type InboxRow = typeof notifications.$inferSelect;

/** What the bell shows: serialisable, so it can cross to the client. */
export type BellItem = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  severity: string;
  category: string;
  actorLabel: string | null;
  createdAt: string;
  read: boolean;
};
export type BellSummary = { unread: number; items: BellItem[] };

export async function bellSummaryFor(userId: string): Promise<BellSummary> {
  const [unread, rows] = await Promise.all([unreadCount(userId), latest(userId, 8)]);
  return {
    unread,
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      href: r.href,
      severity: r.severity,
      category: r.category,
      actorLabel: r.actorLabel,
      createdAt: r.createdAt.toISOString(),
      read: r.readAt !== null,
    })),
  };
}

export async function unreadCount(userId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), isNull(notifications.archivedAt)));
  return Number(n);
}

export async function latest(userId: string, limit = 8): Promise<InboxRow[]> {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.archivedAt)))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function inbox(
  userId: string,
  opts: { view: "all" | "unread" | "archived"; category: Category | null; page: string | null },
): Promise<{ rows: InboxRow[]; page: OffsetPage; byCategory: Record<string, number> }> {
  const where = and(
    eq(notifications.userId, userId),
    opts.view === "archived" ? sql`${notifications.archivedAt} IS NOT NULL` : isNull(notifications.archivedAt),
    opts.view === "unread" ? isNull(notifications.readAt) : undefined,
    opts.category ? eq(notifications.category, opts.category) : undefined,
  );
  const [[{ n }], unreadByCategory] = await Promise.all([
    db.select({ n: count() }).from(notifications).where(where),
    db
      .select({ category: notifications.category, n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), isNull(notifications.archivedAt)))
      .groupBy(notifications.category),
  ]);
  const page = offsetPage({ page: opts.page, total: Number(n), defaultSize: 20 });
  const rows = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(page.limit)
    .offset(page.offset);
  return { rows, page, byCategory: Object.fromEntries(unreadByCategory.map((r) => [r.category, Number(r.n)])) };
}

/** Marks read, unread, archived or restored — only ever the caller's own rows. */
export async function updateMine(
  userId: string,
  ids: string[] | "all",
  change: "read" | "unread" | "archive" | "restore",
): Promise<number> {
  const set =
    change === "read"
      ? { readAt: new Date() }
      : change === "unread"
        ? { readAt: null }
        : change === "archive"
          ? { archivedAt: new Date(), readAt: sql`coalesce(${notifications.readAt}, now())` }
          : { archivedAt: null };
  const rows = await db
    .update(notifications)
    .set(set)
    .where(
      and(
        eq(notifications.userId, userId),
        ids === "all" ? isNull(notifications.archivedAt) : inArray(notifications.id, ids),
        change === "read" && ids === "all" ? isNull(notifications.readAt) : undefined,
      ),
    )
    .returning({ id: notifications.id });
  return rows.length;
}

/* ------------------------------------------------------------ preferences */

export async function preferencesFor(userId: string): Promise<Map<string, { inApp: boolean; email: boolean }>> {
  const rows = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  return new Map(rows.map((r) => [r.category, { inApp: r.inApp, email: r.email }]));
}

export async function savePreference(userId: string, category: Category, value: { inApp: boolean; email: boolean }) {
  await db
    .insert(notificationPreferences)
    .values({ userId, category, ...value })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.category],
      set: { ...value, updatedAt: new Date() },
    });
}

/* ------------------------------------------------------------ announcements */

export type Audience =
  | { kind: "everyone" }
  | { kind: "department"; id: string; label?: string }
  | { kind: "branch"; id: string; label?: string }
  | { kind: "role"; id: string; label?: string };

export async function audienceUsers(orgId: string, audience: Audience): Promise<Recipients> {
  const base = and(eq(userAccounts.orgId, orgId), eq(userAccounts.isActive, true));
  if (audience.kind === "everyone") {
    return db
      .select({ userId: userAccounts.userId, email: user.email, name: user.name })
      .from(userAccounts)
      .innerJoin(user, eq(user.id, userAccounts.userId))
      .where(base);
  }
  if (audience.kind === "role") {
    return db
      .selectDistinct({ userId: userAccounts.userId, email: user.email, name: user.name })
      .from(userAccounts)
      .innerJoin(user, eq(user.id, userAccounts.userId))
      .innerJoin(userRoles, eq(userRoles.userId, userAccounts.userId))
      .where(and(base, eq(userRoles.roleId, audience.id)));
  }
  const column = audience.kind === "department" ? employees.departmentId : employees.branchId;
  return db
    .select({ userId: userAccounts.userId, email: user.email, name: user.name })
    .from(userAccounts)
    .innerJoin(user, eq(user.id, userAccounts.userId))
    .innerJoin(employees, eq(employees.id, userAccounts.employeeId))
    .where(and(base, eq(column, audience.id), employedNow()));
}

export async function sendAnnouncement(
  orgId: string,
  input: { title: string; body: string | null; href: string | null; severity: Severity; audience: Audience; email: boolean },
  sender: { userId: string; label: string },
): Promise<{ id: string; reached: number }> {
  const people = await audienceUsers(orgId, input.audience);
  const [row] = await db
    .insert(announcements)
    .values({
      orgId,
      title: input.title,
      body: input.body,
      href: input.href,
      severity: input.severity,
      audience: input.audience,
      alsoEmail: input.email,
      sentByLabel: sender.label,
    })
    .returning({ id: announcements.id });

  const reached = await notify(orgId, "announcement", {
    context: { title: input.title, body: input.body ?? "" },
    recipients: people,
    actorLabel: sender.label,
    // the sender sees their own announcement too — it is how they check it went out
    actorUserId: null,
    dedupeKey: `announcement:${row.id}`,
    severity: input.severity,
    href: input.href ?? undefined,
    email: input.email,
  });
  await db.update(announcements).set({ recipientCount: reached }).where(eq(announcements.id, row.id));
  return { id: row.id, reached };
}

/* --------------------------------------------------------------- reminders */

const lastSweep = new Map<string, number>();

/**
 * Time-based reminders — nothing *happens* to trigger them, so something has
 * to look. Run from the cron endpoint in production; also opportunistically
 * from page loads, throttled to once per half hour per organisation, so a
 * deployment without a scheduler still gets them. Dedupe keys make running
 * it too often harmless.
 */
export async function sweepReminders(orgId: string, opts: { force?: boolean } = {}): Promise<number> {
  const now = Date.now();
  if (!opts.force && now - (lastSweep.get(orgId) ?? 0) < 30 * 60_000) return 0;
  lastSweep.set(orgId, now);

  const rules = await loadRules(orgId);
  const today = todayInNepal();
  let sent = 0;

  // approvals waiting too long — once a day per request
  const waiting = rules.get("reminder.approval_waiting");
  if (waiting?.enabled) {
    const days = waiting.thresholdDays ?? 3;
    const cutoff = new Date(now - days * 86_400_000);
    const rows = await db
      .select({
        id: leaveRequests.id,
        reference: leaveRequests.reference,
        employeeId: leaveRequests.employeeId,
        fromDateBs: leaveRequests.fromDateBs,
        toDateBs: leaveRequests.toDateBs,
        totalDays: leaveRequests.totalDays,
        submittedAt: leaveRequests.submittedAt,
        typeName: leaveTypes.name,
        approverEmployeeId: approvalSteps.approverEmployeeId,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .innerJoin(
        approvalSteps,
        and(
          eq(approvalSteps.entityType, "leave_request"),
          eq(approvalSteps.entityId, leaveRequests.id),
          eq(approvalSteps.level, sql`coalesce(${leaveRequests.currentLevel}, 1)`),
        ),
      )
      .where(and(eq(leaveRequests.orgId, orgId), eq(leaveRequests.status, "pending"), lte(leaveRequests.submittedAt, cutoff)));
    const names = await employeeNames(rows.flatMap((r) => [r.employeeId, r.approverEmployeeId]));
    for (const r of rows) {
      const age = Math.floor((now - (r.submittedAt?.getTime() ?? now)) / 86_400_000);
      sent += await notify(orgId, "reminder.approval_waiting", {
        context: {
          employee: names.get(r.employeeId),
          approver: names.get(r.approverEmployeeId ?? ""),
          leaveType: r.typeName,
          dates: bsSpan(r.fromDateBs, r.toDateBs),
          days: dayCount(r.totalDays),
          reference: r.reference,
          waiting: dayCount(age),
        },
        subjectEmployeeId: r.employeeId,
        approverEmployeeId: r.approverEmployeeId,
        dedupeKey: `reminder.approval:${r.id}:${today}`,
      });
    }
  }

  // documents expiring — once per document per expiry date
  const expiring = rules.get("reminder.document_expiring");
  if (expiring?.enabled) {
    const until = addDays(today, expiring.thresholdDays ?? 30);
    const rows = await db
      .select({
        id: employeeDocuments.id,
        title: employeeDocuments.title,
        expiresOn: employeeDocuments.expiresOn,
        employeeId: employeeDocuments.employeeId,
      })
      .from(employeeDocuments)
      .innerJoin(employees, eq(employees.id, employeeDocuments.employeeId))
      .where(
        and(
          eq(employees.orgId, orgId),
          employedNow(),
          isNull(employeeDocuments.deletedAt),
          gte(employeeDocuments.expiresOn, today),
          lte(employeeDocuments.expiresOn, until),
        ),
      );
    const names = await employeeNames(rows.map((r) => r.employeeId));
    for (const r of rows) {
      const inDays = daysUntil(today, r.expiresOn!);
      sent += await notify(orgId, "reminder.document_expiring", {
        context: {
          employee: names.get(r.employeeId),
          document: r.title,
          expires: inDays === 0 ? "today" : `in ${dayCount(inDays)}`,
          expiryDate: formatBsKey(adToBs(r.expiresOn!)),
        },
        subjectEmployeeId: r.employeeId,
        dedupeKey: `reminder.document:${r.id}:${r.expiresOn}`,
      });
    }
  }

  // probation ending — once per employee per end date
  const probation = rules.get("reminder.probation_ending");
  if (probation?.enabled) {
    const until = addDays(today, probation.thresholdDays ?? 14);
    const rows = await db
      .select({
        id: employees.id,
        name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        ends: employees.probationEndDate,
      })
      .from(employees)
      .where(
        and(
          eq(employees.orgId, orgId),
          eq(employees.status, "probation"),
          gte(employees.probationEndDate, today),
          lte(employees.probationEndDate, until),
        ),
      );
    for (const r of rows) {
      const inDays = daysUntil(today, r.ends!);
      sent += await notify(orgId, "reminder.probation_ending", {
        context: {
          employee: r.name,
          ends: inDays === 0 ? "today" : `in ${dayCount(inDays)}`,
          probationEnd: formatBsKey(adToBs(r.ends!)),
        },
        subjectEmployeeId: r.id,
        dedupeKey: `reminder.probation:${r.id}:${r.ends}`,
      });
    }
  }

  return sent;
}

export function sweepInBackground(orgId: string): void {
  void sweepReminders(orgId).catch((error) => console.error("[notifications] reminder sweep failed:", error));
}

/* ---------------------------------------------------------------- oversight */

export async function stats(orgId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [byCategory, [totals], deliveries, byDay, byEvent] = await Promise.all([
    db
      .select({ category: notifications.category, n: count() })
      .from(notifications)
      .where(and(eq(notifications.orgId, orgId), gte(notifications.createdAt, since)))
      .groupBy(notifications.category),
    db
      .select({
        total: count(),
        read: sql<number>`count(*) FILTER (WHERE ${notifications.readAt} IS NOT NULL)::int`,
        unread: sql<number>`count(*) FILTER (WHERE ${notifications.readAt} IS NULL AND ${notifications.archivedAt} IS NULL)::int`,
      })
      .from(notifications)
      .where(and(eq(notifications.orgId, orgId), gte(notifications.createdAt, since))),
    db
      .select({ status: notificationDeliveries.status, n: count() })
      .from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.orgId, orgId), gte(notificationDeliveries.createdAt, since)))
      .groupBy(notificationDeliveries.status),
    db
      .select({ day: sql<string>`to_char(${notifications.createdAt}, 'YYYY-MM-DD')`, n: count() })
      .from(notifications)
      .where(and(eq(notifications.orgId, orgId), gte(notifications.createdAt, new Date(Date.now() - 14 * 86_400_000))))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({ key: notifications.eventKey, n: count() })
      .from(notifications)
      .where(and(eq(notifications.orgId, orgId), gte(notifications.createdAt, since)))
      .groupBy(notifications.eventKey),
  ]);
  return {
    byCategory: Object.fromEntries(byCategory.map((r) => [r.category, Number(r.n)])),
    total: Number(totals?.total ?? 0),
    read: Number(totals?.read ?? 0),
    unread: Number(totals?.unread ?? 0),
    deliveries: Object.fromEntries(deliveries.map((r) => [r.status, Number(r.n)])),
    byDay: byDay.map((r) => ({ day: r.day, n: Number(r.n) })),
    byEvent: Object.fromEntries(byEvent.map((r) => [r.key, Number(r.n)])),
  };
}

export async function recentDeliveries(orgId: string, status: string | null, page: string | null) {
  const where = and(eq(notificationDeliveries.orgId, orgId), status ? eq(notificationDeliveries.status, status) : undefined);
  const [{ n }] = await db.select({ n: count() }).from(notificationDeliveries).where(where);
  const p = offsetPage({ page, total: Number(n), defaultSize: 25 });
  const rows = await db
    .select({
      id: notificationDeliveries.id,
      toAddress: notificationDeliveries.toAddress,
      subject: notificationDeliveries.subject,
      status: notificationDeliveries.status,
      attempts: notificationDeliveries.attempts,
      lastError: notificationDeliveries.lastError,
      createdAt: notificationDeliveries.createdAt,
      sentAt: notificationDeliveries.sentAt,
      eventKey: notifications.eventKey,
    })
    .from(notificationDeliveries)
    .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
    .where(where)
    .orderBy(desc(notificationDeliveries.createdAt))
    .limit(p.limit)
    .offset(p.offset);
  return { rows, page: p };
}

export async function recentNotifications(orgId: string, page: string | null) {
  const [{ n }] = await db.select({ n: count() }).from(notifications).where(eq(notifications.orgId, orgId));
  const p = offsetPage({ page, total: Number(n), defaultSize: 25 });
  const rows = await db
    .select({
      id: notifications.id,
      eventKey: notifications.eventKey,
      category: notifications.category,
      severity: notifications.severity,
      title: notifications.title,
      readAt: notifications.readAt,
      archivedAt: notifications.archivedAt,
      createdAt: notifications.createdAt,
      recipient: user.name,
    })
    .from(notifications)
    .innerJoin(user, eq(user.id, notifications.userId))
    .where(eq(notifications.orgId, orgId))
    .orderBy(desc(notifications.createdAt))
    .limit(p.limit)
    .offset(p.offset);
  return { rows, page: p };
}

export async function recentAnnouncements(orgId: string, limit = 10) {
  return db
    .select()
    .from(announcements)
    .where(eq(announcements.orgId, orgId))
    .orderBy(desc(announcements.createdAt))
    .limit(limit);
}
