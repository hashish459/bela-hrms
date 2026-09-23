"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { auditLog } from "@/db/schema/core";
import { can, requirePermission } from "@/lib/session";
import { cacheTags, invalidate } from "@/kernel/cache";
import { dropIfUnreferenced, PHOTO_MAX_BYTES, putFile } from "@/lib/storage";

const optionalId = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || z.uuid().safeParse(v).success, "Not a valid selection");

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use the date picker");

/*
 * Not exported. In a `"use server"` file every export is registered as a
 * server-action reference, and a non-function export makes the whole module
 * throw "a use server file can only export async functions" the moment a client
 * component imports anything from it. Nothing outside this file needs the
 * schema, and keeping it local removes the trap.
 */
const employeeSchema = z.object({
  employeeCode: z
    .string()
    .trim()
    .min(1, "Employee code is required")
    .max(24, "Keep the code under 24 characters")
    .regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, dot, dash and underscore only"),
  firstName: z.string().trim().min(1, "First name is required"),
  middleName: optionalText,
  lastName: z.string().trim().min(1, "Last name is required"),
  fullNameNepali: optionalText,
  gender: z.enum(["male", "female", "other"]),
  maritalStatus: z
    .union([z.enum(["single", "married", "divorced", "widowed"]), z.literal("")])
    .transform((v) => (v === "" ? null : v)),
  dateOfBirth: optionalDate,
  workEmail: z
    .union([z.email("Enter a valid email address"), z.literal("")])
    .transform((v) => (v === "" ? null : v)),
  personalEmail: z
    .union([z.email("Enter a valid email address"), z.literal("")])
    .transform((v) => (v === "" ? null : v)),
  mobile: optionalText,
  district: optionalText,
  permanentAddress: optionalText,
  temporaryAddress: optionalText,
  emergencyContactName: optionalText,
  emergencyContactRelation: optionalText,
  emergencyContactPhone: optionalText,
  bloodGroup: optionalText,
  nationality: optionalText,
  religion: optionalText,
  branchId: optionalId,
  departmentId: optionalId,
  designationId: optionalId,
  employmentTypeId: optionalId,
  gradeId: optionalId,
  supervisorId: optionalId,
  status: z.enum([
    "probation",
    "active",
    "on_leave",
    "suspended",
    "resigned",
    "terminated",
    "retired",
  ]),
  dateOfJoin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of join is required"),
  probationEndDate: optionalDate,
  confirmationDate: optionalDate,
  separationDate: optionalDate,
  noticePeriodDays: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .nullable()
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 365), "Days, 0 to 365"),
  panNumber: optionalText,
  citizenshipNumber: optionalText,
  passportNumber: optionalText,
  ssfNumber: optionalText,
  pfNumber: optionalText,
  citNumber: optionalText,
  bankName: optionalText,
  bankBranch: optionalText,
  bankAccountNumber: optionalText,
  // absent from the form entirely for somebody who may not see salaries
  basicSalary: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v))
    .nullable()
    .refine((v) => v === null || /^\d+(\.\d{1,2})?$/.test(v), "Amount must be a number"),
});

export type EmployeeFormState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  employeeId?: string;
};

function readForm(formData: FormData) {
  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") raw[key] = value;
  }
  return raw;
}

export async function saveEmployee(
  employeeId: string | null,
  _prev: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  const viewer = await requirePermission(
    employeeId ? "hr.employee.update" : "hr.employee.create",
  );

  const parsed = employeeSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      fieldErrors[key] ??= issue.message;
    }
    return { ok: false, message: "Please correct the highlighted fields.", fieldErrors };
  }

  const data: Partial<typeof parsed.data> = { ...parsed.data };

  // Salary is written only by somebody allowed to see it. The form omits the
  // field for everybody else, but a crafted request could still send one.
  if (!can(viewer, "hr.employee.viewSalary")) delete data.basicSalary;

  // Employee codes are the human key people quote in email and on paper; a
  // duplicate is a data-quality bug that is painful to unpick later.
  const clash = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.orgId, viewer.orgId),
        eq(employees.employeeCode, data.employeeCode!),
        isNull(employees.deletedAt),
        employeeId ? ne(employees.id, employeeId) : undefined,
      ),
    )
    .limit(1);

  if (clash.length) {
    return {
      ok: false,
      message: "That employee code is already in use.",
      fieldErrors: { employeeCode: "Already used by another employee" },
    };
  }

  if (data.supervisorId && data.supervisorId === employeeId) {
    return {
      ok: false,
      message: "An employee cannot report to themselves.",
      fieldErrors: { supervisorId: "Choose a different supervisor" },
    };
  }

  const values = { ...data, orgId: viewer.orgId, updatedAt: new Date() };

  if (employeeId) {
    const [before] = await db
      .select()
      .from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.orgId, viewer.orgId), isNull(employees.deletedAt)))
      .limit(1);
    if (!before) return { ok: false, message: "That employee no longer exists." };

    await db.update(employees).set(values).where(eq(employees.id, employeeId));

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, next] of Object.entries(data)) {
      const prev = (before as Record<string, unknown>)[key];
      if (String(prev ?? "") !== String(next ?? "")) changes[key] = { from: prev, to: next };
    }

    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: "update",
      entityType: "employee",
      entityId: employeeId,
      summary: `Updated ${data.firstName} ${data.lastName} (${data.employeeCode})`,
      changes,
    });

    invalidate(cacheTags.people(viewer.orgId));
    revalidatePath("/hr/employees");
    revalidatePath(`/hr/employees/${employeeId}`);
    return { ok: true, message: "Changes saved.", employeeId };
  }

  // A photograph chosen on the add form arrives with it. It is stored first, so
  // an image the storage layer rejects stops the save rather than leaving a
  // record created without the photograph somebody thought they attached.
  let photoFileId: string | null = null;
  const photo = formData.get("photo");
  if (photo instanceof File && photo.size > 0) {
    const stored = await putFile({
      orgId: viewer.orgId,
      uploadedBy: viewer.userId,
      file: photo,
      maxBytes: PHOTO_MAX_BYTES,
      allow: ["image/jpeg", "image/png", "image/webp"],
    });
    if (!stored.ok) return { ok: false, message: stored.error, fieldErrors: { photo: stored.error } };
    photoFileId = stored.file.id;
  }

  const [created] = await db
    .insert(employees)
    .values({ ...(values as typeof employees.$inferInsert), photoFileId })
    .returning({ id: employees.id });
  invalidate(cacheTags.people(viewer.orgId));

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "create",
    entityType: "employee",
    entityId: created.id,
    summary: `Added ${data.firstName} ${data.lastName} (${data.employeeCode})`,
  });

  revalidatePath("/hr/employees");
  return { ok: true, message: "Employee added.", employeeId: created.id };
}

/* ------------------------------------------------------------- photographs */

export type PhotoState = { ok: boolean; message?: string };

/**
 * Replace an employee's photograph.
 *
 * The browser downscales before sending (see `photo-upload.tsx`), so what
 * arrives here is already a few tens of kilobytes. The limit below is the
 * backstop for anything that did not come through that form.
 */
export async function uploadEmployeePhoto(
  employeeId: string,
  _prev: PhotoState,
  formData: FormData,
): Promise<PhotoState> {
  const viewer = await requirePermission("hr.employee.update");

  const [employee] = await db
    .select({ id: employees.id, photoFileId: employees.photoFileId, code: employees.employeeCode })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.orgId, viewer.orgId)))
    .limit(1);
  if (!employee) return { ok: false, message: "That employee no longer exists." };

  const upload = formData.get("photo");
  if (!(upload instanceof File)) return { ok: false, message: "Choose an image to upload." };

  const stored = await putFile({
    orgId: viewer.orgId,
    uploadedBy: viewer.userId,
    file: upload,
    maxBytes: PHOTO_MAX_BYTES,
    // A photograph is an image. A PDF passport scan is a document, and belongs
    // on the documents tab where it gets an expiry date and a verification.
    allow: ["image/jpeg", "image/png", "image/webp"],
  });

  if (!stored.ok) return { ok: false, message: stored.error };

  await db
    .update(employees)
    .set({ photoFileId: stored.file.id, updatedAt: new Date() })
    .where(eq(employees.id, employeeId));

  // Only after the new one is committed, and only if nothing else holds it.
  if (employee.photoFileId && employee.photoFileId !== stored.file.id) {
    await dropIfUnreferenced(employee.photoFileId);
  }

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "employee",
    entityId: employeeId,
    summary: `Updated the photograph for ${employee.code}`,
  });

  revalidatePath(`/hr/employees/${employeeId}`);
  revalidatePath("/hr/employees");
  return { ok: true, message: "Photograph updated." };
}

export async function removeEmployeePhoto(employeeId: string): Promise<PhotoState> {
  const viewer = await requirePermission("hr.employee.update");

  const [employee] = await db
    .select({ id: employees.id, photoFileId: employees.photoFileId, code: employees.employeeCode })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.orgId, viewer.orgId)))
    .limit(1);
  if (!employee) return { ok: false, message: "That employee no longer exists." };

  await db
    .update(employees)
    .set({ photoFileId: null, photoUrl: null, updatedAt: new Date() })
    .where(eq(employees.id, employeeId));

  await dropIfUnreferenced(employee.photoFileId);

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "employee",
    entityId: employeeId,
    summary: `Removed the photograph for ${employee.code}`,
  });

  revalidatePath(`/hr/employees/${employeeId}`);
  revalidatePath("/hr/employees");
  return { ok: true, message: "Photograph removed." };
}
