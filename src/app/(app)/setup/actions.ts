"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog, fiscalYears, holidays, periodLocks } from "@/db/schema/core";
import { attendanceDays } from "@/db/schema/attendance";
import { cacheTags, invalidate } from "@/kernel/cache";
import { requirePermission } from "@/lib/session";
import { adToBs, bsToAd, daysInBsMonth, formatBsKey, parseBsKey, addDays } from "@/lib/bs";

export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[issue.path.join(".") || "form"] ??= issue.message;
  return out;
}

/* ---------------------------------------------------------- fiscal years */

const fiscalYearSchema = z.object({
  /** The BS year the fiscal year opens in — 2084 means 2084/85. */
  startYear: z.coerce
    .number()
    .int()
    .min(2000, "Outside the published calendar")
    .max(2099, "Outside the published calendar"),
  makeCurrent: z.coerce.boolean(),
});

/**
 * Creates a Nepali fiscal year from its opening BS year.
 *
 * The dates are derived rather than typed: a fiscal year always runs Shrawan 1 to
 * the day before the next Shrawan 1, and the Bikram Sambat calendar decides how
 * many days that is. Letting somebody key the boundaries in by hand is how a year
 * ends up 364 days long and every pro-rata calculation drifts.
 */
export async function createFiscalYear(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const viewer = await requirePermission("setup.fiscalYear.manage");

  const parsed = fiscalYearSchema.safeParse({
    startYear: formData.get("startYear"),
    makeCurrent: formData.get("makeCurrent") === "on",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }

  const { startYear, makeCurrent } = parsed.data;
  const code = `${startYear}/${String(startYear + 1).slice(-2)}`;

  let startDate: string;
  let endDate: string;
  try {
    startDate = bsToAd({ year: startYear, month: 4, day: 1 });
    endDate = addDays(bsToAd({ year: startYear + 1, month: 4, day: 1 }), -1);
  } catch {
    return {
      ok: false,
      message: "That year is outside the published Bikram Sambat calendar (2000–2100).",
      fieldErrors: { startYear: "Outside the calendar" },
    };
  }

  const clash = await db
    .select({ id: fiscalYears.id })
    .from(fiscalYears)
    .where(and(eq(fiscalYears.orgId, viewer.orgId), eq(fiscalYears.code, code)))
    .limit(1);
  if (clash.length) {
    return {
      ok: false,
      message: `Fiscal year ${code} already exists.`,
      fieldErrors: { startYear: "Already defined" },
    };
  }

  await db.transaction(async (tx) => {
    // Only one year can be current — the database enforces it with a partial
    // unique index, so the clear and the set have to be one transaction.
    if (makeCurrent) {
      await tx
        .update(fiscalYears)
        .set({ isCurrent: false })
        .where(and(eq(fiscalYears.orgId, viewer.orgId), eq(fiscalYears.isCurrent, true)));
    }

    await tx.insert(fiscalYears).values({
      orgId: viewer.orgId,
      code,
      startDate,
      endDate,
      startDateBs: formatBsKey({ year: startYear, month: 4, day: 1 }),
      endDateBs: formatBsKey(adToBs(endDate)),
      isCurrent: makeCurrent,
      isClosed: false,
    });
  });

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "create",
    entityType: "fiscal_year",
    summary: `Created fiscal year ${code}${makeCurrent ? " and made it current" : ""}`,
  });

  invalidate(cacheTags.fiscalYear(viewer.orgId));

  revalidatePath("/setup/fiscal-years");
  return { ok: true, message: `Fiscal year ${code} created (${startDate} to ${endDate}).` };
}

export async function setCurrentFiscalYear(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const viewer = await requirePermission("setup.fiscalYear.manage");
  const id = String(formData.get("fiscalYearId") ?? "");
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Unknown fiscal year." };

  const [target] = await db
    .select()
    .from(fiscalYears)
    .where(and(eq(fiscalYears.id, id), eq(fiscalYears.orgId, viewer.orgId)))
    .limit(1);
  if (!target) return { ok: false, message: "That fiscal year no longer exists." };
  if (target.isClosed) {
    return { ok: false, message: `${target.code} is closed. Reopen it before making it current.` };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(fiscalYears)
      .set({ isCurrent: false })
      .where(and(eq(fiscalYears.orgId, viewer.orgId), ne(fiscalYears.id, id)));
    await tx.update(fiscalYears).set({ isCurrent: true }).where(eq(fiscalYears.id, id));
  });

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "fiscal_year",
    entityId: id,
    summary: `Made ${target.code} the current fiscal year`,
  });

  invalidate(cacheTags.fiscalYear(viewer.orgId));

  revalidatePath("/setup/fiscal-years");
  revalidatePath("/dashboard");
  return { ok: true, message: `${target.code} is now the current fiscal year.` };
}

/* ------------------------------------------------------------ period lock */

const lockSchema = z.object({
  fiscalYearId: z.uuid(),
  module: z.enum(["attendance", "leave", "payroll"]),
  bsMonth: z.coerce.number().int().min(1).max(12),
  action: z.enum(["lock", "unlock"]),
});

/**
 * Locks or unlocks one BS month for one module.
 *
 * Locking attendance also stamps `is_locked` on every day in the period, so the
 * correction workflow refuses new requests without having to join to this table
 * on every submission. The two writes are one transaction — a lock row without
 * the stamped days would let corrections through against a closed period.
 */
export async function setPeriodLock(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const viewer = await requirePermission("setup.fiscalYear.manage");

  const parsed = lockSchema.safeParse({
    fiscalYearId: formData.get("fiscalYearId"),
    module: formData.get("module"),
    bsMonth: formData.get("bsMonth"),
    action: formData.get("action"),
  });
  if (!parsed.success) return { ok: false, message: "That period could not be read." };
  const { fiscalYearId, module, bsMonth, action } = parsed.data;

  const [fy] = await db
    .select()
    .from(fiscalYears)
    .where(and(eq(fiscalYears.id, fiscalYearId), eq(fiscalYears.orgId, viewer.orgId)))
    .limit(1);
  if (!fy) return { ok: false, message: "That fiscal year no longer exists." };

  // Shrawan (4) to Ashadh (3): months 4-12 fall in the opening BS year, 1-3 in the next
  const startYear = Number(fy.code.split("/")[0]);
  const bsYear = bsMonth >= 4 ? startYear : startYear + 1;

  let from: string;
  let to: string;
  try {
    from = bsToAd({ year: bsYear, month: bsMonth, day: 1 });
    to = bsToAd({ year: bsYear, month: bsMonth, day: daysInBsMonth(bsYear, bsMonth) });
  } catch {
    return { ok: false, message: "That month is outside the published calendar." };
  }

  await db.transaction(async (tx) => {
    if (action === "lock") {
      await tx
        .insert(periodLocks)
        .values({
          orgId: viewer.orgId,
          fiscalYearId,
          module,
          bsMonth,
          lockedBy: viewer.name,
        })
        .onConflictDoNothing();
    } else {
      await tx
        .delete(periodLocks)
        .where(
          and(
            eq(periodLocks.orgId, viewer.orgId),
            eq(periodLocks.fiscalYearId, fiscalYearId),
            eq(periodLocks.module, module),
            eq(periodLocks.bsMonth, bsMonth),
          ),
        );
    }

    if (module === "attendance") {
      await tx
        .update(attendanceDays)
        .set({ isLocked: action === "lock" })
        .where(
          and(
            eq(attendanceDays.orgId, viewer.orgId),
            gte(attendanceDays.date, from),
            lte(attendanceDays.date, to),
          ),
        );
    }
  });

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "period_lock",
    summary: `${action === "lock" ? "Locked" : "Unlocked"} ${module} for month ${bsMonth} of ${fy.code}`,
  });

  invalidate(cacheTags.fiscalYear(viewer.orgId));

  revalidatePath("/setup/fiscal-years");
  revalidatePath("/attendance/monthly");
  return {
    ok: true,
    message: `${module} ${action === "lock" ? "locked" : "unlocked"} for month ${bsMonth} of ${fy.code}.`,
  };
}

/* --------------------------------------------------------------- holidays */

const holidaySchema = z.object({
  dateBs: z.string().trim().min(1, "Pick a date"),
  name: z.string().trim().min(2, "Give the holiday a name").max(120),
  nameNepali: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  appliesToGender: z
    .union([z.enum(["male", "female"]), z.literal("")])
    .transform((v) => (v === "" ? null : v)),
});

export async function createHoliday(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requirePermission("setup.holiday.manage");

  const parsed = holidaySchema.safeParse({
    dateBs: formData.get("dateBs"),
    name: formData.get("name"),
    nameNepali: formData.get("nameNepali") ?? "",
    appliesToGender: formData.get("appliesToGender") ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }

  const bs = parseBsKey(parsed.data.dateBs);
  if (!bs) {
    return {
      ok: false,
      message: "That is not a date in the published Bikram Sambat calendar.",
      fieldErrors: { dateBs: "Use YYYY-MM-DD within BS 2000–2100" },
    };
  }

  const date = bsToAd(bs);
  const existing = await db
    .select({ name: holidays.name })
    .from(holidays)
    .where(
      and(
        eq(holidays.orgId, viewer.orgId),
        eq(holidays.date, date),
        eq(holidays.name, parsed.data.name),
      ),
    )
    .limit(1);
  if (existing.length) {
    return { ok: false, message: "That holiday is already recorded on that date." };
  }

  await db.insert(holidays).values({
    orgId: viewer.orgId,
    date,
    dateBs: formatBsKey(bs),
    name: parsed.data.name,
    nameNepali: parsed.data.nameNepali,
    appliesToGender: parsed.data.appliesToGender,
    isActive: true,
  });

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "create",
    entityType: "holiday",
    summary: `Added holiday ${parsed.data.name} on ${formatBsKey(bs)}`,
  });

  revalidatePath("/setup/holidays");
  revalidatePath("/attendance/monthly");
  revalidatePath("/leave/calendar");
  return { ok: true, message: `${parsed.data.name} added on ${formatBsKey(bs)} BS.` };
}

export async function toggleHoliday(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requirePermission("setup.holiday.manage");
  const id = String(formData.get("holidayId") ?? "");
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Unknown holiday." };

  const [row] = await db
    .select()
    .from(holidays)
    .where(and(eq(holidays.id, id), eq(holidays.orgId, viewer.orgId)))
    .limit(1);
  if (!row) return { ok: false, message: "That holiday no longer exists." };

  await db.update(holidays).set({ isActive: !row.isActive }).where(eq(holidays.id, id));

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "holiday",
    entityId: id,
    summary: `${row.isActive ? "Disabled" : "Enabled"} holiday ${row.name}`,
    changes: { isActive: { from: row.isActive, to: !row.isActive } },
  });

  revalidatePath("/setup/holidays");
  revalidatePath("/attendance/monthly");
  return {
    ok: true,
    message: `${row.name} ${row.isActive ? "disabled" : "enabled"}. Day counting updates immediately.`,
  };
}
