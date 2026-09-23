"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { drainInBackground } from "@/kernel/events";
import {
  addClearance,
  cancelSeparation,
  completeSeparation,
  initiateSeparation,
  SEPARATION_LABEL,
  SeparationError,
  setClearance,
  updateSeparation,
} from "@/modules/people/separations";

export type SeparationState = { ok?: string; error?: string; fieldErrors?: Record<string, string>; at?: number };

const date = (msg: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullable();

const initiateSchema = z.object({
  employeeId: z.uuid("Choose the employee"),
  kind: z.enum(["resignation", "termination", "retirement", "contract_end", "death", "absconding"]),
  noticeDate: date("When was notice given?"),
  lastWorkingDate: date("Choose the last working day"),
  reason: text(1000),
});

function fail(error: unknown): SeparationState {
  if (error instanceof SeparationError) {
    return { error: error.message, fieldErrors: error.field ? { [error.field]: error.message } : undefined };
  }
  throw error;
}

async function audit(viewer: { orgId: string; userId: string; name: string }, id: string, action: "create" | "update" | "cancel", summary: string) {
  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action,
    entityType: "employee_separation",
    entityId: id,
    summary,
  });
}

export async function initiateSeparationAction(_prev: SeparationState, formData: FormData): Promise<SeparationState> {
  const viewer = await requirePermission("hr.employee.separate");
  const parsed = initiateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { error: "Please correct the highlighted fields.", fieldErrors };
  }
  let created: { id: string; reference: string };
  try {
    created = await initiateSeparation(viewer.orgId, parsed.data, { userId: viewer.userId, label: viewer.name });
  } catch (error) {
    return fail(error);
  }
  await audit(viewer, created.id, "create", `${SEPARATION_LABEL[parsed.data.kind]} ${created.reference} recorded`);
  drainInBackground(viewer.orgId);
  revalidatePath("/hr/separations");
  redirect(`/hr/separations/${created.id}`);
}

const updateSchema = z.object({
  id: z.uuid(),
  lastWorkingDate: date("Choose the last working day").optional(),
  exitInterview: text(4000).optional(),
  eligibleForRehire: z.enum(["yes", "no"]).optional(),
  settlementStatus: z.enum(["pending", "processed", "not_applicable"]).optional(),
  settlementNote: text(1000).optional(),
});

export async function updateSeparationAction(_prev: SeparationState, formData: FormData): Promise<SeparationState> {
  const viewer = await requirePermission("hr.employee.separate");
  const parsed = updateSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "That form could not be read." };
  const { id, eligibleForRehire, ...rest } = parsed.data;
  try {
    await updateSeparation(viewer.orgId, id, {
      ...rest,
      ...(eligibleForRehire ? { eligibleForRehire: eligibleForRehire === "yes" } : {}),
    });
  } catch (error) {
    return fail(error);
  }
  await audit(viewer, id, "update", "Updated a separation case");
  revalidatePath(`/hr/separations/${id}`);
  return { ok: "Saved.", at: Date.now() };
}

export async function setClearanceAction(_prev: SeparationState, formData: FormData): Promise<SeparationState> {
  const viewer = await requirePermission("hr.employee.separate");
  const id = String(formData.get("clearanceId") ?? "");
  const caseId = String(formData.get("caseId") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!z.uuid().safeParse(id).success || !["pending", "cleared", "waived"].includes(status)) {
    return { error: "That line could not be read." };
  }
  if (status === "waived" && !note) return { error: "Say why the line is waived." };
  try {
    await setClearance(viewer.orgId, id, status as "cleared", note, viewer.name);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/hr/separations/${caseId}`);
  return { ok: "Updated.", at: Date.now() };
}

export async function addClearanceAction(_prev: SeparationState, formData: FormData): Promise<SeparationState> {
  const viewer = await requirePermission("hr.employee.separate");
  const caseId = String(formData.get("caseId") ?? "");
  const owner = String(formData.get("owner") ?? "").trim();
  const item = String(formData.get("item") ?? "").trim();
  if (!z.uuid().safeParse(caseId).success) return { error: "Unknown case." };
  if (!owner || !item) return { error: "Give the line an owner and an item." };
  if (owner.length > 60 || item.length > 300) return { error: "Keep the owner and item short." };
  try {
    await addClearance(viewer.orgId, caseId, owner, item);
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/hr/separations/${caseId}`);
  return { ok: "Line added.", at: Date.now() };
}

export async function completeSeparationAction(_prev: SeparationState, formData: FormData): Promise<SeparationState> {
  const viewer = await requirePermission("hr.employee.separate");
  const id = String(formData.get("id") ?? "");
  if (!z.uuid().safeParse(id).success) return { error: "Unknown case." };
  let result: Awaited<ReturnType<typeof completeSeparation>>;
  try {
    result = await completeSeparation(viewer.orgId, id, { userId: viewer.userId, label: viewer.name });
  } catch (error) {
    return fail(error);
  }
  await audit(
    viewer,
    id,
    "update",
    `Completed ${result.reference}; employee record closed${result.loginsClosed ? " and login disabled" : ""}`,
  );
  drainInBackground(viewer.orgId);
  revalidatePath("/hr/separations");
  revalidatePath(`/hr/separations/${id}`);
  return {
    ok: `${result.reference} completed. The record is closed${result.loginsClosed ? " and their login is switched off" : ""}.`,
    at: Date.now(),
  };
}

export async function cancelSeparationAction(_prev: SeparationState, formData: FormData): Promise<SeparationState> {
  const viewer = await requirePermission("hr.employee.separate");
  const id = String(formData.get("id") ?? "");
  if (!z.uuid().safeParse(id).success) return { error: "Unknown case." };
  try {
    const reference = await cancelSeparation(viewer.orgId, id);
    await audit(viewer, id, "cancel", `Cancelled ${reference}`);
  } catch (error) {
    return fail(error);
  }
  revalidatePath("/hr/separations");
  revalidatePath(`/hr/separations/${id}`);
  return { ok: "Cancelled. The employee stays on strength.", at: Date.now() };
}
