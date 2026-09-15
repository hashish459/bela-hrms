"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { auditLog } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";

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

export const employeeSchema = z.object({
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
  mobile: optionalText,
  district: optionalText,
  permanentAddress: optionalText,
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
  confirmationDate: optionalDate,
  separationDate: optionalDate,
  panNumber: optionalText,
  ssfNumber: optionalText,
  pfNumber: optionalText,
  bankName: optionalText,
  bankAccountNumber: optionalText,
  basicSalary: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
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

  const data = parsed.data;

  // Employee codes are the human key people quote in email and on paper; a
  // duplicate is a data-quality bug that is painful to unpick later.
  const clash = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.orgId, viewer.orgId),
        eq(employees.employeeCode, data.employeeCode),
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
      .where(and(eq(employees.id, employeeId), eq(employees.orgId, viewer.orgId)))
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

    revalidatePath("/hr/employees");
    revalidatePath(`/hr/employees/${employeeId}`);
    return { ok: true, message: "Changes saved.", employeeId };
  }

  const [created] = await db.insert(employees).values(values).returning({ id: employees.id });

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
