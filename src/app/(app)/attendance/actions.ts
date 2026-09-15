"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { shiftAssignments, shifts } from "@/db/schema/attendance";
import { can, requirePermission } from "@/lib/session";
import {
  AttendanceError,
  REQUEST_TYPE_LABEL,
  decideAttendanceRequest,
  submitAttendanceRequest,
} from "@/lib/attendance";

export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[issue.path.join(".") || "form"] ??= issue.message;
  return out;
}

const optionalTime = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || /^\d{2}:\d{2}(:\d{2})?$/.test(v), "Use HH:MM");

/* ------------------------------------------------------------- requests */

const requestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  requestType: z.enum([
    "missing_punch",
    "wrong_time",
    "late_excuse",
    "early_exit",
    "on_duty",
    "overtime",
  ]),
  requestedCheckIn: optionalTime,
  requestedCheckOut: optionalTime,
  reason: z.string().trim().min(5, "Give a short reason (at least 5 characters)").max(500),
});

export async function raiseAttendanceRequest(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const viewer = await requirePermission("attendance.request.create");
  if (!viewer.employeeId) {
    return {
      ok: false,
      message: "Your login is not linked to an employee record, so it cannot raise a correction.",
    };
  }

  const parsed = requestSchema.safeParse({
    date: formData.get("date"),
    requestType: formData.get("requestType"),
    requestedCheckIn: formData.get("requestedCheckIn") ?? "",
    requestedCheckOut: formData.get("requestedCheckOut") ?? "",
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }

  try {
    const request = await submitAttendanceRequest({
      orgId: viewer.orgId,
      employeeId: viewer.employeeId,
      ...parsed.data,
    });

    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: "create",
      entityType: "attendance_request",
      entityId: request.id,
      summary: `Raised ${REQUEST_TYPE_LABEL[parsed.data.requestType]} for ${parsed.data.date} (${request.reference})`,
    });

    revalidatePath("/attendance/requests");
    revalidatePath("/attendance/my");
    revalidatePath("/attendance/approvals");
    return { ok: true, message: `Submitted as ${request.reference}. It is now with your supervisor.` };
  } catch (error) {
    if (error instanceof AttendanceError) {
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

export async function decideAttendance(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const viewer = await requirePermission("attendance.request.approve");

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
    const result = await decideAttendanceRequest({
      orgId: viewer.orgId,
      requestId: parsed.data.requestId,
      decision: parsed.data.decision,
      comment: parsed.data.comment || null,
      approverEmployeeId: viewer.employeeId,
      decidedByUserId: viewer.userId,
      canApproveAnything: can(viewer, "attendance.record.viewAll"),
    });

    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: parsed.data.decision === "approved" ? "approve" : "reject",
      entityType: "attendance_request",
      entityId: parsed.data.requestId,
      summary: `${parsed.data.decision === "approved" ? "Approved" : "Rejected"} ${result.reference}`,
    });

    revalidatePath("/attendance/approvals");
    revalidatePath("/attendance/register");
    revalidatePath("/attendance/monthly");
    revalidatePath("/attendance/my");

    return {
      ok: true,
      message:
        result.finalStatus === "approved"
          ? `${result.reference} approved — the day has been recalculated.`
          : `${result.reference} ${result.finalStatus}.`,
    };
  } catch (error) {
    if (error instanceof AttendanceError) return { ok: false, message: error.message };
    throw error;
  }
}

/* --------------------------------------------------------------- shifts */

const timeField = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");

const shiftSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(12, "Keep the code short")
    .regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, dash and underscore only"),
  name: z.string().trim().min(1, "Name is required"),
  nameNepali: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  startTime: timeField,
  endTime: timeField,
  breakMinutes: z.coerce.number().int().min(0).max(240),
  graceInMinutes: z.coerce.number().int().min(0).max(120),
  graceOutMinutes: z.coerce.number().int().min(0).max(120),
  fullDayMinutes: z.coerce.number().int().min(60).max(1440),
  halfDayMinutes: z.coerce.number().int().min(30).max(1440),
  otAfterMinutes: z.coerce.number().int().min(0).max(240),
  isNightShift: z.coerce.boolean(),
  isDefault: z.coerce.boolean(),
  isActive: z.coerce.boolean(),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
});

export async function saveShift(
  shiftId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const viewer = await requirePermission("attendance.shift.manage");

  const raw = Object.fromEntries(formData.entries());
  const parsed = shiftSchema.safeParse({
    ...raw,
    isNightShift: formData.get("isNightShift") === "on",
    isDefault: formData.get("isDefault") === "on",
    isActive: formData.get("isActive") === "on",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }
  const data = parsed.data;

  if (data.halfDayMinutes >= data.fullDayMinutes) {
    return {
      ok: false,
      message: "The half-day threshold must be below the full-day threshold.",
      fieldErrors: { halfDayMinutes: "Must be less than the full-day minutes" },
    };
  }

  const clash = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(
      and(
        eq(shifts.orgId, viewer.orgId),
        eq(shifts.code, data.code),
        shiftId ? ne(shifts.id, shiftId) : undefined,
      ),
    )
    .limit(1);
  if (clash.length) {
    return {
      ok: false,
      message: "That shift code is already in use.",
      fieldErrors: { code: "Already used by another shift" },
    };
  }

  await db.transaction(async (tx) => {
    // only one default, or the roster fallback becomes ambiguous
    if (data.isDefault) {
      await tx
        .update(shifts)
        .set({ isDefault: false })
        .where(and(eq(shifts.orgId, viewer.orgId), shiftId ? ne(shifts.id, shiftId) : undefined));
    }

    if (shiftId) {
      await tx.update(shifts).set(data).where(eq(shifts.id, shiftId));
    } else {
      await tx.insert(shifts).values({ ...data, orgId: viewer.orgId });
    }
  });

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: shiftId ? "update" : "create",
    entityType: "shift",
    entityId: shiftId,
    summary: `${shiftId ? "Updated" : "Created"} shift ${data.code} — ${data.name}`,
  });

  revalidatePath("/attendance/shifts");
  revalidatePath("/attendance/roster");
  return { ok: true, message: shiftId ? "Shift saved." : `Shift ${data.code} created.` };
}

/* --------------------------------------------------------------- roster */

const assignSchema = z.object({
  employeeIds: z.array(z.uuid()).min(1, "Choose at least one employee"),
  shiftId: z.uuid("Choose a shift"),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
  note: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === "" ? null : v))
    .nullable(),
});

export async function assignShift(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requirePermission("attendance.roster.manage");

  const parsed = assignSchema.safeParse({
    employeeIds: formData.getAll("employeeIds").map(String).filter(Boolean),
    shiftId: formData.get("shiftId"),
    effectiveFrom: formData.get("effectiveFrom"),
    note: formData.get("note") ?? "",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }
  const { employeeIds, shiftId, effectiveFrom, note } = parsed.data;

  const [shift] = await db
    .select({ code: shifts.code, name: shifts.name })
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.orgId, viewer.orgId)))
    .limit(1);
  if (!shift) return { ok: false, message: "That shift is not available." };

  await db.transaction(async (tx) => {
    for (const employeeId of employeeIds) {
      // close the open assignment the day before the new one starts, rather than
      // editing it — attendance already computed against the old shift stays explicable
      await tx
        .update(shiftAssignments)
        .set({ effectiveTo: previousDay(effectiveFrom) })
        .where(
          and(
            eq(shiftAssignments.employeeId, employeeId),
            eq(shiftAssignments.orgId, viewer.orgId),
            // only the currently open row; a closed one stays as history
            isNull(shiftAssignments.effectiveTo),
          ),
        );

      await tx.insert(shiftAssignments).values({
        orgId: viewer.orgId,
        employeeId,
        shiftId,
        effectiveFrom,
        note,
        assignedBy: viewer.name,
      });
    }
  });

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "shift_assignment",
    summary: `Assigned ${employeeIds.length} employee(s) to ${shift.code} from ${effectiveFrom}`,
  });

  revalidatePath("/attendance/roster");
  revalidatePath("/attendance/register");
  return {
    ok: true,
    message: `${employeeIds.length} employee(s) moved to ${shift.name} from ${effectiveFrom}.`,
  };
}

function previousDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
