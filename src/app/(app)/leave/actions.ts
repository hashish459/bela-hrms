"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { can, requirePermission } from "@/lib/session";
import { drainInBackground } from "@/kernel/events";
import {
  LeaveError,
  cancelLeaveRequest,
  decideLeaveRequest,
  submitLeaveRequest,
} from "@/lib/leave";

export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

const applySchema = z
  .object({
    leaveTypeId: z.uuid("Choose a leave type"),
    fromDate: isoDate,
    toDate: isoDate,
    portion: z.enum(["full", "first_half", "second_half"]),
    reason: z.string().trim().min(5, "Give a short reason (at least 5 characters)").max(500),
    contactDuringLeave: z.string().trim().max(120).optional(),
    handoverToEmployeeId: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable(),
  })
  .refine((v) => v.toDate >= v.fromDate, {
    message: "The end date cannot be before the start date",
    path: ["toDate"],
  });

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    out[key] ??= issue.message;
  }
  return out;
}

export async function applyForLeave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requirePermission("leave.request.create");

  if (!viewer.employeeId) {
    return {
      ok: false,
      message: "Your login is not linked to an employee record, so it cannot raise leave.",
    };
  }
  if (!viewer.fiscalYear) {
    return { ok: false, message: "No fiscal year is marked current. Ask an administrator to set one." };
  }

  const parsed = applySchema.safeParse({
    leaveTypeId: formData.get("leaveTypeId"),
    fromDate: formData.get("fromDate"),
    toDate: formData.get("toDate"),
    portion: formData.get("portion") ?? "full",
    reason: formData.get("reason"),
    contactDuringLeave: formData.get("contactDuringLeave") ?? "",
    handoverToEmployeeId: formData.get("handoverToEmployeeId") ?? "",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }

  try {
    const request = await submitLeaveRequest({
      orgId: viewer.orgId,
      employeeId: viewer.employeeId,
      fiscalYearId: viewer.fiscalYear.id,
      ...parsed.data,
      contactDuringLeave: parsed.data.contactDuringLeave || null,
    });

    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: "create",
      entityType: "leave_request",
      entityId: request.id,
      summary: `Applied for leave (${request.reference})`,
    });

    // The transaction has committed; let attendance react to it now rather
    // than on the next request. Failures here are recorded against the event,
    // never surfaced as a failed approval.
    drainInBackground(viewer.orgId);

    revalidatePath("/leave/my");
    revalidatePath("/leave/approvals");
    revalidatePath("/dashboard");
    return { ok: true, message: `Submitted as ${request.reference}. It is now with your supervisor.` };
  } catch (error) {
    if (error instanceof LeaveError) {
      return {
        ok: false,
        message: error.message,
        fieldErrors: error.field ? { [error.field]: error.message } : undefined,
      };
    }
    throw error;
  }
}

const decideSchema = z.object({
  requestId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().trim().max(500).optional(),
});

export async function decideLeave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requirePermission("leave.request.approve");

  const parsed = decideSchema.safeParse({
    requestId: formData.get("requestId"),
    decision: formData.get("decision"),
    comment: formData.get("comment") ?? "",
  });
  if (!parsed.success) return { ok: false, message: "That decision could not be read." };

  if (parsed.data.decision === "rejected" && !parsed.data.comment) {
    return {
      ok: false,
      message: "Add a short note so the employee knows why it was rejected.",
      fieldErrors: { comment: "Required when rejecting" },
    };
  }

  try {
    const result = await decideLeaveRequest({
      orgId: viewer.orgId,
      requestId: parsed.data.requestId,
      decision: parsed.data.decision,
      comment: parsed.data.comment || null,
      approverEmployeeId: viewer.employeeId,
      decidedByUserId: viewer.userId,
      // HR can act on anything; a supervisor only on what is routed to them
      canApproveAnything: can(viewer, "leave.request.viewAll"),
    });

    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: parsed.data.decision === "approved" ? "approve" : "reject",
      entityType: "leave_request",
      entityId: parsed.data.requestId,
      summary: `${parsed.data.decision === "approved" ? "Approved" : "Rejected"} ${result.reference}`,
      changes: parsed.data.comment ? { comment: { from: null, to: parsed.data.comment } } : undefined,
    });

    // The transaction has committed; let attendance react to it now rather
    // than on the next request. Failures here are recorded against the event,
    // never surfaced as a failed approval.
    drainInBackground(viewer.orgId);

    revalidatePath("/leave/approvals");
    revalidatePath("/leave/register");
    revalidatePath("/leave/my");
    revalidatePath("/dashboard");

    return {
      ok: true,
      message:
        result.finalStatus === "pending"
          ? `${result.reference} moves to the next approval level.`
          : `${result.reference} ${result.finalStatus}.`,
    };
  } catch (error) {
    if (error instanceof LeaveError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function withdrawLeave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requirePermission("leave.request.viewOwn");
  const requestId = String(formData.get("requestId") ?? "");
  if (!z.uuid().safeParse(requestId).success) {
    return { ok: false, message: "That request could not be read." };
  }

  try {
    const reference = await cancelLeaveRequest({
      orgId: viewer.orgId,
      requestId,
      employeeId: viewer.employeeId,
      reason: String(formData.get("reason") ?? "") || null,
      force: can(viewer, "leave.balance.manage"),
    });

    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: "cancel",
      entityType: "leave_request",
      entityId: requestId,
      summary: `Withdrew ${reference}`,
    });

    // The transaction has committed; let attendance react to it now rather
    // than on the next request. Failures here are recorded against the event,
    // never surfaced as a failed approval.
    drainInBackground(viewer.orgId);

    revalidatePath("/leave/my");
    revalidatePath("/leave/approvals");
    revalidatePath("/dashboard");
    return { ok: true, message: `${reference} withdrawn. The days are back on your balance.` };
  } catch (error) {
    if (error instanceof LeaveError) return { ok: false, message: error.message };
    throw error;
  }
}
