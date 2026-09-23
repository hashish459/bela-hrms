"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { can, requirePermission } from "@/lib/session";
import {
  DAY_KIND_LABEL,
  decideClaim,
  OvertimeError,
  saveRule,
  submitClaim,
  withdrawClaim,
  type DayKind,
} from "@/lib/attendance/overtime";

export type OvertimeState = { ok?: string; error?: string; fieldErrors?: Record<string, string>; at?: number };

const minutesOf = (hours: FormDataEntryValue | null, minutes: FormDataEntryValue | null) =>
  Math.round(Number(hours || 0) * 60 + Number(minutes || 0));

function fail(error: unknown): OvertimeState {
  if (error instanceof OvertimeError) {
    return { error: error.message, fieldErrors: error.field ? { [error.field]: error.message } : undefined };
  }
  throw error;
}

async function audit(v: { orgId: string; userId: string; name: string }, action: "create" | "approve" | "reject" | "cancel" | "update", id: string, summary: string) {
  await db.insert(auditLog).values({ orgId: v.orgId, actorUserId: v.userId, actorLabel: v.name, action, entityType: "overtime_claim", entityId: id, summary });
}

export async function claimOvertimeAction(_prev: OvertimeState, formData: FormData): Promise<OvertimeState> {
  const viewer = await requirePermission("attendance.request.create");
  if (!viewer.employeeId) return { error: "This login is not linked to an employee record." };
  const date = String(formData.get("date") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const minutes = minutesOf(formData.get("hours"), formData.get("minutes"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Choose the day." };
  if (reason.length < 5) return { error: "Say what the overtime was for.", fieldErrors: { reason: "At least a few words" } };
  if (reason.length > 500) return { error: "Keep the reason under 500 characters.", fieldErrors: { reason: "Too long" } };

  try {
    const c = await submitClaim({ orgId: viewer.orgId, employeeId: viewer.employeeId, date, minutes, reason });
    await audit(viewer, "create", c.id, `Claimed ${minutes} min overtime for ${date} (${c.reference})`);
    revalidatePath("/attendance/overtime");
    return { ok: `${c.reference} sent for approval.`, at: Date.now() };
  } catch (error) {
    return fail(error);
  }
}

export async function withdrawOvertimeAction(_prev: OvertimeState, formData: FormData): Promise<OvertimeState> {
  const viewer = await requirePermission("attendance.request.create");
  const id = String(formData.get("id") ?? "");
  if (!viewer.employeeId || !z.uuid().safeParse(id).success) return { error: "Unknown claim." };
  try {
    const ref = await withdrawClaim(viewer.orgId, viewer.employeeId, id);
    await audit(viewer, "cancel", id, `Withdrew ${ref}`);
    revalidatePath("/attendance/overtime");
    return { ok: "Withdrawn.", at: Date.now() };
  } catch (error) {
    return fail(error);
  }
}

export async function decideOvertimeAction(_prev: OvertimeState, formData: FormData): Promise<OvertimeState> {
  const viewer = await requirePermission("attendance.request.approve");
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!z.uuid().safeParse(id).success || (decision !== "approved" && decision !== "rejected")) return { error: "That decision could not be read." };
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  const approvedMinutes = formData.get("hours") !== null ? minutesOf(formData.get("hours"), formData.get("minutes")) : undefined;

  try {
    const r = await decideClaim(viewer.orgId, id, decision, { approvedMinutes, note }, {
      userId: viewer.userId,
      label: viewer.name,
      employeeId: viewer.employeeId,
      seesAll: can(viewer, "attendance.record.viewAll"),
    });
    await audit(viewer, decision === "approved" ? "approve" : "reject", id, `${decision === "approved" ? "Approved" : "Rejected"} ${r.reference}${note ? ` — ${note}` : ""}`);
    revalidatePath("/attendance/overtime");
    return { ok: decision === "approved" ? `${r.reference} approved.` : `${r.reference} rejected.`, at: Date.now() };
  } catch (error) {
    return fail(error);
  }
}

export async function saveRuleAction(_prev: OvertimeState, formData: FormData): Promise<OvertimeState> {
  const viewer = await requirePermission("attendance.shift.manage");
  const kind = String(formData.get("dayKind") ?? "") as DayKind;
  if (!(kind in DAY_KIND_LABEL)) return { error: "Unknown kind of day." };
  try {
    await saveRule(
      viewer.orgId,
      kind,
      {
        multiplier: Number(formData.get("multiplier")),
        minMinutes: Number(formData.get("minMinutes")),
        maxMinutes: Number(formData.get("maxMinutes")),
      },
      viewer.name,
    );
    await audit(viewer, "update", kind, `Overtime rule for ${DAY_KIND_LABEL[kind].toLowerCase()}: ${formData.get("multiplier")}×`);
    revalidatePath("/attendance/overtime");
    return { ok: "Saved. New claims use this rate; decided ones keep theirs.", at: Date.now() };
  } catch (error) {
    return fail(error);
  }
}
