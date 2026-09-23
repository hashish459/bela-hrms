"use server";

import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { branches } from "@/db/schema/org";
import { employees } from "@/db/schema/hr";
import { attendanceDevices, deviceEnrolments, devicePunches } from "@/db/schema/devices";
import { requirePermission } from "@/lib/session";
import { applyPunches, resolveUnmatched } from "@/modules/attendance/devices";
import { DEVICE_KINDS, CONNECTIONS, DIRECTIONS, DEVICE_STATUSES } from "./options";

/**
 * Writes for the device register.
 *
 * Everything here is gated on `attendance.device.manage` and scoped to the
 * viewer's organisation — a device id from a URL is never enough on its own.
 */

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

const deviceSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Give the device a code")
    .max(24, "Keep the code under 24 characters")
    .regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, dot, dash and underscore only"),
  name: z.string().trim().min(1, "Give the device a name").max(120, "Keep the name shorter"),
  branchId: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || z.uuid().safeParse(v).success, "Not a valid branch"),
  location: optionalText,
  kind: z.enum(DEVICE_KINDS),
  connection: z.enum(CONNECTIONS),
  direction: z.enum(DIRECTIONS),
  status: z.enum(DEVICE_STATUSES),
  vendor: optionalText,
  model: optionalText,
  serialNumber: optionalText,
  ipAddress: optionalText.refine(
    // Postgres `inet` rejects anything malformed with a 500 rather than a
    // field error, so the shape is checked before it gets there.
    (v) => v === null || /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/.test(v),
    "Enter a valid IPv4 or IPv6 address",
  ),
  port: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .nullable()
    .refine((v) => v === null || (Number.isInteger(v) && v > 0 && v < 65536), "Port 1–65535"),
  syncIntervalMinutes: z
    .string()
    .trim()
    .transform((v) => (v === "" ? 15 : Number(v)))
    .refine((v) => Number.isInteger(v) && v >= 1 && v <= 1440, "Between 1 and 1440 minutes"),
  notes: optionalText,
});

export type DeviceFormState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  deviceId?: string;
};

function readForm(formData: FormData) {
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") raw[k] = v;
  return raw;
}

export async function saveDevice(
  deviceId: string | null,
  _prev: DeviceFormState,
  formData: FormData,
): Promise<DeviceFormState> {
  const viewer = await requirePermission("attendance.device.manage");
  const raw = readForm(formData);

  const parsed = deviceSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".")] ??= i.message;
    return { ok: false, message: "Please correct the highlighted fields.", fieldErrors, values: raw };
  }
  const data = parsed.data;

  const clash = await db
    .select({ id: attendanceDevices.id })
    .from(attendanceDevices)
    .where(
      and(
        eq(attendanceDevices.orgId, viewer.orgId),
        eq(attendanceDevices.code, data.code),
        deviceId ? ne(attendanceDevices.id, deviceId) : undefined,
      ),
    )
    .limit(1);

  if (clash.length) {
    return {
      ok: false,
      message: "That device code is already in use.",
      fieldErrors: { code: "Already used by another device" },
      values: raw,
    };
  }

  if (data.branchId) {
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, data.branchId), eq(branches.orgId, viewer.orgId)))
      .limit(1);
    if (!branch) {
      return { ok: false, message: "That branch is not in this organisation.", values: raw };
    }
  }

  const values = { ...data, orgId: viewer.orgId, updatedAt: new Date() };

  if (deviceId) {
    const [before] = await db
      .select({ id: attendanceDevices.id })
      .from(attendanceDevices)
      .where(and(eq(attendanceDevices.id, deviceId), eq(attendanceDevices.orgId, viewer.orgId)))
      .limit(1);
    if (!before) return { ok: false, message: "That device no longer exists.", values: raw };

    await db.update(attendanceDevices).set(values).where(eq(attendanceDevices.id, deviceId));

    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: "update",
      entityType: "attendance_device",
      entityId: deviceId,
      summary: `Updated device ${data.code} — ${data.name}`,
    });

    revalidatePath("/attendance/devices");
    revalidatePath(`/attendance/devices/${deviceId}`);
    return { ok: true, message: "Device saved.", deviceId };
  }

  const [created] = await db
    .insert(attendanceDevices)
    .values(values)
    .returning({ id: attendanceDevices.id });

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "create",
    entityType: "attendance_device",
    entityId: created.id,
    summary: `Added device ${data.code} — ${data.name}`,
  });

  revalidatePath("/attendance/devices");
  return { ok: true, message: "Device added.", deviceId: created.id };
}

export type ActionState = { ok: boolean; message?: string };

export async function deleteDevice(deviceId: string): Promise<ActionState> {
  const viewer = await requirePermission("attendance.device.manage");

  const [device] = await db
    .select({ id: attendanceDevices.id, code: attendanceDevices.code })
    .from(attendanceDevices)
    .where(and(eq(attendanceDevices.id, deviceId), eq(attendanceDevices.orgId, viewer.orgId)))
    .limit(1);
  if (!device) return { ok: false, message: "That device no longer exists." };

  // The punch log cascades with the device, and that is the point of the
  // confirmation the UI puts in front of this: those readings are the evidence
  // behind attendance days that will outlive the hardware.
  await db.delete(attendanceDevices).where(eq(attendanceDevices.id, deviceId));

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "delete",
    entityType: "attendance_device",
    entityId: deviceId,
    summary: `Removed device ${device.code} and its punch log`,
  });

  revalidatePath("/attendance/devices");
  return { ok: true, message: `Device ${device.code} removed.` };
}

/**
 * Issue a push token for a `cloud_api` device.
 *
 * The token is returned **once**. Only its SHA-256 is stored, for the same
 * reason a password is hashed: a leaked database should not hand somebody the
 * ability to post fabricated attendance for the whole organisation.
 */
export async function issueDeviceToken(
  deviceId: string,
): Promise<ActionState & { token?: string }> {
  const viewer = await requirePermission("attendance.device.manage");

  const [device] = await db
    .select({ id: attendanceDevices.id, code: attendanceDevices.code })
    .from(attendanceDevices)
    .where(and(eq(attendanceDevices.id, deviceId), eq(attendanceDevices.orgId, viewer.orgId)))
    .limit(1);
  if (!device) return { ok: false, message: "That device no longer exists." };

  const token = `dev_${randomBytes(24).toString("base64url")}`;

  await db
    .update(attendanceDevices)
    .set({
      apiKeyHash: createHash("sha256").update(token).digest("hex"),
      apiKeyPrefix: token.slice(0, 12),
      apiKeyIssuedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(attendanceDevices.id, deviceId));

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "attendance_device",
    entityId: deviceId,
    // The token itself never reaches the audit log.
    summary: `Issued a new push token for device ${device.code}`,
  });

  revalidatePath(`/attendance/devices/${deviceId}`);
  return { ok: true, message: "Token issued. Copy it now — it is not shown again.", token };
}

export async function revokeDeviceToken(deviceId: string): Promise<ActionState> {
  const viewer = await requirePermission("attendance.device.manage");

  const [device] = await db
    .select({ id: attendanceDevices.id, code: attendanceDevices.code })
    .from(attendanceDevices)
    .where(and(eq(attendanceDevices.id, deviceId), eq(attendanceDevices.orgId, viewer.orgId)))
    .limit(1);
  if (!device) return { ok: false, message: "That device no longer exists." };

  await db
    .update(attendanceDevices)
    .set({ apiKeyHash: null, apiKeyPrefix: null, apiKeyIssuedAt: null, updatedAt: new Date() })
    .where(eq(attendanceDevices.id, deviceId));

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "attendance_device",
    entityId: deviceId,
    summary: `Revoked the push token for device ${device.code}`,
  });

  revalidatePath(`/attendance/devices/${deviceId}`);
  return { ok: true, message: "Token revoked. The device can no longer post." };
}

/* -------------------------------------------------------------- enrolments */

const enrolmentSchema = z.object({
  employeeId: z.uuid("Choose an employee"),
  enrollNumber: z
    .string()
    .trim()
    .min(1, "Enter the number the device knows them by")
    .max(32, "That is longer than any reader uses"),
});

export async function enrolEmployee(
  deviceId: string,
  _prev: DeviceFormState,
  formData: FormData,
): Promise<DeviceFormState> {
  const viewer = await requirePermission("attendance.device.manage");
  const raw = readForm(formData);

  const parsed = enrolmentSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".")] ??= i.message;
    return { ok: false, message: "Please correct the highlighted fields.", fieldErrors, values: raw };
  }
  const data = parsed.data;

  const [device] = await db
    .select({ id: attendanceDevices.id, code: attendanceDevices.code })
    .from(attendanceDevices)
    .where(and(eq(attendanceDevices.id, deviceId), eq(attendanceDevices.orgId, viewer.orgId)))
    .limit(1);
  if (!device) return { ok: false, message: "That device no longer exists.", values: raw };

  const [employee] = await db
    .select({ id: employees.id, code: employees.employeeCode })
    .from(employees)
    .where(and(eq(employees.id, data.employeeId), eq(employees.orgId, viewer.orgId)))
    .limit(1);
  if (!employee) {
    return { ok: false, message: "That employee is not in this organisation.", values: raw };
  }

  const clash = await db
    .select({ id: deviceEnrolments.id, employeeId: deviceEnrolments.employeeId })
    .from(deviceEnrolments)
    .where(
      and(eq(deviceEnrolments.deviceId, deviceId), eq(deviceEnrolments.enrollNumber, data.enrollNumber)),
    )
    .limit(1);

  if (clash.length) {
    return {
      ok: false,
      message: "Another employee already holds that number on this device.",
      fieldErrors: { enrollNumber: "Already enrolled on this device" },
      values: raw,
    };
  }

  const already = await db
    .select({ id: deviceEnrolments.id })
    .from(deviceEnrolments)
    .where(
      and(eq(deviceEnrolments.deviceId, deviceId), eq(deviceEnrolments.employeeId, data.employeeId)),
    )
    .limit(1);

  if (already.length) {
    return {
      ok: false,
      message: `${employee.code} is already enrolled on this device. Remove the existing enrolment first.`,
      values: raw,
    };
  }

  await db.insert(deviceEnrolments).values({
    orgId: viewer.orgId,
    deviceId,
    employeeId: data.employeeId,
    enrollNumber: data.enrollNumber,
  });

  /*
   * Punches already on file from that number now have an owner. Those are
   * usually exactly the days the employee is asking about, so re-resolving them
   * here saves somebody discovering later that their first week is missing.
   */
  const rescued = await resolveUnmatched(viewer.orgId, deviceId);
  if (rescued > 0) await applyPunches(viewer.orgId, { deviceId });

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "create",
    entityType: "attendance_device",
    entityId: deviceId,
    summary: `Enrolled ${employee.code} as #${data.enrollNumber} on ${device.code}`,
  });

  revalidatePath(`/attendance/devices/${deviceId}`);
  revalidatePath("/attendance/devices");
  return {
    ok: true,
    message:
      rescued > 0
        ? `Enrolled. ${rescued} earlier punch${rescued === 1 ? "" : "es"} from that number now belong to them.`
        : "Enrolled.",
  };
}

export async function removeEnrolment(enrolmentId: string): Promise<ActionState> {
  const viewer = await requirePermission("attendance.device.manage");

  const [row] = await db
    .select({
      id: deviceEnrolments.id,
      deviceId: deviceEnrolments.deviceId,
      enrollNumber: deviceEnrolments.enrollNumber,
      employeeCode: employees.employeeCode,
    })
    .from(deviceEnrolments)
    .innerJoin(employees, eq(employees.id, deviceEnrolments.employeeId))
    .where(and(eq(deviceEnrolments.id, enrolmentId), eq(deviceEnrolments.orgId, viewer.orgId)))
    .limit(1);
  if (!row) return { ok: false, message: "That enrolment no longer exists." };

  await db.delete(deviceEnrolments).where(eq(deviceEnrolments.id, enrolmentId));

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "delete",
    entityType: "attendance_device",
    entityId: row.deviceId,
    summary: `Removed the enrolment of ${row.employeeCode} (#${row.enrollNumber})`,
  });

  revalidatePath(`/attendance/devices/${row.deviceId}`);
  return {
    ok: true,
    // Past punches keep their resolved employee: they were correct when made.
    message: "Enrolment removed. Punches already applied are unaffected.",
  };
}

/* -------------------------------------------------------------------- sync */

export type SyncState = ActionState & {
  detail?: { daysWritten: number; daysSkipped: number; unmatched: number; reasons: string[] };
};

/**
 * Process everything received and not yet folded into attendance.
 *
 * This does **not** reach out and poll the hardware. A reader on a factory LAN
 * is not addressable from the application server, and pretending otherwise
 * would be a button that silently does nothing. Readings arrive by being
 * posted to the ingest endpoint — by the device itself, or by a small agent on
 * the site network that polls it — and this is the step that turns them into
 * attendance days.
 */
export async function runSync(deviceId?: string): Promise<SyncState> {
  const viewer = await requirePermission("attendance.device.manage");

  try {
    const rescued = await resolveUnmatched(viewer.orgId, deviceId);
    const result = await applyPunches(viewer.orgId, { deviceId });

    if (deviceId) {
      await db
        .update(attendanceDevices)
        .set({ lastSyncAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(and(eq(attendanceDevices.id, deviceId), eq(attendanceDevices.orgId, viewer.orgId)));
    } else {
      await db
        .update(attendanceDevices)
        .set({ lastSyncAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(attendanceDevices.orgId, viewer.orgId));
    }

    revalidatePath("/attendance/devices");
    if (deviceId) revalidatePath(`/attendance/devices/${deviceId}`);
    revalidatePath("/attendance/register");
    revalidatePath("/attendance/monthly");

    const parts: string[] = [];
    if (result.daysWritten) parts.push(`${result.daysWritten} day${result.daysWritten === 1 ? "" : "s"} written`);
    if (rescued) parts.push(`${rescued} punch${rescued === 1 ? "" : "es"} matched to an employee`);
    if (result.daysSkipped) parts.push(`${result.daysSkipped} left alone`);
    if (result.punchesConsidered === 0 && rescued === 0) parts.push("nothing new to process");

    return {
      ok: true,
      message: parts.join(", ") + ".",
      detail: {
        daysWritten: result.daysWritten,
        daysSkipped: result.daysSkipped,
        unmatched: result.unmatched,
        reasons: result.skippedReasons,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The sync failed.";
    if (deviceId) {
      await db
        .update(attendanceDevices)
        .set({ lastError: message, updatedAt: new Date() })
        .where(and(eq(attendanceDevices.id, deviceId), eq(attendanceDevices.orgId, viewer.orgId)));
      revalidatePath(`/attendance/devices/${deviceId}`);
    }
    return { ok: false, message };
  }
}

/** Discard a punch that will never resolve — a test reading, a visitor's finger. */
export async function ignorePunch(punchId: string): Promise<ActionState> {
  const viewer = await requirePermission("attendance.device.manage");

  const [punch] = await db
    .select({ id: devicePunches.id, deviceId: devicePunches.deviceId })
    .from(devicePunches)
    .where(and(eq(devicePunches.id, punchId), eq(devicePunches.orgId, viewer.orgId)))
    .limit(1);
  if (!punch) return { ok: false, message: "That punch no longer exists." };

  await db
    .update(devicePunches)
    .set({
      status: "skipped",
      processedAt: new Date(),
      note: `Dismissed by ${viewer.name}`,
    })
    .where(eq(devicePunches.id, punchId));

  revalidatePath(`/attendance/devices/${punch.deviceId}`);
  revalidatePath("/attendance/devices");
  return { ok: true, message: "Punch dismissed." };
}
