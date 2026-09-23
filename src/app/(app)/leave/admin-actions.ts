"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import {
  adjustBalance,
  balanceDetail,
  previewAllocation,
  deleteLeaveGroup,
  deleteLeaveType,
  duplicateLeaveType,
  encash,
  LeaveAdminError,
  reverseEncashment,
  runAllocation,
  runYearEnd,
  saveEntitlement,
  saveLeaveGroup,
  saveLeaveType,
  setLeaveTypeActive,
  type FieldChanges,
} from "@/modules/leave/admin";

export type AdminState = { ok?: string; error?: string; fieldErrors?: Record<string, string>; at?: number; id?: string };

type Viewer = { orgId: string; userId: string; name: string };

async function audit(v: Viewer, action: "create" | "update" | "delete", entityType: string, entityId: string | null, summary: string, changes?: FieldChanges) {
  await db.insert(auditLog).values({ orgId: v.orgId, actorUserId: v.userId, actorLabel: v.name, action, entityType, entityId, summary, changes: changes && Object.keys(changes).length ? changes : null });
}

function fail(error: unknown): AdminState {
  if (error instanceof LeaveAdminError) return { error: error.message, fieldErrors: error.field ? { [error.field]: error.message } : undefined, at: Date.now() };
  throw error;
}

function zodFail(e: z.ZodError): AdminState {
  const fieldErrors: Record<string, string> = {};
  for (const i of e.issues) fieldErrors[i.path.join(".")] ??= i.message;
  return { error: "Check the highlighted fields.", fieldErrors, at: Date.now() };
}

const uuid = z.uuid("Not a valid selection");

/* ----------------------------------------------------------------- helpers */

const text = (max: number) => z.string().trim().max(max, `At most ${max} characters`);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null);
const num = (min: number, max: number, msg = `Between ${min} and ${max}`) => z.coerce.number({ error: "A number" }).min(min, msg).max(max, msg);
const optNum = (min: number, max: number, msg = `Between ${min} and ${max}`) =>
  z
    .union([z.literal(""), z.coerce.number({ error: "A number" }).min(min, msg).max(max, msg)])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null);
const optInt = (min: number, max: number, msg?: string) => optNum(min, max, msg).refine((v) => v === null || Number.isInteger(v), "A whole number");
const bool = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
const optId = z
  .union([z.literal(""), uuid])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .default(null);

function formObject(fd: FormData) {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") o[k] = v;
  return o;
}

/* -------------------------------------------------------------- leave types */

const leaveTypeSchema = z.object({
  code: text(16).min(1, "A short code, e.g. SICK").regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, dash and underscore"),
  name: text(80).min(2, "Name the leave"),
  nameNepali: optText(80),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
  leaveGroupId: optId,
  nature: z.enum(["official_work", "paid", "unpaid", "absent", "substitute", "holiday", "transit"]),
  paidPercent: num(0, 100),
  unit: z.enum(["day", "half_day", "hour"]).default("day"),
  daysPerYear: num(0, 366),
  deductsBalance: bool,
  allowHalfDay: bool,
  allocationRule: z.enum(["advance", "negative", "matured_only", "no_tracking"]),
  isAllocatedInFull: bool,
  lapseType: z.enum(["none", "monthly", "yearly", "service_period"]),
  allowCarryForward: bool,
  maxCarryForwardDays: optNum(0, 999),
  maxAccumulationDays: optNum(0, 999),
  isEncashable: bool,
  minDaysToEncash: optNum(0, 366),
  maxDaysToEncash: optNum(0, 366),
  appliesTo: z.enum(["all", "male", "female"]),
  maritalStatus: z
    .union([z.literal(""), z.enum(["single", "married", "divorced", "widowed"])])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
  minNoticeDays: num(0, 365).refine(Number.isInteger, "A whole number"),
  maxConsecutiveDays: optInt(1, 366),
  requiresAttachmentAfterDays: optInt(0, 366),
  applyWindow: z.enum(["pre", "post", "any"]),
  qualifyFrom: z.enum(["date_of_join", "date_of_permanent", "contract_start", "probation_start"]),
  minDaysToQualify: optInt(0, 3650),
  timesAllowedInService: optInt(1, 99),
  maxDaysToApply: optInt(1, 3650),
  excludesHolidays: bool,
  excludesWeeklyOffs: bool,
  approvalLevels: num(1, 4).refine(Number.isInteger, "1 to 4"),
  level1LimitDays: optInt(1, 366),
  level2LimitDays: optInt(1, 366),
  level3LimitDays: optInt(1, 366),
  level4LimitDays: optInt(1, 366),
  notifiesHr: bool,
  leaveOrder: num(0, 999).refine(Number.isInteger, "A whole number"),
  isExcessDeductedFromPay: bool,
  isDeductedFromServiceTime: bool,
});

export async function saveLeaveTypeAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  const viewer = await requirePermission("leave.type.manage");
  const id = String(fd.get("id") ?? "") || null;
  if (id && !uuid.safeParse(id).success) return { error: "Unknown leave type.", at: Date.now() };
  const parsed = leaveTypeSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  try {
    const r = await saveLeaveType(viewer.orgId, id, parsed.data);
    await audit(viewer, r.created ? "create" : "update", "leave_type", r.id, `${r.created ? "Created" : "Updated"} leave type ${parsed.data.name} (${parsed.data.code.toUpperCase()})`, r.changes);
    revalidatePath("/leave", "layout");
    return { ok: r.created ? `${parsed.data.name} created.` : `${parsed.data.name} saved.`, at: Date.now(), id: r.id };
  } catch (e) {
    return fail(e);
  }
}

export async function leaveTypeCommandAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  const viewer = await requirePermission("leave.type.manage");
  const id = String(fd.get("id") ?? "");
  const op = String(fd.get("op") ?? "");
  if (!uuid.safeParse(id).success) return { error: "Unknown leave type.", at: Date.now() };
  try {
    if (op === "activate" || op === "deactivate") {
      const name = await setLeaveTypeActive(viewer.orgId, id, op === "activate");
      await audit(viewer, "update", "leave_type", id, `${op === "activate" ? "Activated" : "Deactivated"} leave type ${name}`);
      revalidatePath("/leave", "layout");
      return { ok: `${name} ${op === "activate" ? "is available again" : "is switched off — no new requests"}.`, at: Date.now() };
    }
    if (op === "delete") {
      const name = await deleteLeaveType(viewer.orgId, id);
      await audit(viewer, "delete", "leave_type", id, `Deleted unused leave type ${name}`);
      revalidatePath("/leave", "layout");
      return { ok: `${name} deleted.`, at: Date.now() };
    }
    if (op === "duplicate") {
      const r = await duplicateLeaveType(viewer.orgId, id);
      await audit(viewer, "create", "leave_type", r.id, `Duplicated a leave type as ${r.name}`);
      revalidatePath("/leave", "layout");
      return { ok: `${r.name} created, switched off until you review it.`, at: Date.now(), id: r.id };
    }
    return { error: "Unknown command.", at: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------------------------------------- leave groups */

const groupSchema = z.object({
  code: text(16).min(1, "A short code").regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, dash and underscore"),
  name: text(80).min(2, "Name the group"),
  nameNepali: optText(80),
  remarks: optText(300),
  sortOrder: num(0, 999).refine(Number.isInteger, "A whole number"),
});

export async function saveLeaveGroupAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  const viewer = await requirePermission("leave.type.manage");
  const id = String(fd.get("id") ?? "") || null;
  if (id && !uuid.safeParse(id).success) return { error: "Unknown group.", at: Date.now() };
  const parsed = groupSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  try {
    const gid = await saveLeaveGroup(viewer.orgId, id, parsed.data);
    await audit(viewer, id ? "update" : "create", "leave_group", gid, `${id ? "Updated" : "Created"} leave group ${parsed.data.name}`);
    revalidatePath("/leave/policy");
    return { ok: `${parsed.data.name} saved.`, at: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteLeaveGroupAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  const viewer = await requirePermission("leave.type.manage");
  const id = String(fd.get("id") ?? "");
  if (!uuid.safeParse(id).success) return { error: "Unknown group.", at: Date.now() };
  try {
    const name = await deleteLeaveGroup(viewer.orgId, id);
    await audit(viewer, "delete", "leave_group", id, `Deleted leave group ${name}`);
    revalidatePath("/leave", "layout");
    return { ok: `${name} deleted; its types are now ungrouped.`, at: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------------------------------------- entitlements */

export async function saveEntitlementAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  const viewer = await requirePermission("leave.type.manage");
  const parsed = z
    .object({ leaveTypeId: uuid, employmentTypeId: uuid, daysAllowed: optNum(0, 366), maxAccumulationDays: optNum(0, 999) })
    .safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const { leaveTypeId, employmentTypeId, daysAllowed, maxAccumulationDays } = parsed.data;
  try {
    await saveEntitlement(viewer.orgId, leaveTypeId, employmentTypeId, daysAllowed, maxAccumulationDays);
    await audit(
      viewer,
      "update",
      "leave_entitlement",
      `${leaveTypeId}:${employmentTypeId}`,
      daysAllowed === null ? "Cleared an employment-type entitlement (back to the type default)" : `Set an employment-type entitlement to ${daysAllowed} day(s)`,
    );
    revalidatePath("/leave/policy");
    return { ok: daysAllowed === null ? "Back to the type's default." : "Entitlement saved.", at: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

/* ---------------------------------------------------------------- balances */

export async function allocateAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  const viewer = await requirePermission("leave.balance.manage");
  const fy = String(fd.get("fiscalYearId") ?? "");
  if (!uuid.safeParse(fy).success) return { error: "Choose a fiscal year.", at: Date.now() };
  const prorate = fd.get("prorate") === "on" || fd.get("prorate") === "true";
  try {
    const r = await runAllocation(viewer.orgId, fy, prorate, { userId: viewer.userId, label: viewer.name });
    await audit(viewer, "create", "leave_balance", fy, `Allocated ${r.count} leave balance(s) for ${r.fy.code}${prorate ? " (prorated for joiners)" : ""}`);
    revalidatePath("/leave", "layout");
    return { ok: r.count ? `${r.count} balance${r.count === 1 ? "" : "s"} allocated for ${r.fy.code}.` : `Everybody already holds their ${r.fy.code} balances.`, at: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function adjustBalanceAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  const viewer = await requirePermission("leave.balance.manage");
  const parsed = z
    .object({
      balanceId: uuid,
      field: z.enum(["entitled", "carried_forward"]),
      value: num(0, 999).refine((v) => Math.round(v * 2) === v * 2, "Whole or half days"),
      reason: text(300).min(5, "Say why — it goes on the balance's history"),
    })
    .safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  try {
    const r = await adjustBalance(viewer.orgId, parsed.data.balanceId, parsed.data, { userId: viewer.userId, label: viewer.name });
    await audit(viewer, "update", "leave_balance", parsed.data.balanceId, `Adjusted ${parsed.data.field.replace("_", " ")} by ${r.delta > 0 ? "+" : ""}${r.delta} day(s): ${parsed.data.reason}`);
    revalidatePath("/leave", "layout");
    return { ok: `Balance ${r.delta > 0 ? "increased" : "reduced"} by ${Math.abs(r.delta)} day(s).`, at: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function yearEndAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  const viewer = await requirePermission("leave.balance.manage");
  const from = String(fd.get("fromFiscalYearId") ?? "");
  const to = String(fd.get("toFiscalYearId") ?? "");
  if (!uuid.safeParse(from).success || !uuid.safeParse(to).success) return { error: "Choose both fiscal years.", at: Date.now() };
  try {
    const r = await runYearEnd(viewer.orgId, from, to, { userId: viewer.userId, label: viewer.name });
    await audit(viewer, "update", "leave_year_end", from, `Year-end ${r.from.code} → ${r.to.code}: ${r.processed} balance(s), ${r.carried} day(s) carried, ${r.lapsed} lapsed`);
    revalidatePath("/leave", "layout");
    return {
      ok: r.processed ? `${r.processed} balance(s) closed: ${r.carried} day(s) carried into ${r.to.code}, ${r.lapsed} lapsed.` : `${r.from.code} has already been closed into ${r.to.code}.`,
      at: Date.now(),
    };
  } catch (e) {
    return fail(e);
  }
}

export async function encashAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  const viewer = await requirePermission("leave.balance.manage");
  const parsed = z
    .object({ balanceId: uuid, days: num(0.5, 366, "At least half a day"), reason: optText(300) })
    .safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  try {
    const r = await encash(viewer.orgId, parsed.data, { userId: viewer.userId, label: viewer.name });
    await audit(viewer, "create", "leave_encashment", r.id, `Encashed ${parsed.data.days} day(s) of ${r.typeName} (${r.reference})`);
    revalidatePath("/leave", "layout");
    return { ok: `${r.reference}: ${parsed.data.days} day(s) of ${r.typeName} encashed.`, at: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function reverseEncashmentAction(_prev: AdminState, fd: FormData): Promise<AdminState> {
  const viewer = await requirePermission("leave.balance.manage");
  const parsed = z.object({ id: uuid, reason: text(300).min(5, "Say why it is being reversed") }).safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  try {
    const r = await reverseEncashment(viewer.orgId, parsed.data.id, parsed.data.reason, { userId: viewer.userId, label: viewer.name });
    await audit(viewer, "update", "leave_encashment", parsed.data.id, `Reversed ${r.reference}: ${parsed.data.reason}`);
    revalidatePath("/leave", "layout");
    return { ok: `${r.reference} reversed; ${r.days} day(s) are back on the balance.`, at: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------------------------------------- read models */

export type AllocationPreview = {
  fyCode: string;
  count: number;
  already: number;
  staff: number;
  skippedStaff: number;
  days: number;
  prorated: number;
  sample: { employee: string; code: string; type: string; colour: string; days: number; prorated: boolean }[];
  error?: string;
};

/** What an allocation would create, before anybody commits to it. */
export async function previewAllocationAction(fiscalYearId: string, prorate: boolean): Promise<AllocationPreview> {
  const viewer = await requirePermission("leave.balance.manage");
  if (!uuid.safeParse(fiscalYearId).success) return { fyCode: "", count: 0, already: 0, staff: 0, skippedStaff: 0, days: 0, prorated: 0, sample: [], error: "Choose a fiscal year." };
  try {
    const p = await previewAllocation(viewer.orgId, fiscalYearId, prorate);
    return {
      fyCode: p.fy.code,
      count: p.rows.length,
      already: p.already,
      staff: p.staff,
      skippedStaff: p.skippedStaff,
      days: p.rows.reduce((a, r) => a + r.days, 0),
      prorated: p.rows.filter((r) => r.prorated).length,
      sample: p.rows.slice(0, 60).map((r) => ({ employee: r.employeeName, code: r.employeeCode, type: r.leaveTypeName, colour: r.colour, days: r.days, prorated: r.prorated })),
    };
  } catch (e) {
    if (e instanceof LeaveAdminError) return { fyCode: "", count: 0, already: 0, staff: 0, skippedStaff: 0, days: 0, prorated: 0, sample: [], error: e.message };
    throw e;
  }
}

export type BalanceView = {
  id: string;
  employeeName: string;
  employeeCode: string;
  typeName: string;
  colour: string;
  fyCode: string;
  entitled: number;
  carried: number;
  used: number;
  pending: number;
  encashed: number;
  history: { id: string; kind: string; field: string; days: number; before: number; after: number; reason: string | null; reference: string | null; byLabel: string | null; at: string; reversed: boolean }[];
};

export async function balanceDetailAction(balanceId: string): Promise<BalanceView | null> {
  const viewer = await requirePermission("leave.balance.manage");
  if (!uuid.safeParse(balanceId).success) return null;
  const d = await balanceDetail(viewer.orgId, balanceId);
  if (!d) return null;
  return {
    id: d.b.id,
    employeeName: d.employeeName,
    employeeCode: d.employeeCode,
    typeName: d.typeName,
    colour: d.colour,
    fyCode: d.fyCode,
    entitled: Number(d.b.entitled),
    carried: Number(d.b.carriedForward),
    used: Number(d.b.used),
    pending: Number(d.b.pending),
    encashed: Number(d.b.encashed),
    history: d.history.map((h) => ({
      id: h.id,
      kind: h.kind,
      field: h.field,
      days: Number(h.days),
      before: Number(h.before),
      after: Number(h.after),
      reason: h.reason,
      reference: h.reference,
      byLabel: h.byLabel,
      at: h.createdAt.toISOString(),
      reversed: Boolean(h.reversedAt),
    })),
  };
}
