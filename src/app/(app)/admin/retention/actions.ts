"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { DATASET_BY_KEY, optimiseTables, RetentionError, runRetention, savePolicy, type DatasetKey } from "@/lib/retention";

export type RetentionState = { ok?: string; error?: string; at?: number };

function readKey(formData: FormData): DatasetKey | null {
  const key = String(formData.get("dataset") ?? "") as DatasetKey;
  return DATASET_BY_KEY.has(key) ? key : null;
}

export async function savePolicyAction(_prev: RetentionState, formData: FormData): Promise<RetentionState> {
  const viewer = await requirePermission("admin.retention.manage");
  const key = readKey(formData);
  if (!key) return { error: "Unknown dataset." };
  const raw = String(formData.get("retentionDays") ?? "");
  const retentionDays = raw === "forever" ? null : Number(raw);
  if (retentionDays !== null && !Number.isFinite(retentionDays)) return { error: "Choose how long to keep it." };
  const isAutomatic = formData.get("isAutomatic") === "on";

  try {
    await savePolicy(viewer.orgId, key, { retentionDays, isAutomatic }, viewer.name);
  } catch (error) {
    if (error instanceof RetentionError) return { error: error.message };
    throw error;
  }
  const label = DATASET_BY_KEY.get(key)!.label;
  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "retention",
    entityId: key,
    summary: `${label}: keep ${retentionDays === null ? "forever" : `${retentionDays} days`}, ${isAutomatic && retentionDays !== null ? "cleared automatically" : "cleared on demand"}`,
  });
  revalidatePath("/admin/retention");
  return { ok: "Saved.", at: Date.now() };
}

export async function purgeNowAction(_prev: RetentionState, formData: FormData): Promise<RetentionState> {
  const viewer = await requirePermission("admin.retention.manage");
  const key = readKey(formData);
  if (!key) return { error: "Unknown dataset." };
  const [result] = await runRetention(viewer.orgId, { only: key, actor: { userId: viewer.userId, label: viewer.name } });
  revalidatePath("/admin/retention");
  if (!result || result.purged === 0) {
    return { ok: result?.skipped ? `Nothing could be purged; ${result.skipped} kept because other records depend on them.` : "Nothing old enough to clear.", at: Date.now() };
  }
  return {
    ok: `Cleared ${result.purged.toLocaleString("en-IN")} ${result.purged === 1 ? "row" : "rows"}${result.skipped ? `; ${result.skipped} kept` : ""}.`,
    at: Date.now(),
  };
}

export async function optimiseAction(): Promise<RetentionState> {
  const viewer = await requirePermission("admin.retention.manage");
  const done = await optimiseTables();
  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "database",
    summary: `Optimised ${done.length} tables (VACUUM ANALYZE)`,
  });
  revalidatePath("/admin/retention");
  return done.length
    ? { ok: `Optimised ${done.length} tables — freed space is reusable and planner statistics are fresh.`, at: Date.now() }
    : { error: "The database user may not vacuum these tables; autovacuum will still reclaim the space." };
}
