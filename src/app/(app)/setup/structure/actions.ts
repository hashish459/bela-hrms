"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { drainInBackground } from "@/kernel/events";
import {
  StructureError,
  createUnit,
  deactivateUnit,
  updateUnit,
  type GenericKind,
} from "@/modules/org/structure";

export type ActionState = { ok?: string; error?: string; field?: string };

const KINDS = [
  "division",
  "business_unit",
  "sub_business_unit",
  "functional_category",
  "project",
  "location",
] as const;

const unitSchema = z.object({
  kind: z.enum(KINDS),
  code: z.string().trim().min(1, "A code is required.").max(30),
  name: z.string().trim().min(1, "A name is required.").max(160),
  nameNepali: z.string().trim().max(160).optional().nullable(),
  parentId: z.string().uuid().nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  country: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(80).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  remarks: z.string().trim().max(500).nullable().optional(),
});

/** Empty strings from a form are absent values, not empty values. */
function blankToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

function parse(formData: FormData) {
  return unitSchema.safeParse({
    kind: formData.get("kind"),
    code: formData.get("code"),
    name: formData.get("name"),
    nameNepali: blankToNull(formData.get("nameNepali")),
    parentId: blankToNull(formData.get("parentId")),
    startDate: blankToNull(formData.get("startDate")),
    endDate: blankToNull(formData.get("endDate")),
    country: blankToNull(formData.get("country")),
    state: blankToNull(formData.get("state")),
    sortOrder: formData.get("sortOrder") ?? 0,
    remarks: blankToNull(formData.get("remarks")),
  });
}

export async function saveUnit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requirePermission("setup.structure.manage");
  const parsed = parse(formData);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first.message, field: String(first.path[0] ?? "") };
  }

  const id = blankToNull(formData.get("id"));
  const input = { ...parsed.data, orgId: viewer.orgId, kind: parsed.data.kind as GenericKind };

  try {
    if (id) {
      await updateUnit(id, input);
    } else {
      await createUnit(input);
    }
  } catch (error) {
    if (error instanceof StructureError) return { error: error.message, field: "parentId" };
    // A duplicate code is a user error, not a server error — the unique index is
    // the authority, so this is caught rather than pre-checked.
    if (error instanceof Error && error.message.includes("org_units_org_kind_code_key")) {
      return { error: "That code is already used for this kind.", field: "code" };
    }
    throw error;
  }

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: id ? "update" : "create",
    entityType: "org_unit",
    entityId: id ?? null,
    summary: `${id ? "Updated" : "Added"} ${parsed.data.kind.replace(/_/g, " ")} ${parsed.data.code}`,
  });

  drainInBackground(viewer.orgId);
  revalidatePath(`/setup/structure/${blankToNull(formData.get("slug")) ?? ""}`);
  return { ok: id ? "Saved." : `Added ${parsed.data.name}.` };
}

export async function retireUnit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requirePermission("setup.structure.manage");
  const id = String(formData.get("id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!id) return { error: "Nothing selected." };

  try {
    await deactivateUnit(viewer.orgId, id);
  } catch (error) {
    if (error instanceof StructureError) return { error: error.message };
    throw error;
  }

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "org_unit",
    entityId: id,
    summary: `Deactivated ${kind.replace(/_/g, " ")}`,
  });

  drainInBackground(viewer.orgId);
  revalidatePath(`/setup/structure/${blankToNull(formData.get("slug")) ?? ""}`);
  return { ok: "Deactivated." };
}
