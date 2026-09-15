"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { setModuleEnabled } from "@/kernel/boot";
import { replayDead } from "@/kernel/events";

export type ActionState = { ok?: string; error?: string };

/** Modules that cannot be switched off, because the product has no meaning without them. */
const ESSENTIAL = new Set(["people", "calendar", "org"]);

export async function toggleModule(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requirePermission("admin.settings.manage");
  const moduleId = String(formData.get("moduleId") ?? "");
  const enable = String(formData.get("enable") ?? "") === "true";

  if (!moduleId) return { error: "No module named." };
  if (!enable && ESSENTIAL.has(moduleId)) {
    return {
      error: `${moduleId} is foundational — attendance, leave and payroll all read it. Switching it off would degrade everything at once.`,
    };
  }

  await setModuleEnabled({
    orgId: viewer.orgId,
    moduleId,
    isEnabled: enable,
    reason: enable ? null : "Switched off from Administration › Modules",
    updatedBy: viewer.name,
  });

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "module_state",
    entityId: null,
    summary: `${enable ? "Enabled" : "Disabled"} the ${moduleId} module`,
  });

  revalidatePath("/admin/modules");
  revalidatePath("/dashboard");
  return { ok: enable ? "Enabled." : "Switched off." };
}

/** Requeues events that gave up, once the cause has been dealt with. */
export async function replayParkedEvents(): Promise<ActionState> {
  const viewer = await requirePermission("admin.settings.manage");
  const count = await replayDead(viewer.orgId);

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "domain_event",
    entityId: null,
    summary: `Requeued ${count} parked event(s)`,
  });

  revalidatePath("/admin/modules");
  return { ok: `Requeued ${count} event${count === 1 ? "" : "s"}.` };
}
