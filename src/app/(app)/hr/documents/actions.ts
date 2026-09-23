"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { employees } from "@/db/schema/hr";
import { employeeDocuments } from "@/db/schema/selfservice";
import { requirePermission } from "@/lib/session";
import { DOCUMENT_MAX_BYTES, dropIfUnreferenced, putFile } from "@/lib/storage";
import { DOCUMENT_KINDS } from "./kinds";

/**
 * The document register's write side.
 *
 * Two rules run through all of it:
 *
 *   1. Every write re-checks the target employee against the viewer's
 *      organisation. A document id alone is never trusted to imply the right to
 *      touch it, and a valid uuid from another tenant must not file anything.
 *   2. Editing a verified document sends it back to `pending`. A verification is
 *      a statement that somebody checked this scan against the original — if the
 *      scan or the reference number then changes, that statement no longer
 *      refers to anything, and silently keeping the tick is worse than no tick.
 */

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

const documentSchema = z
  .object({
    employeeId: z.uuid("Choose an employee"),
    kind: z.enum(DOCUMENT_KINDS),
    title: z.string().trim().min(1, "Give the document a title").max(160, "Keep the title shorter"),
    referenceNumber: optionalText,
    issuedOn: optionalDate,
    expiresOn: optionalDate,
    isVisibleToEmployee: z
      .union([z.literal("on"), z.literal("")])
      .optional()
      .transform((v) => v === "on"),
  })
  .refine((d) => !d.issuedOn || !d.expiresOn || d.issuedOn <= d.expiresOn, {
    message: "The expiry date cannot be before the issue date",
    path: ["expiresOn"],
  });

export type DocumentFormState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /**
   * The submitted text fields, echoed back so a rejected form redisplays what
   * was typed. The attachment cannot be echoed — a File does not survive the
   * round trip — so the form says so rather than pretending it is still there.
   */
  values?: Record<string, string>;
};

export async function saveDocument(
  documentId: string | null,
  _prev: DocumentFormState,
  formData: FormData,
): Promise<DocumentFormState> {
  const viewer = await requirePermission("hr.document.manage");

  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") raw[key] = value;
  }

  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return {
      ok: false,
      message: "Please correct the highlighted fields.",
      fieldErrors,
      values: raw,
    };
  }
  const data = parsed.data;

  const [employee] = await db
    .select({ id: employees.id, code: employees.employeeCode })
    .from(employees)
    .where(and(eq(employees.id, data.employeeId), eq(employees.orgId, viewer.orgId)))
    .limit(1);
  if (!employee) {
    return { ok: false, message: "That employee is not in this organisation.", values: raw };
  }

  const upload = formData.get("file");
  let fileId: string | null = null;
  let replacedFileId: string | null = null;

  if (upload instanceof File && upload.size > 0) {
    const stored = await putFile({
      orgId: viewer.orgId,
      uploadedBy: viewer.userId,
      file: upload,
      maxBytes: DOCUMENT_MAX_BYTES,
    });
    if (!stored.ok) {
      return { ok: false, message: stored.error, fieldErrors: { file: stored.error }, values: raw };
    }
    fileId = stored.file.id;
  }

  if (documentId) {
    const [before] = await db
      .select()
      .from(employeeDocuments)
      .where(and(eq(employeeDocuments.id, documentId), eq(employeeDocuments.orgId, viewer.orgId)))
      .limit(1);
    if (!before) return { ok: false, message: "That document no longer exists.", values: raw };

    if (fileId && before.fileId && before.fileId !== fileId) replacedFileId = before.fileId;

    await db
      .update(employeeDocuments)
      .set({
        employeeId: data.employeeId,
        kind: data.kind,
        title: data.title,
        referenceNumber: data.referenceNumber,
        issuedOn: data.issuedOn,
        expiresOn: data.expiresOn,
        isVisibleToEmployee: data.isVisibleToEmployee,
        // An edit invalidates the previous verification — see the note above.
        ...(before.status === "verified"
          ? { status: "pending" as const, reviewedBy: null, reviewedAt: null, reviewNote: null }
          : {}),
        ...(fileId ? { fileId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(employeeDocuments.id, documentId));

    await dropIfUnreferenced(replacedFileId);

    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: "update",
      entityType: "employee_document",
      entityId: documentId,
      summary: `Updated ${data.title} on ${employee.code}`,
    });
  } else {
    const [created] = await db
      .insert(employeeDocuments)
      .values({
        orgId: viewer.orgId,
        employeeId: data.employeeId,
        kind: data.kind,
        title: data.title,
        fileId,
        referenceNumber: data.referenceNumber,
        issuedOn: data.issuedOn,
        expiresOn: data.expiresOn,
        isVisibleToEmployee: data.isVisibleToEmployee,
        uploadedBy: viewer.name,
      })
      .returning({ id: employeeDocuments.id });

    await db.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: "create",
      entityType: "employee_document",
      entityId: created.id,
      summary: `Filed ${data.title} against ${employee.code}`,
    });
  }

  revalidatePath("/hr/documents");
  revalidatePath(`/hr/employees/${data.employeeId}`);
  revalidatePath("/me/profile");
  return { ok: true, message: documentId ? "Document updated." : "Document filed." };
}

/**
 * Verify or reject.
 *
 * A rejection needs a note. "No" with no reason leaves the employee unable to
 * fix whatever was wrong, which turns one rejected upload into three.
 */
export async function reviewDocument(
  documentId: string,
  outcome: "verified" | "rejected",
  note: string,
): Promise<DocumentFormState> {
  const viewer = await requirePermission("hr.document.manage");

  const trimmed = note.trim();
  if (outcome === "rejected" && trimmed === "") {
    return { ok: false, message: "Say why it was rejected." };
  }

  const [doc] = await db
    .select({
      id: employeeDocuments.id,
      employeeId: employeeDocuments.employeeId,
      title: employeeDocuments.title,
    })
    .from(employeeDocuments)
    .where(and(eq(employeeDocuments.id, documentId), eq(employeeDocuments.orgId, viewer.orgId)))
    .limit(1);
  if (!doc) return { ok: false, message: "That document no longer exists." };

  await db
    .update(employeeDocuments)
    .set({
      status: outcome,
      reviewedBy: viewer.name,
      reviewedAt: new Date(),
      reviewNote: trimmed || null,
      updatedAt: new Date(),
    })
    .where(eq(employeeDocuments.id, documentId));

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "employee_document",
    entityId: documentId,
    summary: `${outcome === "verified" ? "Verified" : "Rejected"} ${doc.title}`,
  });

  revalidatePath("/hr/documents");
  revalidatePath(`/hr/employees/${doc.employeeId}`);
  revalidatePath("/me/profile");
  return {
    ok: true,
    message: outcome === "verified" ? "Marked as verified." : "Marked as rejected.",
  };
}

export async function deleteDocument(documentId: string): Promise<DocumentFormState> {
  const viewer = await requirePermission("hr.document.manage");

  const [doc] = await db
    .select()
    .from(employeeDocuments)
    .where(and(eq(employeeDocuments.id, documentId), eq(employeeDocuments.orgId, viewer.orgId)))
    .limit(1);
  if (!doc) return { ok: false, message: "That document no longer exists." };

  await db.delete(employeeDocuments).where(eq(employeeDocuments.id, documentId));
  await dropIfUnreferenced(doc.fileId);

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "delete",
    entityType: "employee_document",
    entityId: documentId,
    summary: `Removed ${doc.title}`,
  });

  revalidatePath("/hr/documents");
  revalidatePath(`/hr/employees/${doc.employeeId}`);
  revalidatePath("/me/profile");
  return { ok: true, message: "Document removed." };
}
