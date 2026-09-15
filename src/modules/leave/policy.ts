import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { leaveTypes } from "@/db/schema/leave";
import {
  leaveGroups,
  leaveSalaryEffects,
  leaveTypeEntitlements,
} from "@/db/schema/leave-policy";
import { employees } from "@/db/schema/hr";

/**
 * Leave policy resolution.
 *
 * Every question the rest of the product asks about a leave *type* is answered
 * here, and the answers are pure functions of policy rows — no request state, no
 * balances. That separation is what makes the rules testable without a fixture
 * of half-approved requests, and it is why `pnpm check:leave` can assert them
 * directly.
 */

export type LeaveNature =
  | "official_work"
  | "paid"
  | "unpaid"
  | "absent"
  | "substitute"
  | "holiday"
  | "transit";

/** Everything a caller needs about a type, resolved for one employee. */
export type ResolvedPolicy = {
  leaveTypeId: string;
  code: string;
  name: string;
  colour: string;
  nature: LeaveNature;
  paidPercent: number;
  /** Entitlement for this employee's employment type, falling back to the type default. */
  entitledDays: number;
  /** Where that number came from — shown on screen, because staff query it. */
  entitlementSource: "employment_type" | "leave_type_default";
  deductsBalance: boolean;
  allowHalfDay: boolean;
  excludesHolidays: boolean;
  excludesWeeklyOffs: boolean;
  minNoticeDays: number;
  maxConsecutiveDays: number | null;
  approvalLevels: number;
  levelLimits: (number | null)[];
  isEncashable: boolean;
  lapseType: "none" | "monthly" | "yearly" | "service_period";
  leaveOrder: number;
};

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolves every active leave type for one employee.
 *
 * Filters the type list the way the legacy Leave Request screen did — gender,
 * marital status, and employment-type entitlement — so the picker only ever
 * offers leave the employee can actually take. A type filtered out here is one
 * fewer request that gets raised and rejected.
 */
export async function policiesForEmployee(
  orgId: string,
  employeeId: string,
): Promise<ResolvedPolicy[]> {
  const [employee] = await db
    .select({
      gender: employees.gender,
      maritalStatus: employees.maritalStatus,
      employmentTypeId: employees.employmentTypeId,
    })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.orgId, orgId)))
    .limit(1);

  if (!employee) return [];

  const types = await db
    .select()
    .from(leaveTypes)
    .where(and(eq(leaveTypes.orgId, orgId), eq(leaveTypes.isActive, true)))
    .orderBy(asc(leaveTypes.leaveOrder), asc(leaveTypes.name));

  const entitlements = employee.employmentTypeId
    ? await db
        .select({
          leaveTypeId: leaveTypeEntitlements.leaveTypeId,
          daysAllowed: leaveTypeEntitlements.daysAllowed,
        })
        .from(leaveTypeEntitlements)
        .where(
          and(
            eq(leaveTypeEntitlements.orgId, orgId),
            eq(leaveTypeEntitlements.employmentTypeId, employee.employmentTypeId),
          ),
        )
    : [];

  const byType = new Map(entitlements.map((e) => [e.leaveTypeId, num(e.daysAllowed)]));

  return types
    .filter((t) => t.appliesTo === "all" || t.appliesTo === employee.gender)
    .filter((t) => !t.maritalStatus || t.maritalStatus === employee.maritalStatus)
    .map((t): ResolvedPolicy => {
      const override = byType.get(t.id);
      return {
        leaveTypeId: t.id,
        code: t.code,
        name: t.name,
        colour: t.colour,
        nature: t.nature,
        paidPercent: num(t.paidPercent, 100),
        entitledDays: override ?? num(t.daysPerYear),
        entitlementSource: override === undefined ? "leave_type_default" : "employment_type",
        deductsBalance: t.deductsBalance,
        allowHalfDay: t.allowHalfDay,
        excludesHolidays: t.excludesHolidays,
        excludesWeeklyOffs: t.excludesWeeklyOffs,
        minNoticeDays: t.minNoticeDays,
        maxConsecutiveDays: t.maxConsecutiveDays,
        approvalLevels: Math.max(1, t.approvalLevels),
        levelLimits: [t.level1LimitDays, t.level2LimitDays, t.level3LimitDays, t.level4LimitDays],
        isEncashable: t.isEncashable,
        lapseType: t.lapseType,
        leaveOrder: t.leaveOrder,
      };
    });
}

/**
 * How many approval levels a request of this length actually needs.
 *
 * The legacy rule, restated: a level with a day limit can only approve up to
 * that limit, so a longer request must reach the level above it. Level 4 is the
 * final authority and has no ceiling.
 *
 *   limits [5, 10, 15] · 3 days  → 1 level   (the supervisor can sign it)
 *   limits [5, 10, 15] · 8 days  → 2 levels  (past level 1's ceiling)
 *   limits [5, 10, 15] · 40 days → 4 levels  (past every ceiling)
 *
 * Returning the level *count* rather than mutating the chain keeps this a pure
 * function, which is why it can be asserted directly.
 */
export function levelsRequired(policy: ResolvedPolicy, days: number): number {
  const declared = Math.max(1, policy.approvalLevels);
  const limits = policy.levelLimits;

  // No ceilings configured: the type's own level count is the answer.
  if (limits.every((l) => l === null || l === undefined)) return declared;

  for (let level = 1; level <= 4; level++) {
    const limit = limits[level - 1];
    if (limit === null || limit === undefined) continue;
    if (days <= limit) return Math.max(declared, level);
  }

  // Longer than every configured ceiling — it goes to the highest level defined.
  const highest = limits.reduce<number>(
    (best, limit, index) => (limit === null || limit === undefined ? best : index + 1),
    declared,
  );
  return Math.max(declared, Math.min(4, highest + 1));
}

/* --------------------------------------------------------------- payroll */

/** What payroll needs to know about one leave day. */
export type PayEffect = {
  leaveTypeId: string;
  nature: LeaveNature;
  /** 0-100, the default for any head without its own override. */
  paidPercent: number;
  /** Salary head code → percent paid. Payroll ignores codes it does not know. */
  headOverrides: Record<string, number>;
};

/**
 * The pay treatment of every leave type, in one query pair.
 *
 * Payroll asks for this once per run rather than per employee per day — a
 * monthly run over 500 staff would otherwise be tens of thousands of lookups of
 * data that changes twice a year.
 */
export async function payEffects(orgId: string): Promise<Map<string, PayEffect>> {
  const [types, overrides] = await Promise.all([
    db
      .select({
        id: leaveTypes.id,
        nature: leaveTypes.nature,
        paidPercent: leaveTypes.paidPercent,
      })
      .from(leaveTypes)
      .where(eq(leaveTypes.orgId, orgId)),
    db
      .select({
        leaveTypeId: leaveSalaryEffects.leaveTypeId,
        salaryHeadCode: leaveSalaryEffects.salaryHeadCode,
        payPercent: leaveSalaryEffects.payPercent,
      })
      .from(leaveSalaryEffects)
      .where(eq(leaveSalaryEffects.orgId, orgId)),
  ]);

  const out = new Map<string, PayEffect>();
  for (const t of types) {
    out.set(t.id, {
      leaveTypeId: t.id,
      nature: t.nature,
      paidPercent: num(t.paidPercent, 100),
      headOverrides: {},
    });
  }
  for (const o of overrides) {
    const entry = out.get(o.leaveTypeId);
    if (entry) entry.headOverrides[o.salaryHeadCode] = num(o.payPercent, 100);
  }
  return out;
}

/* ------------------------------------------------------------ attendance */

/**
 * The attendance status a leave nature produces.
 *
 * Declared here, next to the natures, but *applied* by attendance — leave states
 * the meaning, attendance decides what to write. That is the difference between
 * a shared vocabulary and a module reaching into another module's table.
 */
export const NATURE_TO_ATTENDANCE: Record<
  LeaveNature,
  "on_leave" | "present" | "absent" | "holiday"
> = {
  official_work: "present",
  transit: "present",
  paid: "on_leave",
  unpaid: "on_leave",
  substitute: "on_leave",
  absent: "absent",
  holiday: "holiday",
};

/* ---------------------------------------------------------------- groups */

export async function listLeaveGroups(orgId: string) {
  return db
    .select()
    .from(leaveGroups)
    .where(eq(leaveGroups.orgId, orgId))
    .orderBy(asc(leaveGroups.sortOrder), asc(leaveGroups.code));
}

/** Entitlement matrix for the policy screen: type × employment type. */
export async function entitlementMatrix(orgId: string, leaveTypeIds: string[]) {
  if (leaveTypeIds.length === 0) return [];
  return db
    .select()
    .from(leaveTypeEntitlements)
    .where(
      and(
        eq(leaveTypeEntitlements.orgId, orgId),
        inArray(leaveTypeEntitlements.leaveTypeId, leaveTypeIds),
      ),
    );
}
