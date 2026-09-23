import "server-only";

import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { attendanceDays, overtimeClaims, overtimeRules } from "@/db/schema/attendance";
import { employees } from "@/db/schema/hr";
import { departments } from "@/db/schema/org";
import { addDays, adToBs, formatBsKey, todayInNepal } from "@/lib/bs";
import { publish } from "@/kernel/events";

/**
 * Overtime claims.
 *
 * Attendance already computes overtime minutes for every day from the punches
 * and the shift. A claim is the employee asking to be paid for them, and it is
 * bound to that evidence: it can only be made for a day whose record shows
 * overtime (or work on a weekly off or holiday), for no more than the record
 * shows, within the rule's cap, and inside a claim window. The approver is the
 * employee's supervisor at the moment of claiming; HR (who can see every
 * record) may decide any claim. Nobody decides their own.
 *
 * What a claim is worth is fixed when it is decided: approved minutes times the
 * rate for that kind of day, rounded to the minute. Changing a rate later
 * reprices nothing already decided.
 */

export type DayKind = "working_day" | "weekly_off" | "public_holiday";

export const DAY_KIND_LABEL: Record<DayKind, string> = {
  working_day: "Working day",
  weekly_off: "Weekly off",
  public_holiday: "Public holiday",
};

export const DEFAULT_RULES: Record<DayKind, { multiplier: number; minMinutes: number; maxMinutes: number }> = {
  working_day: { multiplier: 1.5, minMinutes: 30, maxMinutes: 240 },
  weekly_off: { multiplier: 2, minMinutes: 30, maxMinutes: 480 },
  public_holiday: { multiplier: 2, minMinutes: 30, maxMinutes: 480 },
};

/** How far back a day can still be claimed. */
export const CLAIM_WINDOW_DAYS = 45;

export class OvertimeError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "OvertimeError";
  }
}

export type Rule = { multiplier: number; minMinutes: number; maxMinutes: number; custom: boolean };

export async function rulesFor(orgId: string): Promise<Record<DayKind, Rule>> {
  const rows = await db.select().from(overtimeRules).where(eq(overtimeRules.orgId, orgId));
  const out = {} as Record<DayKind, Rule>;
  for (const kind of Object.keys(DEFAULT_RULES) as DayKind[]) {
    const row = rows.find((r) => r.dayKind === kind);
    out[kind] = row
      ? { multiplier: Number(row.multiplier), minMinutes: row.minMinutes, maxMinutes: row.maxMinutes, custom: true }
      : { ...DEFAULT_RULES[kind], custom: false };
  }
  return out;
}

export async function saveRule(
  orgId: string,
  kind: DayKind,
  input: { multiplier: number; minMinutes: number; maxMinutes: number },
  byLabel: string,
) {
  if (!(kind in DEFAULT_RULES)) throw new OvertimeError("Unknown kind of day.");
  if (!(input.multiplier >= 1 && input.multiplier <= 5)) throw new OvertimeError("The rate must be between 1× and 5×.", "multiplier");
  if (!(input.minMinutes >= 0 && input.minMinutes <= 240)) throw new OvertimeError("The minimum is between 0 and 240 minutes.", "minMinutes");
  if (!(input.maxMinutes >= 30 && input.maxMinutes <= 960)) throw new OvertimeError("The daily cap is between 30 and 960 minutes.", "maxMinutes");
  if (input.minMinutes > input.maxMinutes) throw new OvertimeError("The minimum cannot be above the cap.", "minMinutes");
  const values = {
    multiplier: input.multiplier.toFixed(2),
    minMinutes: Math.round(input.minMinutes),
    maxMinutes: Math.round(input.maxMinutes),
    updatedByLabel: byLabel,
    updatedAt: new Date(),
  };
  await db
    .insert(overtimeRules)
    .values({ orgId, dayKind: kind, ...values })
    .onConflictDoUpdate({ target: [overtimeRules.orgId, overtimeRules.dayKind], set: values });
}

/** What an attendance day offers to claim, and on what kind of day. */
function claimable(day: { status: string; otMinutes: number; workedMinutes: number }): { kind: DayKind; minutes: number } {
  if (day.status === "holiday") return { kind: "public_holiday", minutes: day.workedMinutes };
  if (day.status === "weekly_off") return { kind: "weekly_off", minutes: day.workedMinutes };
  return { kind: "working_day", minutes: day.otMinutes };
}

export type EligibleDay = {
  date: string;
  dateBs: string;
  kind: DayKind;
  computedMinutes: number;
  claimableMinutes: number;
  multiplier: number;
};

/** Days in the claim window with overtime on the record and no live claim yet. */
export async function eligibleDays(orgId: string, employeeId: string, today = todayInNepal()): Promise<EligibleDay[]> {
  const from = addDays(today, -CLAIM_WINDOW_DAYS);
  const [rows, rules] = await Promise.all([
    db
      .select({
        date: attendanceDays.date,
        dateBs: attendanceDays.dateBs,
        status: attendanceDays.status,
        otMinutes: attendanceDays.otMinutes,
        workedMinutes: attendanceDays.workedMinutes,
      })
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.orgId, orgId),
          eq(attendanceDays.employeeId, employeeId),
          gte(attendanceDays.date, from),
          lte(attendanceDays.date, today),
          eq(attendanceDays.isLocked, false),
          or(
            sql`${attendanceDays.otMinutes} > 0`,
            and(inArray(attendanceDays.status, ["weekly_off", "holiday"]), sql`${attendanceDays.workedMinutes} > 0`),
          ),
          sql`not exists (select 1 from ${overtimeClaims} c where c.employee_id = ${attendanceDays.employeeId}
                and c.date = ${attendanceDays.date} and c.status in ('pending', 'approved'))`,
        ),
      )
      .orderBy(desc(attendanceDays.date)),
    rulesFor(orgId),
  ]);

  const out: EligibleDay[] = [];
  for (const d of rows) {
    const { kind, minutes } = claimable(d);
    const rule = rules[kind];
    if (minutes < rule.minMinutes) continue;
    out.push({
      date: d.date,
      dateBs: d.dateBs,
      kind,
      computedMinutes: minutes,
      claimableMinutes: Math.min(minutes, rule.maxMinutes),
      multiplier: rule.multiplier,
    });
  }
  return out;
}

/** "2h 30m" — the payloads carry figures already worded for the notification. */
function dur(minutes: number | null | undefined) {
  const m = Math.max(0, Math.round(minutes ?? 0));
  const h = Math.floor(m / 60);
  return h && m % 60 ? `${h}h ${m % 60}m` : h ? `${h}h` : `${m % 60}m`;
}

async function nextReference(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], orgId: string, year: number) {
  const series = `${orgId}:OT-${year}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${series}))`);
  const result = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from ${overtimeClaims} where org_id = ${orgId} and reference like ${`OT-${year}-%`}`,
  );
  return `OT-${year}-${String(Number(result.rows[0]?.n ?? 0) + 1).padStart(4, "0")}`;
}

export async function submitClaim(input: {
  orgId: string;
  employeeId: string;
  date: string;
  minutes: number;
  reason: string;
}) {
  const today = todayInNepal();
  if (input.date > today) throw new OvertimeError("Overtime can only be claimed once it has been worked.", "date");
  if (input.date < addDays(today, -CLAIM_WINDOW_DAYS)) {
    throw new OvertimeError(`Claims must be made within ${CLAIM_WINDOW_DAYS} days of the day worked.`, "date");
  }

  try {
    return await db.transaction(async (tx) => {
      const [day] = await tx
        .select()
        .from(attendanceDays)
        .where(and(eq(attendanceDays.orgId, input.orgId), eq(attendanceDays.employeeId, input.employeeId), eq(attendanceDays.date, input.date)))
        .limit(1);
      if (!day) throw new OvertimeError("There is no attendance record for that day.", "date");
      if (day.isLocked) throw new OvertimeError("That day's attendance is locked for payroll.", "date");

      const { kind, minutes } = claimable(day);
      const rule = (await rulesFor(input.orgId))[kind];
      if (minutes < rule.minMinutes) {
        throw new OvertimeError(`That day shows ${minutes} minutes; overtime starts at ${rule.minMinutes}.`, "minutes");
      }
      const cap = Math.min(minutes, rule.maxMinutes);
      if (!Number.isInteger(input.minutes) || input.minutes < rule.minMinutes || input.minutes > cap) {
        throw new OvertimeError(`Claim between ${rule.minMinutes} and ${cap} minutes for that day.`, "minutes");
      }

      const [emp] = await tx
        .select({ supervisorId: employees.supervisorId })
        .from(employees)
        .where(eq(employees.id, input.employeeId))
        .limit(1);

      const reference = await nextReference(tx, input.orgId, adToBs(input.date).year);
      const [row] = await tx
        .insert(overtimeClaims)
        .values({
          orgId: input.orgId,
          reference,
          employeeId: input.employeeId,
          date: input.date,
          dateBs: day.dateBs ?? formatBsKey(adToBs(input.date)),
          dayKind: kind,
          computedMinutes: minutes,
          claimedMinutes: input.minutes,
          multiplier: rule.multiplier.toFixed(2),
          reason: input.reason,
          approverEmployeeId: emp?.supervisorId ?? null,
        })
        .returning({ id: overtimeClaims.id });

      // in the same transaction: the claim and its "please approve" commit together
      await publish(tx, {
        orgId: input.orgId,
        module: "attendance",
        name: "attendance.overtime.submitted",
        payload: {
          overtimeClaimId: row.id,
          reference,
          employeeId: input.employeeId,
          approverEmployeeId: emp?.supervisorId ?? null,
          date: input.date,
          dateBs: day.dateBs ?? formatBsKey(adToBs(input.date)),
          dayKind: DAY_KIND_LABEL[kind],
          claimed: dur(input.minutes),
          rate: String(rule.multiplier),
          reason: input.reason,
        },
        dedupeKey: `attendance.overtime.submitted:${row.id}`,
      });
      return { id: row.id, reference };
    });
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    if ((e?.code ?? e?.cause?.code) === "23505") throw new OvertimeError("That day already has a claim.", "date");
    throw error;
  }
}

export async function withdrawClaim(orgId: string, employeeId: string, id: string) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(overtimeClaims)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(
        and(
          eq(overtimeClaims.id, id),
          eq(overtimeClaims.orgId, orgId),
          eq(overtimeClaims.employeeId, employeeId),
          eq(overtimeClaims.status, "pending"),
        ),
      )
      .returning();
    if (!rows.length) throw new OvertimeError("Only a pending claim can be withdrawn.");
    const c = rows[0];
    await publish(tx, {
      orgId,
      module: "attendance",
      name: "attendance.overtime.withdrawn",
      payload: {
        overtimeClaimId: c.id,
        reference: c.reference,
        employeeId: c.employeeId,
        approverEmployeeId: c.approverEmployeeId,
        date: c.date,
        dateBs: c.dateBs,
        claimed: dur(c.claimedMinutes),
      },
      dedupeKey: `attendance.overtime.withdrawn:${c.id}`,
    });
    return c.reference;
  });
}

export type Decider = {
  userId: string;
  label: string;
  employeeId: string | null;
  /** Holds attendance.record.viewAll as well as approve: may decide any claim. */
  seesAll: boolean;
};

export async function decideClaim(
  orgId: string,
  id: string,
  decision: "approved" | "rejected",
  input: { approvedMinutes?: number; note: string | null },
  by: Decider,
) {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(overtimeClaims)
      .where(and(eq(overtimeClaims.id, id), eq(overtimeClaims.orgId, orgId)))
      .for("update")
      .limit(1);
    if (!c) throw new OvertimeError("That claim no longer exists.");
    if (c.status !== "pending") throw new OvertimeError("That claim has already been decided.");
    if (by.employeeId && c.employeeId === by.employeeId) throw new OvertimeError("You cannot decide your own overtime.");
    if (!by.seesAll && (!by.employeeId || c.approverEmployeeId !== by.employeeId)) {
      throw new OvertimeError("This claim is routed to somebody else.");
    }
    if (decision === "rejected" && !input.note) throw new OvertimeError("Say why, so the employee knows.", "note");

    let approved: number | null = null;
    let payable: number | null = null;
    if (decision === "approved") {
      approved = input.approvedMinutes ?? c.claimedMinutes;
      if (!Number.isInteger(approved) || approved <= 0 || approved > c.claimedMinutes) {
        throw new OvertimeError(`Approve between 1 and ${c.claimedMinutes} minutes.`, "approvedMinutes");
      }
      payable = Math.round(approved * Number(c.multiplier));
    }

    await tx
      .update(overtimeClaims)
      .set({
        status: decision,
        approvedMinutes: approved,
        payableMinutes: payable,
        decidedByUserId: by.userId,
        decidedByLabel: by.label,
        decidedAt: new Date(),
        decisionNote: input.note,
        updatedAt: new Date(),
      })
      .where(eq(overtimeClaims.id, id));

    await publish(tx, {
      orgId,
      module: "attendance",
      name: decision === "approved" ? "attendance.overtime.approved" : "attendance.overtime.rejected",
      payload: {
        overtimeClaimId: c.id,
        reference: c.reference,
        employeeId: c.employeeId,
        approverEmployeeId: c.approverEmployeeId,
        date: c.date,
        dateBs: c.dateBs,
        dayKind: DAY_KIND_LABEL[c.dayKind],
        claimed: dur(c.claimedMinutes),
        approved: approved === null ? null : dur(approved),
        payable: payable === null ? null : dur(payable),
        rate: String(Number(c.multiplier)),
        comment: input.note,
        decidedByUserId: by.userId,
      },
      dedupeKey: `attendance.overtime.${decision}:${c.id}`,
    });
    return { reference: c.reference, employeeId: c.employeeId };
  });
}

const claimColumns = {
  id: overtimeClaims.id,
  reference: overtimeClaims.reference,
  employeeId: overtimeClaims.employeeId,
  date: overtimeClaims.date,
  dateBs: overtimeClaims.dateBs,
  dayKind: overtimeClaims.dayKind,
  computedMinutes: overtimeClaims.computedMinutes,
  claimedMinutes: overtimeClaims.claimedMinutes,
  approvedMinutes: overtimeClaims.approvedMinutes,
  payableMinutes: overtimeClaims.payableMinutes,
  multiplier: overtimeClaims.multiplier,
  reason: overtimeClaims.reason,
  status: overtimeClaims.status,
  decidedByLabel: overtimeClaims.decidedByLabel,
  decisionNote: overtimeClaims.decisionNote,
  createdAt: overtimeClaims.createdAt,
  employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
  employeeCode: employees.employeeCode,
  photoFileId: employees.photoFileId,
  department: departments.name,
};

export type ClaimRow = Awaited<ReturnType<typeof myClaims>>[number];

export async function myClaims(orgId: string, employeeId: string, limit = 50) {
  return db
    .select(claimColumns)
    .from(overtimeClaims)
    .innerJoin(employees, eq(employees.id, overtimeClaims.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(eq(overtimeClaims.orgId, orgId), eq(overtimeClaims.employeeId, employeeId)))
    .orderBy(desc(overtimeClaims.date))
    .limit(limit);
}

/** Pending claims this person may decide: routed to them, or all of them for HR. */
export async function approvalQueue(orgId: string, by: Decider) {
  return db
    .select(claimColumns)
    .from(overtimeClaims)
    .innerJoin(employees, eq(employees.id, overtimeClaims.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(
      and(
        eq(overtimeClaims.orgId, orgId),
        eq(overtimeClaims.status, "pending"),
        isNull(employees.deletedAt),
        by.employeeId ? sql`${overtimeClaims.employeeId} <> ${by.employeeId}` : undefined,
        by.seesAll ? undefined : eq(overtimeClaims.approverEmployeeId, by.employeeId ?? "00000000-0000-0000-0000-000000000000"),
      ),
    )
    .orderBy(overtimeClaims.date);
}

/** Every claim in a date range, for the register and its export. */
export async function register(orgId: string, from: string, to: string, status: string | null) {
  return db
    .select(claimColumns)
    .from(overtimeClaims)
    .innerJoin(employees, eq(employees.id, overtimeClaims.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(
      and(
        eq(overtimeClaims.orgId, orgId),
        gte(overtimeClaims.date, from),
        lte(overtimeClaims.date, to),
        isNull(employees.deletedAt),
        status ? eq(overtimeClaims.status, status as "pending") : undefined,
      ),
    )
    .orderBy(desc(overtimeClaims.date), overtimeClaims.reference);
}
