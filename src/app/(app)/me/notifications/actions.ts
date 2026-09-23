"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/session";
import { CATEGORIES, type Category } from "@/modules/notifications/catalogue";
import { bellSummaryFor, savePreference, updateMine, type BellSummary } from "@/modules/notifications/service";

/**
 * The actions behind the bell and the inbox. Every one acts on the caller's
 * own notifications only — the user id comes from the session, never from
 * the form — so there is no id a person could send to read or clear somebody
 * else's.
 */

export type { BellItem, BellSummary } from "@/modules/notifications/service";

export async function bellSummary(): Promise<BellSummary> {
  const viewer = await requireViewer();
  return bellSummaryFor(viewer.userId);
}

const idList = z.array(z.string().uuid()).max(200);
const change = z.enum(["read", "unread", "archive", "restore"]);

/** Called from the bell and the inbox. `ids` of "all" marks everything visible. */
export async function markNotifications(ids: string[] | "all", what: "read" | "unread" | "archive" | "restore") {
  const viewer = await requireViewer();
  const parsedChange = change.parse(what);
  const target = ids === "all" ? "all" : idList.parse(ids);
  const n = await updateMine(viewer.userId, target, parsedChange);
  revalidatePath("/me/notifications");
  return n;
}

/** Form action for the inbox's bulk bar and row buttons. */
export async function markFromForm(formData: FormData) {
  const what = change.parse(formData.get("change"));
  const all = formData.get("all") === "1";
  const ids = formData.getAll("id").map(String);
  await markNotifications(all ? "all" : ids, what);
}

const CATEGORY_KEYS = CATEGORIES.map((c) => c.key) as [Category, ...Category[]];

export async function savePreferences(formData: FormData) {
  const viewer = await requireViewer();
  for (const key of CATEGORY_KEYS) {
    await savePreference(viewer.userId, key, {
      inApp: formData.get(`${key}.inApp`) === "on",
      email: formData.get(`${key}.email`) === "on",
    });
  }
  revalidatePath("/me/notifications");
}
