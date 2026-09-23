"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { drainInBackground } from "@/kernel/events";
import { decideChange } from "@/modules/people/changes";
import { RecordError } from "@/modules/people/records";

export type DecideState = { ok?: string; error?: string; at?: number };

export async function decideChangeAction(_prev: DecideState, formData: FormData): Promise<DecideState> {
  const viewer = await requirePermission("hr.employee.update");
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  if (!z.uuid().safeParse(id).success || (decision !== "approved" && decision !== "rejected")) {
    return { error: "That decision could not be read." };
  }

  try {
    const result = await decideChange(viewer.orgId, id, decision, note, { userId: viewer.userId, label: viewer.name });
    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: decision === "approved" ? "approve" : "reject",
      entityType: "profile_change_request",
      entityId: id,
      summary: `${decision === "approved" ? "Applied" : "Refused"} a ${result.section.toLowerCase()} change (${result.action})`,
    });
    drainInBackground(viewer.orgId);
    revalidatePath("/hr/profile-requests");
    revalidatePath(`/hr/employees/${result.employeeId}`);
    return { ok: decision === "approved" ? "Applied to the record." : "Refused. The employee has been told why.", at: Date.now() };
  } catch (error) {
    if (error instanceof RecordError) return { error: error.message };
    throw error;
  }
}
