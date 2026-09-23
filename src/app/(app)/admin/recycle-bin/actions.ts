"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { MasterError } from "@/modules/org/masters";
import { StructureError } from "@/modules/org/structure";
import { RecordError } from "@/modules/people/records";
import { BIN_TYPES, purgeItem, restoreItem, type BinType } from "@/lib/recycle-bin";

export type BinState = { ok?: string; error?: string; at?: number };

export async function binAction(_prev: BinState, formData: FormData): Promise<BinState> {
  const viewer = await requirePermission("admin.recycle.manage");
  const type = String(formData.get("type") ?? "") as BinType;
  const id = String(formData.get("id") ?? "");
  const op = String(formData.get("op") ?? "");
  const label = String(formData.get("label") ?? "").slice(0, 200);
  // user ids come from the auth library and are not uuids
  const validId = type === "user" ? /^[A-Za-z0-9_-]{8,64}$/.test(id) : z.uuid().safeParse(id).success;
  if (!BIN_TYPES.some((t) => t.key === type) || !validId || (op !== "restore" && op !== "purge")) {
    return { error: "That request could not be read." };
  }

  let message: string;
  try {
    message = op === "restore" ? await restoreItem(viewer.orgId, type, id) : await purgeItem(viewer.orgId, type, id);
  } catch (error) {
    if (error instanceof RecordError || error instanceof MasterError || error instanceof StructureError) {
      return { error: error.message };
    }
    throw error;
  }

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: op,
    entityType: type,
    entityId: id,
    summary: `${op === "restore" ? "Restored" : "Permanently purged"} ${BIN_TYPES.find((t) => t.key === type)!.label.toLowerCase().replace(/s$/, "")} ${label}`.trim(),
  });

  revalidatePath("/admin/recycle-bin");
  return { ok: message, at: Date.now() };
}
