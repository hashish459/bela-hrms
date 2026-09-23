"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { can, requirePermission } from "@/lib/session";
import { drainInBackground } from "@/kernel/events";
import { cacheTags, invalidate } from "@/kernel/cache";
import { cancelMovement, MOVEMENT_LABEL, MovementError, recordMovement } from "@/modules/people/movements";

export type MovementState = { ok?: string; error?: string; fieldErrors?: Record<string, string>; at?: number };

// The drawer only renders the fields a kind is about, so most arrive absent.
const optionalId = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v))
  .nullable()
  .refine((v) => v === null || z.uuid().safeParse(v).success, "Not a valid selection");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters`)
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v))
    .nullable();

const schema = z.object({
  employeeId: z.uuid("Choose the employee"),
  kind: z.enum(["transfer", "promotion", "demotion", "redesignation", "salary_revision", "supervisor_change"]),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the effective date"),
  toBranchId: optionalId,
  toDepartmentId: optionalId,
  toDesignationId: optionalId,
  toGradeId: optionalId,
  toSupervisorId: optionalId,
  toBasicSalary: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v))
    .nullable()
    .refine((v) => v === null || /^\d+(\.\d{1,2})?$/.test(v), "Amount must be a number"),
  reason: optionalText(500),
  letterNumber: optionalText(60),
});

export async function recordMovementAction(_prev: MovementState, formData: FormData): Promise<MovementState> {
  const viewer = await requirePermission("hr.employee.update");
  const raw = Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === "string"));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { error: "Please correct the highlighted fields.", fieldErrors };
  }
  const input = parsed.data;
  // a salary change needs the salary permission, whatever the form sent
  if (!can(viewer, "hr.employee.viewSalary")) input.toBasicSalary = null;

  try {
    const result = await recordMovement(viewer.orgId, input, { userId: viewer.userId, label: viewer.name });
    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: "create",
      entityType: "employee_movement",
      entityId: result.id,
      summary: `${MOVEMENT_LABEL[input.kind]} ${result.reference} recorded${result.applied ? " and applied" : " for a future date"}`,
    });
    invalidate(cacheTags.people(viewer.orgId));
    drainInBackground(viewer.orgId);
    revalidatePath("/hr/transfers");
    revalidatePath(`/hr/employees/${input.employeeId}`);
    return {
      ok: result.applied
        ? `${result.reference} recorded and applied to the record.`
        : `${result.reference} scheduled — it applies on its effective date.`,
      at: Date.now(),
    };
  } catch (error) {
    if (error instanceof MovementError) {
      return { error: error.message, fieldErrors: error.field ? { [error.field]: error.message } : undefined };
    }
    throw error;
  }
}

export async function cancelMovementAction(_prev: MovementState, formData: FormData): Promise<MovementState> {
  const viewer = await requirePermission("hr.employee.update");
  const id = String(formData.get("id") ?? "");
  if (!z.uuid().safeParse(id).success) return { error: "Unknown movement." };
  const reason = String(formData.get("reason") ?? "").trim() || null;
  try {
    const reference = await cancelMovement(viewer.orgId, id, reason);
    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: "cancel",
      entityType: "employee_movement",
      entityId: id,
      summary: `Cancelled ${reference}${reason ? ` — ${reason}` : ""}`,
    });
    revalidatePath("/hr/transfers");
    return { ok: `${reference} cancelled.`, at: Date.now() };
  } catch (error) {
    if (error instanceof MovementError) return { error: error.message };
    throw error;
  }
}
