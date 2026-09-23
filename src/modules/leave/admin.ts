import "server-only";

import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { fiscalYears } from "@/db/schema/core";
import { employees, onStrength } from "@/db/schema/hr";
import { departments, employmentTypes } from "@/db/schema/org";
import { leaveBalanceAdjustments, leaveBalances, leaveRequests, leaveTypes } from "@/db/schema/leave";
import { leaveGroups, leaveTypeEntitlements } from "@/db/schema/leave-policy";
import { adToBs, daysBetween, todayInNepal } from "@/lib/bs";

/**
 * Leave administration: the policy objects (types, groups, entitlements) and
 * the balance operations HR runs — allocation, correction, the year-end carry
 * and lapse, and encashment.
 *
 * Every balance change other than a leave request goes through here and is
 * written to `leave_balance_adjustments` in the same transaction, so the
 * current figures on a balance can always be explained line by line.
 *
 * Encashment and lapse change the balance figures themselves (carry forward
 * first, then entitlement), and `encashed` keeps the running total. That keeps
 * "available = entitled + carried − used − pending" true everywhere the
 * product already computes it, with nothing downstream to update.
 */

export class LeaveAdminError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = "LeaveAdminError";
  }
}

export type By = { userId: string; label: string };

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const d2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
/** Rounded to the half day, which is the smallest unit anybody takes. */
const halfDay = (v: number) => Math.round(v * 2) / 2;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* =============================================================== leave types */

export type LeaveTypeInput = {
  code: string;
  name: string;
  nameNepali: string | null;
  colour: string;
  leaveGroupId: string | null;
  nature: (typeof leaveTypes.$inferInsert)["nature"];
  paidPercent: number;
  unit: "day" | "half_day" | "hour";
  daysPerYear: number;
  deductsBalance: boolean;
  allowHalfDay: boolean;
  allocationRule: (typeof leaveTypes.$inferInsert)["allocationRule"];
  isAllocatedInFull: boolean;
  lapseType: (typeof leaveTypes.$inferInsert)["lapseType"];
  allowCarryForward: boolean;
  maxCarryForwardDays: number | null;
  maxAccumulationDays: number | null;
  isEncashable: boolean;
  minDaysToEncash: number | null;
  maxDaysToEncash: number | null;
  appliesTo: "all" | "male" | "female";
  maritalStatus: string | null;
  minNoticeDays: number;
  maxConsecutiveDays: number | null;
  requiresAttachmentAfterDays: number | null;
  applyWindow: (typeof leaveTypes.$inferInsert)["applyWindow"];
  qualifyFrom: (typeof leaveTypes.$inferInsert)["qualifyFrom"];
  minDaysToQualify: number | null;
  timesAllowedInService: number | null;
  maxDaysToApply: number | null;
  excludesHolidays: boolean;
  excludesWeeklyOffs: boolean;
  approvalLevels: number;
  level1LimitDays: number | null;
  level2LimitDays: number | null;
  level3LimitDays: number | null;
  level4LimitDays: number | null;
  notifiesHr: boolean;
  leaveOrder: number;
  isExcessDeductedFromPay: boolean;
  isDeductedFromServiceTime: boolean;
};

/** Rules that span fields; single-field ranges are the form's job. */
function checkLeaveType(i: LeaveTypeInput) {
  if (i.isEncashable && i.minDaysToEncash !== null && i.maxDaysToEncash !== null && i.minDaysToEncash > i.maxDaysToEncash) {
    throw new LeaveAdminError("The minimum to encash cannot be more than the maximum.", "minDaysToEncash");
  }
  if (i.allowCarryForward && (i.lapseType === "monthly" || i.lapseType === "service_period")) {
    throw new LeaveAdminError("Only leave that lapses yearly or never lapses can carry forward.", "allowCarryForward");
  }
  if (i.maxAccumulationDays !== null && i.maxAccumulationDays < i.daysPerYear) {
    throw new LeaveAdminError("The accumulation ceiling cannot be below one year's entitlement.", "maxAccumulationDays");
  }
  const limits = [i.level1LimitDays, i.level2LimitDays, i.level3LimitDays, i.level4LimitDays].slice(0, i.approvalLevels);
  let previous = 0;
  for (const [k, l] of limits.entries()) {
    if (l === null) continue;
    if (l <= previous) throw new LeaveAdminError(`Level ${k + 1}'s limit must be higher than the level below it.`, `level${k + 1}LimitDays`);
    previous = l;
  }
}

function toRow(i: LeaveTypeInput) {
  const approvalLevels = Math.min(4, Math.max(1, i.approvalLevels));
  const limit = (k: number, v: number | null) => (k <= approvalLevels ? v : null);
  return {
    code: i.code.toUpperCase(),
    name: i.name,
    nameNepali: i.nameNepali,
    colour: i.colour,
    leaveGroupId: i.leaveGroupId,
    nature: i.nature,
    paidPercent: d2(i.paidPercent),
    isPaid: i.paidPercent > 0,
    unit: i.unit,
    daysPerYear: d2(i.deductsBalance ? i.daysPerYear : 0),
    deductsBalance: i.deductsBalance,
    allowHalfDay: i.allowHalfDay,
    allocationRule: i.allocationRule,
    isAllocatedInFull: i.isAllocatedInFull,
    lapseType: i.lapseType,
    allowCarryForward: i.allowCarryForward,
    maxCarryForwardDays: i.allowCarryForward && i.maxCarryForwardDays !== null ? d2(i.maxCarryForwardDays) : null,
    maxAccumulationDays: i.maxAccumulationDays === null ? null : d2(i.maxAccumulationDays),
    isEncashable: i.isEncashable,
    minDaysToEncash: i.isEncashable && i.minDaysToEncash !== null ? d2(i.minDaysToEncash) : null,
    maxDaysToEncash: i.isEncashable && i.maxDaysToEncash !== null ? d2(i.maxDaysToEncash) : null,
    appliesTo: i.appliesTo,
    maritalStatus: i.maritalStatus,
    minNoticeDays: i.minNoticeDays,
    maxConsecutiveDays: i.maxConsecutiveDays,
    requiresAttachmentAfterDays: i.requiresAttachmentAfterDays,
    applyWindow: i.applyWindow,
    qualifyFrom: i.qualifyFrom,
    minDaysToQualify: i.minDaysToQualify,
    timesAllowedInService: i.timesAllowedInService,
    maxDaysToApply: i.maxDaysToApply,
    excludesHolidays: i.excludesHolidays,
    excludesWeeklyOffs: i.excludesWeeklyOffs,
    approvalLevels,
    level1LimitDays: limit(1, i.level1LimitDays),
    level2LimitDays: limit(2, i.level2LimitDays),
    level3LimitDays: limit(3, i.level3LimitDays),
    level4LimitDays: limit(4, i.level4LimitDays),
    notifiesHr: i.notifiesHr,
    leaveOrder: i.leaveOrder,
    isExcessDeductedFromPay: i.isExcessDeductedFromPay,
    isDeductedFromServiceTime: i.isDeductedFromServiceTime,
  };
}

export type FieldChanges = Record<string, { from: unknown; to: unknown }>;

export async function saveLeaveType(orgId: string, id: string | null, input: LeaveTypeInput) {
  checkLeaveType(input);
  const row = toRow(input);

  const clash = await db
    .select({ id: leaveTypes.id })
    .from(leaveTypes)
    .where(and(eq(leaveTypes.orgId, orgId), sql`upper(${leaveTypes.code}) = ${row.code}`, id ? ne(leaveTypes.id, id) : undefined))
    .limit(1);
  if (clash.length) throw new LeaveAdminError("Another leave type already uses that code.", "code");

  if (row.leaveGroupId) {
    const [g] = await db.select({ id: leaveGroups.id }).from(leaveGroups).where(and(eq(leaveGroups.id, row.leaveGroupId), eq(leaveGroups.orgId, orgId))).limit(1);
    if (!g) throw new LeaveAdminError("That leave group no longer exists.", "leaveGroupId");
  }

  if (!id) {
    const [created] = await db.insert(leaveTypes).values({ orgId, ...row }).returning({ id: leaveTypes.id });
    return { id: created.id, changes: {} as FieldChanges, created: true };
  }

  const [before] = await db.select().from(leaveTypes).where(and(eq(leaveTypes.id, id), eq(leaveTypes.orgId, orgId))).limit(1);
  if (!before) throw new LeaveAdminError("That leave type no longer exists.");
  // a type people already hold balances in cannot quietly stop being tracked
  if (before.deductsBalance && !row.deductsBalance) {
    const [{ c }] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(leaveBalances)
      .where(and(eq(leaveBalances.leaveTypeId, id), sql`(${leaveBalances.used} > 0 or ${leaveBalances.pending} > 0)`));
    if (c > 0) throw new LeaveAdminError("People have taken or requested this leave against a balance; it has to keep tracking one.", "deductsBalance");
  }

  const changes: FieldChanges = {};
  for (const [k, v] of Object.entries(row)) {
    const prev = (before as Record<string, unknown>)[k];
    if (String(prev ?? "") !== String(v ?? "")) changes[k] = { from: prev, to: v };
  }
  await db.update(leaveTypes).set(row).where(eq(leaveTypes.id, id));
  return { id, changes, created: false };
}

/**
 * Usage per type. The outer column is written qualified on purpose: in a
 * single-table select Drizzle renders `${leaveTypes.id}` as a bare "id",
 * which inside the subquery would bind to the request's own id.
 */
export async function leaveTypeUsage(orgId: string) {
  const rows = await db
    .select({
      id: leaveTypes.id,
      requests: sql<number>`(select count(*)::int from ${leaveRequests} r where r.leave_type_id = "leave_types"."id")`,
      open: sql<number>`(select count(*)::int from ${leaveRequests} r where r.leave_type_id = "leave_types"."id" and r.status = 'pending')`,
      holders: sql<number>`(select count(*)::int from ${leaveBalances} b where b.leave_type_id = "leave_types"."id" and (b.used > 0 or b.pending > 0))`,
      balances: sql<number>`(select count(*)::int from ${leaveBalances} b where b.leave_type_id = "leave_types"."id")`,
    })
    .from(leaveTypes)
    .where(eq(leaveTypes.orgId, orgId));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function setLeaveTypeActive(orgId: string, id: string, active: boolean) {
  if (!active) {
    const [{ open }] = await db
      .select({ open: sql<number>`count(*)::int` })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.orgId, orgId), eq(leaveRequests.leaveTypeId, id), eq(leaveRequests.status, "pending")));
    if (open > 0) throw new LeaveAdminError(`${open} request${open === 1 ? " is" : "s are"} still waiting for a decision. Decide ${open === 1 ? "it" : "them"} first.`);
  }
  const rows = await db.update(leaveTypes).set({ isActive: active }).where(and(eq(leaveTypes.id, id), eq(leaveTypes.orgId, orgId))).returning({ name: leaveTypes.name });
  if (!rows.length) throw new LeaveAdminError("That leave type no longer exists.");
  return rows[0].name;
}

/**
 * Deletes a type nobody has ever used. Once a request exists the type is part
 * of the record — it can be switched off, never removed.
 */
export async function deleteLeaveType(orgId: string, id: string) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(leaveTypes).where(and(eq(leaveTypes.id, id), eq(leaveTypes.orgId, orgId))).for("update").limit(1);
    if (!t) throw new LeaveAdminError("That leave type no longer exists.");
    const [{ c }] = await tx.select({ c: sql<number>`count(*)::int` }).from(leaveRequests).where(eq(leaveRequests.leaveTypeId, id));
    if (c > 0) throw new LeaveAdminError(`${t.name} has ${c} request${c === 1 ? "" : "s"} on record. Deactivate it instead — history keeps pointing at it.`);
    const [{ u }] = await tx
      .select({ u: sql<number>`count(*)::int` })
      .from(leaveBalances)
      .where(and(eq(leaveBalances.leaveTypeId, id), sql`(${leaveBalances.used} > 0 or ${leaveBalances.pending} > 0 or ${leaveBalances.encashed} > 0)`));
    if (u > 0) throw new LeaveAdminError(`${t.name} has been used or encashed against. Deactivate it instead.`);
    // balances, entitlements and ledger rows cascade with it
    await tx.delete(leaveTypes).where(eq(leaveTypes.id, id));
    return t.name;
  });
}

/** Copies a type as an inactive draft — the fastest way to a variant. */
export async function duplicateLeaveType(orgId: string, id: string) {
  const [t] = await db.select().from(leaveTypes).where(and(eq(leaveTypes.id, id), eq(leaveTypes.orgId, orgId))).limit(1);
  if (!t) throw new LeaveAdminError("That leave type no longer exists.");
  const taken = new Set(
    (await db.select({ code: leaveTypes.code }).from(leaveTypes).where(eq(leaveTypes.orgId, orgId))).map((r) => r.code.toUpperCase()),
  );
  let code = `${t.code}-COPY`;
  for (let i = 2; taken.has(code.toUpperCase()); i++) code = `${t.code}-COPY${i}`;
  const { id: _id, createdAt: _c, ...rest } = t;
  void _id;
  void _c;
  const [row] = await db
    .insert(leaveTypes)
    .values({ ...rest, code, name: `${t.name} (copy)`, isActive: false })
    .returning({ id: leaveTypes.id, name: leaveTypes.name });
  // the entitlement matrix is part of the policy: copy it too
  const ents = await db.select().from(leaveTypeEntitlements).where(eq(leaveTypeEntitlements.leaveTypeId, id));
  if (ents.length) {
    await db.insert(leaveTypeEntitlements).values(
      ents.map((e) => ({ orgId, leaveTypeId: row.id, employmentTypeId: e.employmentTypeId, daysAllowed: e.daysAllowed, maxAccumulationDays: e.maxAccumulationDays })),
    );
  }
  return row;
}

/* ============================================================== leave groups */

export type LeaveGroupInput = { code: string; name: string; nameNepali: string | null; remarks: string | null; sortOrder: number };

export async function saveLeaveGroup(orgId: string, id: string | null, input: LeaveGroupInput) {
  const code = input.code.toUpperCase();
  const clash = await db
    .select({ id: leaveGroups.id })
    .from(leaveGroups)
    .where(and(eq(leaveGroups.orgId, orgId), sql`upper(${leaveGroups.code}) = ${code}`, id ? ne(leaveGroups.id, id) : undefined))
    .limit(1);
  if (clash.length) throw new LeaveAdminError("Another group already uses that code.", "code");
  const values = { code, name: input.name, nameNepali: input.nameNepali, remarks: input.remarks, sortOrder: input.sortOrder };
  if (!id) {
    const [r] = await db.insert(leaveGroups).values({ orgId, ...values }).returning({ id: leaveGroups.id });
    return r.id;
  }
  const rows = await db.update(leaveGroups).set(values).where(and(eq(leaveGroups.id, id), eq(leaveGroups.orgId, orgId))).returning({ id: leaveGroups.id });
  if (!rows.length) throw new LeaveAdminError("That group no longer exists.");
  return id;
}

/** Removes a group; its leave types simply become ungrouped. */
export async function deleteLeaveGroup(orgId: string, id: string) {
  return db.transaction(async (tx) => {
    await tx.update(leaveTypes).set({ leaveGroupId: null }).where(and(eq(leaveTypes.orgId, orgId), eq(leaveTypes.leaveGroupId, id)));
    const rows = await tx.delete(leaveGroups).where(and(eq(leaveGroups.id, id), eq(leaveGroups.orgId, orgId))).returning({ name: leaveGroups.name });
    if (!rows.length) throw new LeaveAdminError("That group no longer exists.");
    return rows[0].name;
  });
}

/* ============================================================== entitlements */

/**
 * Sets (or clears, with `daysAllowed` null) what one employment type is
 * entitled to of one leave type, overriding the type's default.
 */
export async function saveEntitlement(
  orgId: string,
  leaveTypeId: string,
  employmentTypeId: string,
  daysAllowed: number | null,
  maxAccumulationDays: number | null,
) {
  const [t] = await db.select({ id: leaveTypes.id }).from(leaveTypes).where(and(eq(leaveTypes.id, leaveTypeId), eq(leaveTypes.orgId, orgId))).limit(1);
  const [e] = await db.select({ id: employmentTypes.id }).from(employmentTypes).where(and(eq(employmentTypes.id, employmentTypeId), eq(employmentTypes.orgId, orgId))).limit(1);
  if (!t || !e) throw new LeaveAdminError("That leave or employment type no longer exists.");
  if (daysAllowed === null) {
    await db.delete(leaveTypeEntitlements).where(and(eq(leaveTypeEntitlements.leaveTypeId, leaveTypeId), eq(leaveTypeEntitlements.employmentTypeId, employmentTypeId)));
    return;
  }
  if (maxAccumulationDays !== null && maxAccumulationDays < daysAllowed) {
    throw new LeaveAdminError("The accumulation ceiling cannot be below the yearly entitlement.", "maxAccumulationDays");
  }
  await db
    .insert(leaveTypeEntitlements)
    .values({ orgId, leaveTypeId, employmentTypeId, daysAllowed: d2(daysAllowed), maxAccumulationDays: maxAccumulationDays === null ? null : d2(maxAccumulationDays) })
    .onConflictDoUpdate({
      target: [leaveTypeEntitlements.leaveTypeId, leaveTypeEntitlements.employmentTypeId],
      set: { daysAllowed: d2(daysAllowed), maxAccumulationDays: maxAccumulationDays === null ? null : d2(maxAccumulationDays) },
    });
}

/* ================================================================ allocation */

export type AllocationRow = {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  colour: string;
  days: number;
  prorated: boolean;
  /** "new" creates the balance; "fill" sets an empty one created by a carry forward. */
  action: "new" | "fill";
};

async function allocationPlan(orgId: string, fiscalYearId: string, prorate: boolean) {
  const [fy] = await db.select().from(fiscalYears).where(and(eq(fiscalYears.id, fiscalYearId), eq(fiscalYears.orgId, orgId))).limit(1);
  if (!fy) throw new LeaveAdminError("Choose a fiscal year.", "fiscalYearId");

  const [types, staff, ents, existing, allocated] = await Promise.all([
    db
      .select()
      .from(leaveTypes)
      .where(and(eq(leaveTypes.orgId, orgId), eq(leaveTypes.isActive, true), eq(leaveTypes.deductsBalance, true)))
      .orderBy(asc(leaveTypes.leaveOrder), asc(leaveTypes.name)),
    db
      .select({
        id: employees.id,
        code: employees.employeeCode,
        name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        gender: employees.gender,
        maritalStatus: employees.maritalStatus,
        employmentTypeId: employees.employmentTypeId,
        dateOfJoin: employees.dateOfJoin,
        accrues: employmentTypes.accruesLeave,
      })
      .from(employees)
      .leftJoin(employmentTypes, eq(employmentTypes.id, employees.employmentTypeId))
      .where(and(eq(employees.orgId, orgId), onStrength()))
      .orderBy(asc(employees.employeeCode)),
    db.select().from(leaveTypeEntitlements).where(eq(leaveTypeEntitlements.orgId, orgId)),
    db
      .select({ employeeId: leaveBalances.employeeId, leaveTypeId: leaveBalances.leaveTypeId, entitled: leaveBalances.entitled })
      .from(leaveBalances)
      .where(and(eq(leaveBalances.orgId, orgId), eq(leaveBalances.fiscalYearId, fiscalYearId))),
    db
      .select({ employeeId: leaveBalanceAdjustments.employeeId, leaveTypeId: leaveBalanceAdjustments.leaveTypeId })
      .from(leaveBalanceAdjustments)
      .where(and(eq(leaveBalanceAdjustments.orgId, orgId), eq(leaveBalanceAdjustments.fiscalYearId, fiscalYearId), eq(leaveBalanceAdjustments.kind, "allocation"))),
  ]);

  const ent = new Map(ents.map((e) => [`${e.leaveTypeId}:${e.employmentTypeId}`, n(e.daysAllowed)]));
  const have = new Map(existing.map((b) => [`${b.employeeId}:${b.leaveTypeId}`, n(b.entitled)]));
  const done = new Set(allocated.map((a) => `${a.employeeId}:${a.leaveTypeId}`));
  const yearDays = Math.max(1, daysBetween(fy.startDate, fy.endDate));

  const rows: AllocationRow[] = [];
  let already = 0;
  let skippedStaff = 0;
  for (const e of staff) {
    if (e.accrues === false) {
      skippedStaff++;
      continue;
    }
    // somebody who joins after the year has closed gets nothing from it
    if (e.dateOfJoin && e.dateOfJoin > fy.endDate) continue;
    for (const t of types) {
      if (t.appliesTo !== "all" && t.appliesTo !== e.gender) continue;
      if (t.maritalStatus && t.maritalStatus !== e.maritalStatus) continue;
      const key = `${e.id}:${t.id}`;
      const current = have.get(key);
      if (done.has(key) || (current !== undefined && current > 0)) {
        already++;
        continue;
      }
      let days = (e.employmentTypeId ? ent.get(`${t.id}:${e.employmentTypeId}`) : undefined) ?? n(t.daysPerYear);
      let prorated = false;
      // service-period leave (maternity, study) is an entitlement per event, never prorated
      if (prorate && t.lapseType !== "service_period" && e.dateOfJoin && e.dateOfJoin > fy.startDate) {
        days = halfDay((days * daysBetween(e.dateOfJoin, fy.endDate)) / yearDays);
        prorated = true;
      }
      if (days <= 0 && current !== undefined) {
        already++;
        continue;
      }
      rows.push({
        employeeId: e.id,
        employeeCode: e.code,
        employeeName: e.name,
        leaveTypeId: t.id,
        leaveTypeName: t.name,
        colour: t.colour,
        days,
        prorated,
        action: current === undefined ? "new" : "fill",
      });
    }
  }
  return { fy, rows, already, skippedStaff, staff: staff.length, types: types.length };
}

export async function previewAllocation(orgId: string, fiscalYearId: string, prorate: boolean) {
  return allocationPlan(orgId, fiscalYearId, prorate);
}

/**
 * Creates the balances a fiscal year is missing. Safe to run again: anything
 * already allocated is left exactly as it is, including hand corrections.
 */
export async function runAllocation(orgId: string, fiscalYearId: string, prorate: boolean, by: By) {
  const plan = await allocationPlan(orgId, fiscalYearId, prorate);
  let count = 0;
  await db.transaction(async (tx) => {
    for (const r of plan.rows) {
      const [b] = await tx
        .insert(leaveBalances)
        .values({ orgId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, fiscalYearId, entitled: "0" })
        .onConflictDoUpdate({ target: [leaveBalances.employeeId, leaveBalances.leaveTypeId, leaveBalances.fiscalYearId], set: { updatedAt: new Date() } })
        .returning();
      const [entry] = await tx
        .insert(leaveBalanceAdjustments)
        .values({
          orgId,
          balanceId: b.id,
          employeeId: r.employeeId,
          leaveTypeId: r.leaveTypeId,
          fiscalYearId,
          kind: "allocation",
          field: "entitled",
          days: d2(r.days),
          before: b.entitled,
          after: d2(n(b.entitled) + r.days),
          reason: r.prorated ? `Allocated for ${plan.fy.code}, prorated from the date of joining` : `Allocated for ${plan.fy.code}`,
          dedupeKey: `alloc:${fiscalYearId}:${r.employeeId}:${r.leaveTypeId}`,
          byUserId: by.userId,
          byLabel: by.label,
        })
        .onConflictDoNothing()
        .returning({ id: leaveBalanceAdjustments.id });
      if (!entry) continue;
      await tx
        .update(leaveBalances)
        .set({ entitled: sql`${leaveBalances.entitled} + ${d2(r.days)}`, updatedAt: new Date() })
        .where(eq(leaveBalances.id, b.id));
      count++;
    }
  });
  return { count, fy: plan.fy };
}

/* =============================================================== adjustments */

/**
 * Sets a balance's entitlement or carried-forward figure to a new value, with
 * the reason on record. Refused if it would leave less than has already been
 * taken or reserved.
 */
export async function adjustBalance(
  orgId: string,
  balanceId: string,
  input: { field: "entitled" | "carried_forward"; value: number; reason: string },
  by: By,
) {
  return db.transaction(async (tx) => {
    const [b] = await tx
      .select()
      .from(leaveBalances)
      .where(and(eq(leaveBalances.id, balanceId), eq(leaveBalances.orgId, orgId)))
      .for("update")
      .limit(1);
    if (!b) throw new LeaveAdminError("That balance no longer exists.");
    const before = input.field === "entitled" ? n(b.entitled) : n(b.carriedForward);
    const delta = input.value - before;
    if (Math.abs(delta) < 0.001) throw new LeaveAdminError("That is the figure already on record.", "value");
    const entitled = input.field === "entitled" ? input.value : n(b.entitled);
    const carried = input.field === "carried_forward" ? input.value : n(b.carriedForward);
    const committed = n(b.used) + n(b.pending);
    if (entitled + carried < committed) {
      throw new LeaveAdminError(`${committed} day(s) are already taken or requested; the balance cannot go below that.`, "value");
    }
    await tx
      .update(leaveBalances)
      .set(input.field === "entitled" ? { entitled: d2(input.value), updatedAt: new Date() } : { carriedForward: d2(input.value), updatedAt: new Date() })
      .where(eq(leaveBalances.id, b.id));
    await tx.insert(leaveBalanceAdjustments).values({
      orgId,
      balanceId: b.id,
      employeeId: b.employeeId,
      leaveTypeId: b.leaveTypeId,
      fiscalYearId: b.fiscalYearId,
      kind: "adjustment",
      field: input.field,
      days: d2(delta),
      before: d2(before),
      after: d2(input.value),
      reason: input.reason,
      byUserId: by.userId,
      byLabel: by.label,
    });
    return { delta, employeeId: b.employeeId };
  });
}

/** One balance with everything that moved it, newest first. */
export async function balanceDetail(orgId: string, balanceId: string) {
  const [b] = await db
    .select({
      b: leaveBalances,
      employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      employeeCode: employees.employeeCode,
      typeName: leaveTypes.name,
      colour: leaveTypes.colour,
      fyCode: fiscalYears.code,
    })
    .from(leaveBalances)
    .innerJoin(employees, eq(employees.id, leaveBalances.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
    .innerJoin(fiscalYears, eq(fiscalYears.id, leaveBalances.fiscalYearId))
    .where(and(eq(leaveBalances.id, balanceId), eq(leaveBalances.orgId, orgId)))
    .limit(1);
  if (!b) return null;
  const history = await db
    .select()
    .from(leaveBalanceAdjustments)
    .where(eq(leaveBalanceAdjustments.balanceId, balanceId))
    .orderBy(desc(leaveBalanceAdjustments.createdAt))
    .limit(50);
  return { ...b, history };
}

/* ================================================================== year end */

export type YearEndRow = {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeName: string;
  colour: string;
  rule: string;
  available: number;
  pending: number;
  carry: number;
  lapse: number;
  done: boolean;
};

/**
 * What happens to each closing balance when the year turns: how much carries
 * into the next year and how much lapses, by each type's rules.
 *
 *   never lapses       everything carries, up to the accumulation ceiling
 *   lapses yearly      carry forward if allowed, up to its cap; the rest lapses
 *   monthly            nothing carries
 *   service period     an entitlement per event (maternity, study) — it does not
 *                      carry and does not lapse; next year's allocation stands alone
 *
 * Days still reserved by undecided requests are left out: they belong to the
 * closing year, and are flagged so HR can clear them first.
 */
async function yearEndPlan(orgId: string, fromId: string, toId: string) {
  if (fromId === toId) throw new LeaveAdminError("Choose two different fiscal years.", "toFiscalYearId");
  const years = await db.select().from(fiscalYears).where(and(eq(fiscalYears.orgId, orgId), inArray(fiscalYears.id, [fromId, toId])));
  const from = years.find((y) => y.id === fromId);
  const to = years.find((y) => y.id === toId);
  if (!from || !to) throw new LeaveAdminError("Choose the closing and the next fiscal year.");
  if (to.startDate <= from.startDate) throw new LeaveAdminError("The year carried into must come after the closing year.", "toFiscalYearId");

  const [rows, done] = await Promise.all([
    db
      .select({
        b: leaveBalances,
        name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        code: employees.employeeCode,
        t: leaveTypes,
      })
      .from(leaveBalances)
      .innerJoin(employees, eq(employees.id, leaveBalances.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
      .where(and(eq(leaveBalances.orgId, orgId), eq(leaveBalances.fiscalYearId, fromId), eq(leaveTypes.deductsBalance, true), isNull(employees.deletedAt)))
      .orderBy(asc(employees.employeeCode), asc(leaveTypes.leaveOrder)),
    db
      .select({ key: leaveBalanceAdjustments.dedupeKey })
      .from(leaveBalanceAdjustments)
      .where(and(eq(leaveBalanceAdjustments.orgId, orgId), sql`${leaveBalanceAdjustments.dedupeKey} like ${`yearend:${fromId}:%`}`)),
  ]);
  const doneKeys = new Set(done.map((d) => d.key));

  const plan: YearEndRow[] = [];
  for (const { b, name, code, t } of rows) {
    const available = Math.max(0, n(b.entitled) + n(b.carriedForward) - n(b.used) - n(b.pending));
    let carry = 0;
    let rule: string;
    if (t.lapseType === "none") {
      // a carry cap, when set, limits what moves; the accumulation ceiling limits what can be held
      const cap = t.allowCarryForward && t.maxCarryForwardDays !== null ? n(t.maxCarryForwardDays) : Infinity;
      const ceiling = t.maxAccumulationDays === null ? Infinity : n(t.maxAccumulationDays);
      const limit = Math.min(cap, ceiling);
      carry = Math.min(available, limit);
      rule = limit === Infinity ? "Never lapses" : `Never lapses · carry up to ${limit}`;
    } else if (t.lapseType === "yearly") {
      carry = t.allowCarryForward ? Math.min(available, t.maxCarryForwardDays === null ? available : n(t.maxCarryForwardDays)) : 0;
      rule = t.allowCarryForward ? `Carry up to ${t.maxCarryForwardDays === null ? "all" : n(t.maxCarryForwardDays)}` : "Lapses yearly";
    } else if (t.lapseType === "monthly") {
      rule = "Lapses monthly";
    } else {
      plan.push({
        employeeId: b.employeeId, employeeCode: code, employeeName: name, leaveTypeId: t.id, leaveTypeName: t.name, colour: t.colour,
        rule: "Per event — not carried", available, pending: n(b.pending), carry: 0, lapse: 0, done: doneKeys.has(`yearend:${fromId}:${b.employeeId}:${t.id}`),
      });
      continue;
    }
    plan.push({
      employeeId: b.employeeId,
      employeeCode: code,
      employeeName: name,
      leaveTypeId: t.id,
      leaveTypeName: t.name,
      colour: t.colour,
      rule,
      available,
      pending: n(b.pending),
      carry,
      lapse: Math.max(0, available - carry),
      done: doneKeys.has(`yearend:${fromId}:${b.employeeId}:${t.id}`),
    });
  }
  return { from, to, rows: plan };
}

export async function previewYearEnd(orgId: string, fromId: string, toId: string) {
  return yearEndPlan(orgId, fromId, toId);
}

/** Applies the plan. Rows already processed are skipped, so a second run changes nothing. */
export async function runYearEnd(orgId: string, fromId: string, toId: string, by: By) {
  const plan = await yearEndPlan(orgId, fromId, toId);
  let carried = 0;
  let lapsed = 0;
  let processed = 0;
  await db.transaction(async (tx) => {
    for (const r of plan.rows) {
      if (r.done) continue;
      const [source] = await tx
        .select()
        .from(leaveBalances)
        .where(and(eq(leaveBalances.employeeId, r.employeeId), eq(leaveBalances.leaveTypeId, r.leaveTypeId), eq(leaveBalances.fiscalYearId, fromId)))
        .for("update")
        .limit(1);
      if (!source) continue;
      // the marker row: written first so the rest of this row runs exactly once
      const [marker] = await tx
        .insert(leaveBalanceAdjustments)
        .values({
          orgId,
          balanceId: source.id,
          employeeId: r.employeeId,
          leaveTypeId: r.leaveTypeId,
          fiscalYearId: fromId,
          kind: "lapse",
          field: "available",
          days: d2(-r.lapse),
          before: d2(r.available),
          after: d2(r.available - r.lapse),
          reason: r.lapse > 0 ? `${r.lapse} day(s) lapsed at the close of ${plan.from.code} (${r.rule})` : `Year closed: ${plan.from.code} → ${plan.to.code} (${r.rule})`,
          dedupeKey: `yearend:${fromId}:${r.employeeId}:${r.leaveTypeId}`,
          byUserId: by.userId,
          byLabel: by.label,
        })
        .onConflictDoNothing()
        .returning({ id: leaveBalanceAdjustments.id });
      if (!marker) continue;
      processed++;
      lapsed += r.lapse;
      if (r.carry <= 0) continue;

      const [target] = await tx
        .insert(leaveBalances)
        .values({ orgId, employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, fiscalYearId: toId, entitled: "0" })
        .onConflictDoUpdate({ target: [leaveBalances.employeeId, leaveBalances.leaveTypeId, leaveBalances.fiscalYearId], set: { updatedAt: new Date() } })
        .returning();
      await tx
        .update(leaveBalances)
        .set({ carriedForward: sql`${leaveBalances.carriedForward} + ${d2(r.carry)}`, updatedAt: new Date() })
        .where(eq(leaveBalances.id, target.id));
      await tx.insert(leaveBalanceAdjustments).values({
        orgId,
        balanceId: target.id,
        employeeId: r.employeeId,
        leaveTypeId: r.leaveTypeId,
        fiscalYearId: toId,
        kind: "carry_forward",
        field: "carried_forward",
        days: d2(r.carry),
        before: target.carriedForward,
        after: d2(n(target.carriedForward) + r.carry),
        reason: `Carried forward from ${plan.from.code}`,
        dedupeKey: `yearend-carry:${fromId}:${r.employeeId}:${r.leaveTypeId}`,
        byUserId: by.userId,
        byLabel: by.label,
      });
      carried += r.carry;
    }
  });
  return { processed, carried, lapsed, from: plan.from, to: plan.to };
}

/* ================================================================ encashment */

async function nextEncashRef(tx: Tx, orgId: string) {
  const year = adToBs(todayInNepal()).year;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`enc:${orgId}:${year}`}))`);
  const [{ c }] = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(leaveBalanceAdjustments)
    .where(and(eq(leaveBalanceAdjustments.orgId, orgId), sql`${leaveBalanceAdjustments.reference} like ${`ENC-${year}-%`}`));
  return `ENC-${year}-${String(c + 1).padStart(4, "0")}`;
}

/** Balances that can be encashed in a year, with what each could pay out. */
export async function encashableBalances(orgId: string, fiscalYearId: string) {
  const rows = await db
    .select({
      balanceId: leaveBalances.id,
      employeeId: employees.id,
      employeeCode: employees.employeeCode,
      employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      department: departments.name,
      leaveTypeId: leaveTypes.id,
      leaveTypeName: leaveTypes.name,
      colour: leaveTypes.colour,
      min: leaveTypes.minDaysToEncash,
      max: leaveTypes.maxDaysToEncash,
      entitled: leaveBalances.entitled,
      carried: leaveBalances.carriedForward,
      used: leaveBalances.used,
      pending: leaveBalances.pending,
      encashed: leaveBalances.encashed,
    })
    .from(leaveBalances)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
    .innerJoin(employees, eq(employees.id, leaveBalances.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(eq(leaveBalances.orgId, orgId), eq(leaveBalances.fiscalYearId, fiscalYearId), eq(leaveTypes.isEncashable, true), onStrength()))
    .orderBy(asc(employees.employeeCode), asc(leaveTypes.name));
  return rows.map((r) => {
    const available = n(r.entitled) + n(r.carried) - n(r.used) - n(r.pending);
    const cap = r.max === null ? available : Math.min(available, n(r.max));
    return { ...r, available, encashed: n(r.encashed), min: r.min === null ? 0 : n(r.min), max: r.max === null ? null : n(r.max), encashable: Math.max(0, cap) };
  });
}

export async function encash(orgId: string, input: { balanceId: string; days: number; reason: string | null }, by: By) {
  if (!(input.days > 0) || Math.round(input.days * 2) !== input.days * 2) throw new LeaveAdminError("Encash whole or half days.", "days");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ b: leaveBalances, t: leaveTypes })
      .from(leaveBalances)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
      .where(and(eq(leaveBalances.id, input.balanceId), eq(leaveBalances.orgId, orgId)))
      .for("update", { of: leaveBalances })
      .limit(1);
    if (!row) throw new LeaveAdminError("That balance no longer exists.");
    const { b, t } = row;
    if (!t.isEncashable) throw new LeaveAdminError(`${t.name} cannot be encashed.`);
    const available = n(b.entitled) + n(b.carriedForward) - n(b.used) - n(b.pending);
    if (t.minDaysToEncash !== null && input.days < n(t.minDaysToEncash)) throw new LeaveAdminError(`At least ${n(t.minDaysToEncash)} day(s) must be encashed at a time.`, "days");
    if (t.maxDaysToEncash !== null && input.days > n(t.maxDaysToEncash)) throw new LeaveAdminError(`At most ${n(t.maxDaysToEncash)} day(s) can be encashed at a time.`, "days");
    if (input.days > available) throw new LeaveAdminError(`Only ${available} day(s) are available to encash.`, "days");

    // carried days are spent first: they are the oldest
    const fromCarried = Math.min(n(b.carriedForward), input.days);
    const fromEntitled = input.days - fromCarried;
    await tx
      .update(leaveBalances)
      .set({
        carriedForward: d2(n(b.carriedForward) - fromCarried),
        entitled: d2(n(b.entitled) - fromEntitled),
        encashed: d2(n(b.encashed) + input.days),
        updatedAt: new Date(),
      })
      .where(eq(leaveBalances.id, b.id));
    const reference = await nextEncashRef(tx, orgId);
    const [entry] = await tx
      .insert(leaveBalanceAdjustments)
      .values({
        orgId,
        balanceId: b.id,
        employeeId: b.employeeId,
        leaveTypeId: b.leaveTypeId,
        fiscalYearId: b.fiscalYearId,
        kind: "encashment",
        field: "available",
        days: d2(-input.days),
        before: d2(available),
        after: d2(available - input.days),
        reason: [input.reason, fromCarried ? `${fromCarried} from carried forward` : null].filter(Boolean).join(" · ") || null,
        reference,
        byUserId: by.userId,
        byLabel: by.label,
      })
      .returning({ id: leaveBalanceAdjustments.id });
    return { id: entry.id, reference, typeName: t.name, employeeId: b.employeeId };
  });
}

/** Puts encashed days back on the balance, e.g. an entry made in error. */
export async function reverseEncashment(orgId: string, adjustmentId: string, reason: string, by: By) {
  return db.transaction(async (tx) => {
    const [e] = await tx
      .select()
      .from(leaveBalanceAdjustments)
      .where(and(eq(leaveBalanceAdjustments.id, adjustmentId), eq(leaveBalanceAdjustments.orgId, orgId), eq(leaveBalanceAdjustments.kind, "encashment")))
      .for("update")
      .limit(1);
    if (!e) throw new LeaveAdminError("That encashment no longer exists.");
    if (e.reversedAt) throw new LeaveAdminError("That encashment has already been reversed.");
    const days = -n(e.days);
    const [b] = await tx.select().from(leaveBalances).where(eq(leaveBalances.id, e.balanceId)).for("update").limit(1);
    if (!b) throw new LeaveAdminError("The balance it came from no longer exists.");
    const available = n(b.entitled) + n(b.carriedForward) - n(b.used) - n(b.pending);
    await tx
      .update(leaveBalances)
      .set({ entitled: d2(n(b.entitled) + days), encashed: d2(Math.max(0, n(b.encashed) - days)), updatedAt: new Date() })
      .where(eq(leaveBalances.id, b.id));
    await tx.update(leaveBalanceAdjustments).set({ reversedAt: new Date() }).where(eq(leaveBalanceAdjustments.id, e.id));
    await tx.insert(leaveBalanceAdjustments).values({
      orgId,
      balanceId: b.id,
      employeeId: b.employeeId,
      leaveTypeId: b.leaveTypeId,
      fiscalYearId: b.fiscalYearId,
      kind: "encashment_reversal",
      field: "entitled",
      days: d2(days),
      before: d2(available),
      after: d2(available + days),
      reason,
      reference: e.reference,
      reversesId: e.id,
      byUserId: by.userId,
      byLabel: by.label,
    });
    return { reference: e.reference, days };
  });
}

export async function encashmentHistory(orgId: string, fiscalYearId: string) {
  return db
    .select({
      a: leaveBalanceAdjustments,
      employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      employeeCode: employees.employeeCode,
      typeName: leaveTypes.name,
      colour: leaveTypes.colour,
    })
    .from(leaveBalanceAdjustments)
    .innerJoin(employees, eq(employees.id, leaveBalanceAdjustments.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalanceAdjustments.leaveTypeId))
    .where(
      and(
        eq(leaveBalanceAdjustments.orgId, orgId),
        eq(leaveBalanceAdjustments.fiscalYearId, fiscalYearId),
        inArray(leaveBalanceAdjustments.kind, ["encashment", "encashment_reversal"]),
      ),
    )
    .orderBy(desc(leaveBalanceAdjustments.createdAt));
}

export async function fiscalYearList(orgId: string) {
  return db.select().from(fiscalYears).where(eq(fiscalYears.orgId, orgId)).orderBy(desc(fiscalYears.startDate));
}
