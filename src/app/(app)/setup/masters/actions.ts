"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { drainInBackground } from "@/kernel/events";
import { cacheTags, invalidate } from "@/kernel/cache";
import {
  deleteMaster,
  MasterError,
  saveMaster,
  setMasterActive,
  updateOrganisation,
  type MasterInput,
  type MasterKind,
} from "@/modules/org/masters";
import {
  createUnit,
  deleteUnit,
  setUnitActive,
  StructureError,
  updateUnit,
  type GenericKind,
} from "@/modules/org/structure";

/**
 * One set of actions for every master-data screen.
 *
 * The screen says *which* master it is editing; the schema for that kind does
 * the validating, and the org module does the writing. Each action returns a
 * state the editor renders — a field error beside the field, anything else as
 * a banner — and `at`, a timestamp the editor watches to know a save landed.
 */
export type MasterState = {
  ok?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  at?: number;
};

const MASTER_KINDS = ["branch", "department", "designation", "grade", "employment_type"] as const;
const UNIT_KINDS = ["division", "business_unit", "sub_business_unit", "functional_category", "project", "location"] as const;

const code = z
  .string()
  .trim()
  .min(1, "A code is required.")
  .max(20, "Keep codes to 20 characters.")
  .regex(/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/, "Letters, digits and . _ - / only, starting with a letter or digit.");
const name = z.string().trim().min(2, "A name is required.").max(120, "Keep names to 120 characters.");
const optionalText = (max: number) => z.string().trim().max(max, `At most ${max} characters.`).nullable();
const optionalId = z.string().uuid("Choose from the list.").nullable();
const level = z.coerce.number().int("A whole number.").min(1, "1 is the most senior.").max(999, "At most 999.");

const SCHEMAS = {
  branch: z.object({
    code,
    name,
    nameNepali: optionalText(120),
    parentId: optionalId,
    address: optionalText(200),
    district: optionalText(60),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+\-() ]{6,20}$/, "Digits, spaces and + - ( ) only.")
      .nullable(),
    isHeadOffice: z.boolean(),
  }),
  department: z.object({
    code,
    name,
    nameNepali: optionalText(120),
    parentId: optionalId,
    headEmployeeId: optionalId,
  }),
  designation: z.object({ code, name, nameNepali: optionalText(120), hierarchyLevel: level }),
  grade: z.object({
    code,
    name,
    hierarchyLevel: level,
    basicSalary: z
      .string()
      .trim()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, "Rupees, up to two decimal places.")
      .nullable(),
  }),
  employment_type: z.object({ code, name, accruesLeave: z.boolean() }),
} satisfies Record<MasterKind, z.ZodType>;

const unitSchema = z.object({
  code,
  name,
  nameNepali: optionalText(120),
  parentId: optionalId,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date.").nullable(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date.").nullable(),
  country: optionalText(80),
  state: optionalText(80),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  remarks: optionalText(500),
});

/** Empty strings from a form are absent values, not empty values. */
function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

/** Only setup screens may be revalidated from here — never an arbitrary path. */
function revalidate(formData: FormData) {
  const path = String(formData.get("path") ?? "");
  if (/^\/setup\/[a-z0-9\-/]*$/.test(path)) revalidatePath(path);
}

function readKind(formData: FormData): { kind: MasterKind } | { unit: GenericKind } | null {
  const kind = String(formData.get("kind") ?? "");
  if ((MASTER_KINDS as readonly string[]).includes(kind)) return { kind: kind as MasterKind };
  if ((UNIT_KINDS as readonly string[]).includes(kind)) return { unit: kind as GenericKind };
  return null;
}

/** Reads a form into the kind's field set: every key the schema declares. */
function readValues(formData: FormData, schema: z.ZodObject): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    // checkboxes are absent when unticked
    if (field instanceof z.ZodBoolean) out[key] = formData.get(key) === "on";
    else out[key] = text(formData, key);
  }
  return out;
}

function failure(error: unknown): MasterState {
  if (error instanceof MasterError) {
    return error.field ? { fieldErrors: { [error.field]: error.message } } : { error: error.message };
  }
  if (error instanceof StructureError) return { fieldErrors: { parentId: error.message } };
  if (error instanceof Error && error.message.includes("org_units_org_kind_code_key")) {
    return { fieldErrors: { code: "That code is already used for this kind." } };
  }
  throw error;
}

const label = (kind: string) => kind.replace(/_/g, " ");

export async function saveMasterAction(_prev: MasterState, formData: FormData): Promise<MasterState> {
  const viewer = await requirePermission("setup.structure.manage");
  const which = readKind(formData);
  if (!which) return { error: "Unknown record type." };
  const id = text(formData, "id");
  if (id && !z.string().uuid().safeParse(id).success) return { error: "Unknown record." };

  let savedId: string;
  let changes: Record<string, { from: unknown; to: unknown }> = {};
  let summary: string;

  if ("kind" in which) {
    const schema = SCHEMAS[which.kind];
    const parsed = schema.safeParse(readValues(formData, schema));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    try {
      ({ id: savedId, changes } = await saveMaster(viewer.orgId, id, {
        kind: which.kind,
        values: parsed.data,
      } as MasterInput));
    } catch (error) {
      return failure(error);
    }
    summary = `${id ? "Updated" : "Added"} ${label(which.kind)} ${parsed.data.code} · ${parsed.data.name}`;
  } else {
    const parsed = unitSchema.safeParse(readValues(formData, unitSchema));
    if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
    if (parsed.data.startDate && parsed.data.endDate && parsed.data.endDate < parsed.data.startDate) {
      return { fieldErrors: { endDate: "The end date is before the start date." } };
    }
    const input = { ...parsed.data, orgId: viewer.orgId, kind: which.unit };
    try {
      if (id) {
        await updateUnit(id, input);
        savedId = id;
      } else {
        ({ id: savedId } = await createUnit(input));
      }
    } catch (error) {
      return failure(error);
    }
    summary = `${id ? "Updated" : "Added"} ${label(which.unit)} ${parsed.data.code} · ${parsed.data.name}`;
  }

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: id ? "update" : "create",
    entityType: "kind" in which ? which.kind : "org_unit",
    entityId: savedId,
    summary,
    changes: Object.keys(changes).length ? changes : null,
  });

  invalidate(cacheTags.masters(viewer.orgId));
  drainInBackground(viewer.orgId);
  revalidate(formData);
  return { ok: id ? "Saved." : "Added.", at: Date.now() };
}

export async function setActiveAction(_prev: MasterState, formData: FormData): Promise<MasterState> {
  const viewer = await requirePermission("setup.structure.manage");
  const which = readKind(formData);
  const id = text(formData, "id");
  const active = formData.get("active") === "true";
  if (!which || !id || !z.string().uuid().safeParse(id).success) return { error: "Unknown record." };

  try {
    if ("kind" in which) await setMasterActive(viewer.orgId, which.kind, id, active);
    else await setUnitActive(viewer.orgId, id, active);
  } catch (error) {
    if (error instanceof MasterError || error instanceof StructureError) return { error: error.message };
    throw error;
  }

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "kind" in which ? which.kind : "org_unit",
    entityId: id,
    summary: `${active ? "Reactivated" : "Deactivated"} ${label("kind" in which ? which.kind : which.unit)} ${text(formData, "code") ?? ""}`.trim(),
    changes: { isActive: { from: !active, to: active } },
  });

  invalidate(cacheTags.masters(viewer.orgId));
  drainInBackground(viewer.orgId);
  revalidate(formData);
  return { ok: active ? "Reactivated." : "Deactivated.", at: Date.now() };
}

export async function deleteAction(_prev: MasterState, formData: FormData): Promise<MasterState> {
  const viewer = await requirePermission("setup.structure.manage");
  const which = readKind(formData);
  const id = text(formData, "id");
  if (!which || !id || !z.string().uuid().safeParse(id).success) return { error: "Unknown record." };

  try {
    if ("kind" in which) await deleteMaster(viewer.orgId, which.kind, id, viewer.name);
    else await deleteUnit(viewer.orgId, id, viewer.name);
  } catch (error) {
    if (error instanceof MasterError || error instanceof StructureError) return { error: error.message };
    throw error;
  }

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "delete",
    entityType: "kind" in which ? which.kind : "org_unit",
    entityId: id,
    summary: `Moved ${label("kind" in which ? which.kind : which.unit)} ${text(formData, "code") ?? ""} to the recycle bin`.replace(/\s+/g, " "),
  });

  invalidate(cacheTags.masters(viewer.orgId));
  drainInBackground(viewer.orgId);
  revalidate(formData);
  return { ok: "Moved to the recycle bin. Restore it from Administration › Recycle Bin.", at: Date.now() };
}

/* ---------------------------------------------------------- company profile */

const companySchema = z.object({
  name: z.string().trim().min(2, "The legal name is required.").max(160),
  nameNepali: optionalText(160),
  pan: z
    .string()
    .trim()
    .regex(/^\d{9}$/, "A Nepali PAN is exactly nine digits.")
    .nullable(),
  address: optionalText(200),
  district: optionalText(60),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-() ]{6,20}$/, "Digits, spaces and + - ( ) only.")
    .nullable(),
  email: z.string().trim().email("Not an email address.").max(160).nullable(),
  logoUrl: z.string().trim().url("A full https:// address.").max(500).nullable(),
  defaultCalendar: z.enum(["BS", "AD"]),
});

export async function saveCompanyAction(_prev: MasterState, formData: FormData): Promise<MasterState> {
  const viewer = await requirePermission("setup.structure.manage");
  const parsed = companySchema.safeParse(readValues(formData, companySchema));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  await updateOrganisation(viewer.orgId, parsed.data);
  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "organisation",
    entityId: viewer.orgId,
    summary: `Updated the company profile`,
  });

  drainInBackground(viewer.orgId);
  // the name shows in the header of every page
  revalidatePath("/", "layout");
  return { ok: "Company profile saved.", at: Date.now() };
}
