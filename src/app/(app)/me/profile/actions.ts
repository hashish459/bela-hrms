"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSelf } from "@/modules/selfservice/guard";
import { drainInBackground } from "@/kernel/events";
import { submitChange, withdrawChange, type ChangeAction } from "@/modules/people/changes";
import { SECTION_BY_KEY, validateSection, type SectionKey } from "@/modules/people/profile-fields";
import { RecordError } from "@/modules/people/records";

export type ChangeState = { ok?: string; error?: string; fieldErrors?: Record<string, string>; at?: number };

/**
 * Proposes a change to the caller's own record. The employee id is the
 * session's — there is no field for it, so there is nothing to tamper with.
 */
export async function requestChangeAction(_prev: ChangeState, formData: FormData): Promise<ChangeState> {
  const ctx = await requireSelf("self.profile.view");
  const section = String(formData.get("section") ?? "") as SectionKey;
  const action = String(formData.get("action") ?? "update") as ChangeAction;
  const targetId = String(formData.get("targetId") ?? "") || null;
  const def = SECTION_BY_KEY.get(section);
  if (!def || !["update", "add", "remove"].includes(action) || (targetId && !z.uuid().safeParse(targetId).success)) {
    return { error: "That request could not be read." };
  }
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;

  let proposed = {};
  if (action !== "remove") {
    const parsed = validateSection(section, Object.fromEntries(formData.entries()));
    if (!parsed.ok) return { error: "Please correct the highlighted fields.", fieldErrors: parsed.errors };
    proposed = parsed.values;
  } else if (!note) {
    return { error: "Say why it should come off your record.", fieldErrors: { note: "Required" } };
  }

  try {
    await submitChange({ orgId: ctx.orgId, employeeId: ctx.employeeId, section, action, targetId, proposed, note });
  } catch (error) {
    if (error instanceof RecordError) return { error: error.message };
    throw error;
  }
  drainInBackground(ctx.orgId);
  revalidatePath("/me/profile");
  return { ok: "Sent to HR. You will be notified when they decide.", at: Date.now() };
}

export async function withdrawChangeAction(_prev: ChangeState, formData: FormData): Promise<ChangeState> {
  const ctx = await requireSelf("self.profile.view");
  const id = String(formData.get("id") ?? "");
  if (!z.uuid().safeParse(id).success) return { error: "Unknown request." };
  try {
    await withdrawChange(ctx.orgId, ctx.employeeId, id);
  } catch (error) {
    if (error instanceof RecordError) return { error: error.message };
    throw error;
  }
  revalidatePath("/me/profile");
  return { ok: "Withdrawn.", at: Date.now() };
}
