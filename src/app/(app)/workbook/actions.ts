"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { validateEntry } from "@/modules/workbook/catalogue";
import { reopenEntry, saveEntry, WorkBookError } from "@/modules/workbook/service";

export type WorkBookState = { ok?: string; error?: string; fieldErrors?: Record<string, string>; at?: number };

/** The editor posts its task list as one JSON field; anything bigger than this is not a day's work. */
const MAX_PAYLOAD = 200_000;

async function audit(v: { orgId: string; userId: string; name: string }, action: "create" | "update", id: string, summary: string) {
  await db.insert(auditLog).values({ orgId: v.orgId, actorUserId: v.userId, actorLabel: v.name, action, entityType: "work_book_entry", entityId: id, summary });
}

/**
 * Saves or submits the caller's own day. The employee comes from the session,
 * never the form, so nobody can write into somebody else's work-book.
 */
export async function saveWorkBookAction(_prev: WorkBookState, formData: FormData): Promise<WorkBookState> {
  const viewer = await requirePermission("workbook.entry.write");
  if (!viewer.employeeId) return { error: "This login is not linked to an employee record." };

  const date = String(formData.get("date") ?? "");
  const submit = formData.get("intent") === "submit";
  const raw = String(formData.get("payload") ?? "");
  if (raw.length > MAX_PAYLOAD) return { error: "That is too much to save in one day." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return { error: "The work-book could not be read. Reload and try again." };
  }

  const v = validateEntry(parsed, submit);
  if (!v.ok) return { error: Object.values(v.errors)[0] ?? "Check the highlighted fields.", fieldErrors: v.errors };

  try {
    const r = await saveEntry({ orgId: viewer.orgId, employeeId: viewer.employeeId }, date, v.value, submit);
    if (submit) await audit(viewer, "create", r.id, `Submitted work-book for ${date} (${v.value.tasks.length} tasks, ${r.totalMinutes} min)`);
    revalidatePath("/workbook");
    return { ok: submit ? "Day submitted. It is now locked." : "Draft saved.", at: Date.now() };
  } catch (error) {
    if (error instanceof WorkBookError) return { error: error.message };
    throw error;
  }
}

/** Puts a submitted day back into draft so its author can correct it. Reviewers only. */
export async function reopenWorkBookAction(_prev: WorkBookState, formData: FormData): Promise<WorkBookState> {
  const viewer = await requirePermission("workbook.record.viewAll");
  const id = String(formData.get("id") ?? "");
  if (!z.uuid().safeParse(id).success) return { error: "Unknown entry." };
  try {
    const r = await reopenEntry(viewer.orgId, id, viewer.name);
    await audit(viewer, "update", id, `Reopened work-book day ${r.date} for correction`);
    revalidatePath("/workbook/records");
    return { ok: "Reopened — the author can edit it again.", at: Date.now() };
  } catch (error) {
    if (error instanceof WorkBookError) return { error: error.message };
    throw error;
  }
}
