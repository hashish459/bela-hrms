"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { SECTION_BY_KEY, validateSection } from "@/modules/people/profile-fields";
import { deleteEmployee, RecordError, removeRow, saveRow, type RowSection } from "@/modules/people/records";

export type RowState = { ok?: string; error?: string; fieldErrors?: Record<string, string>; at?: number };

const ROW_SECTIONS: RowSection[] = ["family", "qualification", "experience"];

function readSection(formData: FormData): RowSection | null {
  const s = String(formData.get("section") ?? "");
  return (ROW_SECTIONS as string[]).includes(s) ? (s as RowSection) : null;
}

const uuid = z.uuid();

/** Adds or edits a family, qualification or experience row on an employee's file. */
export async function saveRowAction(_prev: RowState, formData: FormData): Promise<RowState> {
  const viewer = await requirePermission("hr.employee.update");
  const section = readSection(formData);
  const employeeId = String(formData.get("employeeId") ?? "");
  const rowId = String(formData.get("rowId") ?? "") || null;
  if (!section || !uuid.safeParse(employeeId).success || (rowId && !uuid.safeParse(rowId).success)) {
    return { error: "That form could not be read." };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = validateSection(section, raw);
  if (!parsed.ok) return { error: "Please correct the highlighted fields.", fieldErrors: parsed.errors };

  try {
    const id = await saveRow(viewer.orgId, employeeId, section, rowId, parsed.values);
    const label = SECTION_BY_KEY.get(section)!.label.toLowerCase();
    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: rowId ? "update" : "create",
      entityType: `employee_${section}`,
      entityId: id,
      summary: `${rowId ? "Updated" : "Added"} ${label} on an employee record`,
    });
  } catch (error) {
    if (error instanceof RecordError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/hr/employees/${employeeId}`);
  return { ok: rowId ? "Saved." : "Added.", at: Date.now() };
}

export async function removeRowAction(_prev: RowState, formData: FormData): Promise<RowState> {
  const viewer = await requirePermission("hr.employee.update");
  const section = readSection(formData);
  const rowId = String(formData.get("rowId") ?? "");
  if (!section || !uuid.safeParse(rowId).success) return { error: "That entry could not be read." };

  try {
    const row = await removeRow(viewer.orgId, section, rowId, viewer.name);
    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: "delete",
      entityType: `employee_${section}`,
      entityId: rowId,
      summary: `Moved a ${SECTION_BY_KEY.get(section)!.label.toLowerCase()} entry to the recycle bin`,
    });
    revalidatePath(`/hr/employees/${row.employeeId}`);
  } catch (error) {
    if (error instanceof RecordError) return { error: error.message };
    throw error;
  }
  return { ok: "Removed. It can be restored from the recycle bin.", at: Date.now() };
}

/**
 * Moves the whole record to the recycle bin. For duplicates and records created
 * in error; somebody leaving is a separation, which keeps them on file.
 */
export async function deleteEmployeeAction(_prev: RowState, formData: FormData): Promise<RowState> {
  const viewer = await requirePermission("hr.employee.separate");
  const employeeId = String(formData.get("employeeId") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!uuid.safeParse(employeeId).success) return { error: "Unknown employee." };

  let result: Awaited<ReturnType<typeof deleteEmployee>>;
  try {
    // the typed employee code is the confirmation; a stray click cannot bin a record
    const expected = String(formData.get("code") ?? "");
    if (!expected || confirm !== expected) return { error: `Type ${expected} to confirm.` };
    result = await deleteEmployee(viewer.orgId, employeeId, viewer.name);
  } catch (error) {
    if (error instanceof RecordError) return { error: error.message };
    throw error;
  }

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "delete",
    entityType: "employee",
    entityId: employeeId,
    summary: `Moved ${result.name} (${result.code}) to the recycle bin${result.loginsClosed ? " and closed their login" : ""}`,
  });

  revalidatePath("/hr/employees");
  redirect("/hr/employees?binned=1");
}
