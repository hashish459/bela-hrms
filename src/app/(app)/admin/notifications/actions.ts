"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { CATALOGUE_BY_KEY, unknownPlaceholders, type Recipient } from "@/modules/notifications/catalogue";
import {
  audienceUsers,
  loadRules,
  notify,
  resetRule,
  saveRule,
  sendAnnouncement,
  sweepReminders,
  type Audience,
} from "@/modules/notifications/service";
import { flushEmail } from "@/modules/notifications/email";

/**
 * The administrator's notification controls. All behind one permission, and
 * all audited: a rule switched off is the kind of change somebody later needs
 * to find the author of ("why did nobody hear about the leave request?").
 */

export type AdminState = { ok?: string; error?: string; fieldErrors?: Record<string, string>; at?: number };

const PERMISSION = "admin.notifications.manage";

async function audit(viewer: { orgId: string; userId: string; name: string }, summary: string, entityId: string | null) {
  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "notification",
    entityId,
    summary,
  });
}

const ruleSchema = z.object({
  key: z.string().min(1),
  isEnabled: z.boolean(),
  inApp: z.boolean(),
  email: z.boolean(),
  recipients: z.array(z.enum(["subject", "approver", "supervisor", "hr"])),
  titleTemplate: z.string().trim().min(1, "A title is required.").max(200, "Keep titles to 200 characters."),
  bodyTemplate: z.string().trim().max(1000, "Keep the message to 1000 characters."),
  thresholdDays: z.coerce.number().int().min(0, "Zero or more.").max(365, "At most a year.").nullable(),
});

function readRule(formData: FormData) {
  const threshold = String(formData.get("thresholdDays") ?? "").trim();
  return ruleSchema.safeParse({
    key: formData.get("key"),
    isEnabled: formData.get("isEnabled") === "on",
    inApp: formData.get("inApp") === "on",
    email: formData.get("email") === "on",
    recipients: formData.getAll("recipients").map(String),
    titleTemplate: String(formData.get("titleTemplate") ?? ""),
    bodyTemplate: String(formData.get("bodyTemplate") ?? ""),
    thresholdDays: threshold === "" ? null : threshold,
  });
}

function validate(parsed: ReturnType<typeof readRule>): { data?: z.infer<typeof ruleSchema>; state?: AdminState } {
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { state: { fieldErrors } };
  }
  const entry = CATALOGUE_BY_KEY.get(parsed.data.key);
  if (!entry) return { state: { error: "Unknown notification." } };
  const fieldErrors: Record<string, string> = {};
  for (const field of ["titleTemplate", "bodyTemplate"] as const) {
    const unknown = unknownPlaceholders(parsed.data[field], entry);
    if (unknown.length) fieldErrors[field] = `Not available here: ${unknown.map((u) => `{{${u}}}`).join(", ")}`;
  }
  if (entry.allowedRecipients.length && parsed.data.isEnabled && parsed.data.recipients.length === 0) {
    fieldErrors.recipients = "Choose at least one recipient, or switch the notification off.";
  }
  if (parsed.data.isEnabled && !parsed.data.inApp && !parsed.data.email) {
    fieldErrors.inApp = "Choose at least one channel, or switch the notification off.";
  }
  if (Object.keys(fieldErrors).length) return { state: { fieldErrors } };
  return { data: parsed.data };
}

export async function saveRuleAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const viewer = await requirePermission(PERMISSION);
  const { data, state } = validate(readRule(formData));
  if (!data) return state!;
  await saveRule(
    viewer.orgId,
    data.key,
    {
      isEnabled: data.isEnabled,
      inApp: data.inApp,
      email: data.email,
      recipients: data.recipients as Recipient[],
      titleTemplate: data.titleTemplate,
      bodyTemplate: data.bodyTemplate,
      thresholdDays: data.thresholdDays,
    },
    viewer.name,
  );
  await audit(viewer, `Updated notification “${CATALOGUE_BY_KEY.get(data.key)?.label}”`, data.key);
  revalidatePath("/admin/notifications");
  return { ok: "Saved.", at: Date.now() };
}

/** The row's on/off switch: flips `enabled`, keeping everything else as it is now. */
export async function toggleRuleAction(key: string, enabled: boolean): Promise<AdminState> {
  const viewer = await requirePermission(PERMISSION);
  const rule = (await loadRules(viewer.orgId)).get(key);
  if (!rule) return { error: "Unknown notification." };
  await saveRule(
    viewer.orgId,
    key,
    {
      isEnabled: enabled,
      inApp: rule.inApp,
      email: rule.email,
      recipients: rule.recipients,
      titleTemplate: rule.title,
      bodyTemplate: rule.body,
      thresholdDays: rule.thresholdDays,
    },
    viewer.name,
  );
  await audit(viewer, `${enabled ? "Switched on" : "Switched off"} notification “${rule.entry.label}”`, key);
  revalidatePath("/admin/notifications");
  return { ok: enabled ? "Switched on." : "Switched off.", at: Date.now() };
}

export async function resetRuleAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const viewer = await requirePermission(PERMISSION);
  const key = String(formData.get("key") ?? "");
  const entry = CATALOGUE_BY_KEY.get(key);
  if (!entry) return { error: "Unknown notification." };
  await resetRule(viewer.orgId, key);
  await audit(viewer, `Reset notification “${entry.label}” to its default`, key);
  revalidatePath("/admin/notifications");
  return { ok: "Back to the default.", at: Date.now() };
}

/** Sends the wording in the form — saved or not — to the administrator alone, with sample values. */
export async function testRuleAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const viewer = await requirePermission(PERMISSION);
  const { data, state } = validate(readRule(formData));
  if (!data) return state!;
  const entry = CATALOGUE_BY_KEY.get(data.key)!;
  const reached = await notify(viewer.orgId, data.key, {
    context: entry.placeholders,
    recipients: [{ userId: viewer.userId, email: viewer.email, name: viewer.name }],
    force: true,
    email: data.email,
    templates: { title: `[Test] ${data.titleTemplate}`, body: data.bodyTemplate },
    dedupeKey: `test:${data.key}:${Date.now()}`,
    actorLabel: "Test",
  });
  return reached
    ? { ok: `Test sent to you${data.email ? " (in app and by email)" : ""} — check the bell.`, at: Date.now() }
    : { error: "The test could not be delivered." };
}

/* ------------------------------------------------------------ announcements */

const announcementSchema = z.object({
  title: z.string().trim().min(3, "A title is required.").max(140, "Keep the title to 140 characters."),
  body: z.string().trim().max(2000, "At most 2000 characters.").nullable(),
  href: z
    .string()
    .trim()
    .regex(/^\/[A-Za-z0-9/_\-?=&.#%]*$/, "An in-app path starting with /, e.g. /me/notices.")
    .nullable(),
  severity: z.enum(["info", "success", "warning", "danger"]),
  audienceKind: z.enum(["everyone", "department", "branch", "role"]),
  audienceId: z.string().uuid().nullable(),
  audienceLabel: z.string().max(200).nullable(),
  email: z.boolean(),
});

function readAnnouncement(formData: FormData) {
  const opt = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v === "" ? null : v;
  };
  return announcementSchema.safeParse({
    title: formData.get("title"),
    body: opt("body"),
    href: opt("href"),
    severity: formData.get("severity") ?? "info",
    audienceKind: formData.get("audienceKind") ?? "everyone",
    audienceId: opt("audienceId"),
    audienceLabel: opt("audienceLabel"),
    email: formData.get("email") === "on",
  });
}

function toAudience(d: z.infer<typeof announcementSchema>): Audience | null {
  if (d.audienceKind === "everyone") return { kind: "everyone" };
  if (!d.audienceId) return null;
  return { kind: d.audienceKind, id: d.audienceId, label: d.audienceLabel ?? undefined };
}

/** How many people an audience reaches, for the composer's "will reach N" line. */
export async function audienceCountAction(kind: string, id: string | null): Promise<number> {
  const viewer = await requirePermission(PERMISSION);
  const audience: Audience | null =
    kind === "everyone"
      ? { kind: "everyone" }
      : id && (kind === "department" || kind === "branch" || kind === "role")
        ? { kind, id }
        : null;
  if (!audience) return 0;
  return (await audienceUsers(viewer.orgId, audience)).length;
}

export async function sendAnnouncementAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const viewer = await requirePermission(PERMISSION);
  const parsed = readAnnouncement(formData);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors };
  }
  const audience = toAudience(parsed.data);
  if (!audience) return { fieldErrors: { audienceId: "Choose who it is for." } };

  const { reached } = await sendAnnouncement(
    viewer.orgId,
    {
      title: parsed.data.title,
      body: parsed.data.body,
      href: parsed.data.href,
      severity: parsed.data.severity,
      audience,
      email: parsed.data.email,
    },
    { userId: viewer.userId, label: viewer.name },
  );
  await audit(viewer, `Sent announcement “${parsed.data.title}” to ${reached} people`, null);
  revalidatePath("/admin/notifications/announcements");
  return reached
    ? { ok: `Sent to ${reached} ${reached === 1 ? "person" : "people"}.`, at: Date.now() }
    : { error: "Nobody is in that audience — nothing was sent." };
}

/* --------------------------------------------------------------- operations */

export async function runRemindersAction(): Promise<AdminState> {
  const viewer = await requirePermission(PERMISSION);
  const sent = await sweepReminders(viewer.orgId, { force: true });
  revalidatePath("/admin/notifications");
  return { ok: sent ? `Sent ${sent} reminder${sent === 1 ? "" : "s"}.` : "Nothing is due a reminder right now.", at: Date.now() };
}

export async function flushEmailAction(): Promise<AdminState> {
  await requirePermission(PERMISSION);
  const r = await flushEmail(100);
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/notifications/log");
  const total = r.sent + r.failed + r.skipped;
  return total
    ? { ok: `Processed ${total}: ${r.sent} sent, ${r.failed} failed, ${r.skipped} skipped.`, at: Date.now() }
    : { ok: "The email queue is empty.", at: Date.now() };
}
