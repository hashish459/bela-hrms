"use server";

import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { DIAGNOSTICS, DiagnosticError, isDiagnosticKey, runDiagnostic, type DiagnosticResult } from "@/lib/db-console";

export type DiagnosticState = { key?: string; result?: DiagnosticResult; error?: string; at?: number };

/** Runs one fixed, read-only diagnostic by key. No SQL comes from the browser. */
export async function runDiagnosticAction(_prev: DiagnosticState, formData: FormData): Promise<DiagnosticState> {
  const viewer = await requirePermission("admin.retention.manage");
  const key = String(formData.get("diagnostic") ?? "");
  if (!isDiagnosticKey(key)) return { error: "Unknown diagnostic." };
  try {
    const result = await runDiagnostic(key);
    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: "update",
      entityType: "database",
      entityId: key,
      summary: `Ran database diagnostic "${DIAGNOSTICS[key].label}"`,
    });
    return { key, result, at: Date.now() };
  } catch (error) {
    if (error instanceof DiagnosticError) return { key, error: error.message, at: Date.now() };
    throw error;
  }
}
