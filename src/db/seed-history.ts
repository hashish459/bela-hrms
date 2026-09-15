/**
 * A complete previous fiscal year, so the whole product can be seen working.
 *
 * The main seed produces the *current* year: seventy-five days of attendance and
 * a handful of open requests. That demonstrates the screens but not the
 * lifecycle — and the lifecycle is where an HRMS either holds together or does
 * not. A closed year exercises the things a live demo never reaches:
 *
 *   • twelve Bikram Sambat months of attendance, so month navigation, the
 *     monthly sheet and the composition charts all have something behind them
 *   • leave taken, approved, rejected and withdrawn across the year, with the
 *     balances moved to match, so the register and the reports agree
 *   • attendance corrections that were raised and decided, so the approval
 *     ledger has history rather than only pending rows
 *   • every period locked, so the "this month is closed" refusal can be seen
 *     rather than described
 *   • a year-end close — encashment, lapse, carry-forward — which is the single
 *     hardest thing to believe without data
 *
 * Everything is generated from the same pure functions the application uses:
 * `computeDay` for attendance, the published BS calendar for dates. A demo whose
 * numbers were typed by hand is a demo that disagrees with the software the
 * moment anybody adds them up.
 *
 * Idempotent. Re-running tops up rather than duplicating, and it never touches
 * the current fiscal year.
 *
 *   pnpm db:seed:history
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import { auditLog, fiscalYears, holidays, organizations, periodLocks } from "./schema/core";
import { employees } from "./schema/hr";
import { approvalSteps } from "./schema/approvals";
import { leaveBalances, leaveRequests, leaveTypes } from "./schema/leave";
import { leaveTypeEntitlements } from "./schema/leave-policy";
import { attendanceDays, attendanceRequests, shiftAssignments, shifts } from "./schema/attendance";
import { notices } from "./schema/selfservice";
import { computeDay, fromMinutes, type ShiftRule } from "@/lib/attendance/calc";
import { addDays, adToBs, bsToAd, daysInBsMonth, formatBsKey, isSaturday } from "@/lib/bs";

function log(step: string, detail = "") {
  console.log(`  ${step.padEnd(28)} ${detail}`);
}

/**
 * Deterministic pseudo-random.
 *
 * The same seed string always produces the same sequence, so the demo is
 * reproducible: a screenshot taken today matches the database rebuilt next
 * month, and a bug found in the data can be found again.
 */
function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

/** Fiscal-year month order: Shrawan (4) through Ashadh (3). */
const FISCAL_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

/**
 * The public holidays of a Nepali year, by Bikram Sambat month and day.
 *
 * Fixed BS dates rather than converted Gregorian ones: Dashain falls on Ashwin
 * 22 whatever that is in the Gregorian calendar, and hard-coding the Gregorian
 * date would put it in the wrong week of the wrong year.
 */
const HOLIDAY_CALENDAR: { month: number; day: number; name: string; nameNepali: string }[] = [
  { month: 1, day: 1, name: "Nepali New Year", nameNepali: "नयाँ वर्ष" },
  { month: 1, day: 18, name: "Loktantra Diwas", nameNepali: "लोकतन्त्र दिवस" },
  { month: 2, day: 15, name: "Buddha Jayanti", nameNepali: "बुद्ध जयन्ती" },
  { month: 3, day: 15, name: "Republic Day", nameNepali: "गणतन्त्र दिवस" },
  { month: 4, day: 20, name: "Janai Purnima", nameNepali: "जनै पूर्णिमा" },
  { month: 4, day: 21, name: "Gai Jatra", nameNepali: "गाईजात्रा" },
  { month: 5, day: 8, name: "Krishna Janmashtami", nameNepali: "कृष्ण जन्माष्टमी" },
  { month: 5, day: 17, name: "Haritalika Teej", nameNepali: "हरितालिका तीज" },
  { month: 6, day: 3, name: "Constitution Day", nameNepali: "संविधान दिवस" },
  { month: 6, day: 22, name: "Ghatasthapana", nameNepali: "घटस्थापना" },
  { month: 6, day: 28, name: "Fulpati", nameNepali: "फूलपाती" },
  { month: 6, day: 29, name: "Maha Ashtami", nameNepali: "महाअष्टमी" },
  { month: 6, day: 30, name: "Maha Nawami", nameNepali: "महानवमी" },
  { month: 7, day: 1, name: "Vijaya Dashami", nameNepali: "विजया दशमी" },
  { month: 7, day: 2, name: "Ekadashi", nameNepali: "एकादशी" },
  { month: 7, day: 17, name: "Laxmi Puja", nameNepali: "लक्ष्मी पूजा" },
  { month: 7, day: 19, name: "Govardhan Puja", nameNepali: "गोवर्धन पूजा" },
  { month: 7, day: 20, name: "Bhai Tika", nameNepali: "भाइटीका" },
  { month: 8, day: 5, name: "Chhath Parva", nameNepali: "छठ पर्व" },
  { month: 9, day: 15, name: "Tamu Lhosar", nameNepali: "तमु ल्होसार" },
  { month: 10, day: 1, name: "Maghe Sankranti", nameNepali: "माघे संक्रान्ति" },
  { month: 10, day: 16, name: "Sonam Lhosar", nameNepali: "सोनाम ल्होसार" },
  { month: 11, day: 7, name: "Maha Shivaratri", nameNepali: "महाशिवरात्रि" },
  { month: 11, day: 20, name: "Fagu Purnima", nameNepali: "फागु पूर्णिमा" },
  { month: 12, day: 8, name: "Ghode Jatra", nameNepali: "घोडेजात्रा" },
  { month: 12, day: 25, name: "Ram Nawami", nameNepali: "राम नवमी" },
];

async function main() {
  console.log("\nSeeding a complete previous fiscal year\n");

  const [org] = await db.select().from(organizations).limit(1);
  if (!org) throw new Error("No organisation. Run pnpm db:seed first.");
  const orgId = org.id;

  const years = await db
    .select()
    .from(fiscalYears)
    .where(eq(fiscalYears.orgId, orgId))
    .orderBy(asc(fiscalYears.startDate));

  const current = years.find((y) => y.isCurrent);
  const previous = years.filter((y) => !y.isCurrent && y.startDate < (current?.startDate ?? "")).at(-1);

  if (!current || !previous) {
    throw new Error("Expected a current and a previous fiscal year. Run pnpm db:seed first.");
  }

  const bsStart = adToBs(previous.startDate);
  log("fiscal year", `${previous.code} — ${previous.startDate} to ${previous.endDate}`);

  const staff = await db
    .select()
    .from(employees)
    .where(eq(employees.orgId, orgId))
    .orderBy(asc(employees.employeeCode));
  if (staff.length === 0) throw new Error("No employees. Run pnpm db:seed first.");

  /* ------------------------------------------------------------- holidays */

  const holidayRows = HOLIDAY_CALENDAR.map((h) => {
    // Shrawan to Chaitra fall in the fiscal year's opening BS year; Baishakh to
    // Ashadh in the next one. Getting this backwards puts New Year in the wrong
    // fiscal year, which is the classic Nepali-calendar off-by-one.
    const year = h.month >= 4 ? bsStart.year : bsStart.year + 1;
    if (h.day > daysInBsMonth(year, h.month)) return null;
    const bs = { year, month: h.month, day: h.day };
    return {
      orgId,
      date: bsToAd(bs),
      dateBs: formatBsKey(bs),
      name: h.name,
      nameNepali: h.nameNepali,
      isActive: true,
    };
  }).filter((h): h is NonNullable<typeof h> => h !== null);

  const inYear = holidayRows.filter(
    (h) => h.date >= previous.startDate && h.date <= previous.endDate,
  );
  if (inYear.length) await db.insert(holidays).values(inYear).onConflictDoNothing();
  log("holidays", `${inYear.length} in ${previous.code}`);

  const holidaySet = new Set(
    (
      await db
        .select({ date: holidays.date })
        .from(holidays)
        .where(
          and(
            eq(holidays.orgId, orgId),
            sql`${holidays.date} BETWEEN ${previous.startDate} AND ${previous.endDate}`,
          ),
        )
    ).map((h) => h.date),
  );

  /* ------------------------------------------------------------- balances */

  const types = await db
    .select()
    .from(leaveTypes)
    .where(and(eq(leaveTypes.orgId, orgId), eq(leaveTypes.isActive, true)));

  const entitlements = await db
    .select()
    .from(leaveTypeEntitlements)
    .where(eq(leaveTypeEntitlements.orgId, orgId));

  const entitlementFor = (leaveTypeId: string, employmentTypeId: string | null) => {
    const row = entitlements.find(
      (e) => e.leaveTypeId === leaveTypeId && e.employmentTypeId === employmentTypeId,
    );
    if (row) return Number(row.daysAllowed);
    return Number(types.find((t) => t.id === leaveTypeId)?.daysPerYear ?? 0);
  };

  const deductible = types.filter((t) => t.deductsBalance);

  const balanceRows = staff.flatMap((emp) => {
    // Years of service before this one, so a long-serving employee opens the
    // year with an accumulated balance. Without it nothing can ever exceed an
    // accumulation cap and the encashment path is never exercised — which is
    // exactly the bug this seeder existed to avoid in the first place.
    const priorYears = Math.max(
      0,
      new Date(previous.startDate).getFullYear() - new Date(emp.dateOfJoin).getFullYear(),
    );

    return deductible
      .filter((t) => t.appliesTo === "all" || t.appliesTo === emp.gender)
      .filter((t) => !t.maritalStatus || t.maritalStatus === emp.maritalStatus)
      .map((t) => {
        const entitled = entitlementFor(t.id, emp.employmentTypeId);
        const cap = Number(t.maxCarryForwardDays ?? t.maxAccumulationDays ?? 0);
        const accrued = t.lapseType === "none" ? priorYears * Math.round(entitled * 0.45) : 0;
        const carried = cap > 0 ? Math.min(accrued, cap) : accrued;

        return {
          orgId,
          employeeId: emp.id,
          leaveTypeId: t.id,
          fiscalYearId: previous.id,
          entitled: String(entitled),
          carriedForward: String(carried),
          used: "0",
          pending: "0",
        };
      });
  });

  if (balanceRows.length) {
    // Upsert rather than ignore: a re-run must be able to correct an opening
    // balance, otherwise fixing the generator here changes nothing on a database
    // that has already been seeded once.
    for (const row of balanceRows) {
      await db
        .insert(leaveBalances)
        .values(row)
        .onConflictDoUpdate({
          target: [
            leaveBalances.employeeId,
            leaveBalances.leaveTypeId,
            leaveBalances.fiscalYearId,
          ],
          set: { entitled: row.entitled, carriedForward: row.carriedForward },
        });
    }
  }
  log("opening balances", `${balanceRows.length} rows for ${previous.code}`);

  /* -------------------------------------------------------- leave requests */

  const existingRefs = new Set(
    (
      await db
        .select({ reference: leaveRequests.reference })
        .from(leaveRequests)
        .where(eq(leaveRequests.orgId, orgId))
    ).map((r) => r.reference),
  );

  type PlannedLeave = {
    employeeId: string;
    supervisorId: string | null;
    leaveTypeId: string;
    from: string;
    to: string;
    days: number;
    status: "approved" | "rejected" | "cancelled";
    reason: string;
  };

  const planned: PlannedLeave[] = [];
  let sequence = 0;

  for (const emp of staff) {
    const rand = seededRandom(`${previous.code}:${emp.employeeCode}`);
    const available = deductible.filter(
      (t) =>
        (t.appliesTo === "all" || t.appliesTo === emp.gender) &&
        (!t.maritalStatus || t.maritalStatus === emp.maritalStatus),
    );
    if (available.length === 0) continue;

    // Three to seven absences a year: enough to make the register and the
    // balance meters interesting, few enough to stay believable.
    const count = 3 + Math.floor(rand() * 5);

    for (let n = 0; n < count; n++) {
      const type = available[Math.floor(rand() * available.length)];
      const month = FISCAL_MONTHS[Math.floor(rand() * FISCAL_MONTHS.length)];
      const bsYear = month >= 4 ? bsStart.year : bsStart.year + 1;
      const maxDay = daysInBsMonth(bsYear, month);
      if (!maxDay) continue;

      const startDay = 1 + Math.floor(rand() * (maxDay - 4));
      const span = 1 + Math.floor(rand() * 3);
      const from = bsToAd({ year: bsYear, month, day: startDay });
      const to = addDays(from, span - 1);

      if (from < emp.dateOfJoin) continue;
      if (from < previous.startDate || to > previous.endDate) continue;

      // Chargeable days exclude Saturdays and holidays — the same rule the
      // running service applies, so the balances below match what the app would
      // have computed had these been submitted through the UI.
      let days = 0;
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (!isSaturday(d) && !holidaySet.has(d)) days += 1;
      }
      if (days === 0) continue;

      const roll = rand();
      const status: PlannedLeave["status"] =
        roll > 0.88 ? "rejected" : roll > 0.82 ? "cancelled" : "approved";

      planned.push({
        employeeId: emp.id,
        supervisorId: emp.supervisorId,
        leaveTypeId: type.id,
        from,
        to,
        days,
        status,
        reason: REASONS[Math.floor(rand() * REASONS.length)],
      });
    }
  }

  // Overlaps would be refused by the real service, so they must not exist in
  // seeded data either — a demo that contains states the software forbids is
  // worse than no demo.
  const claimed = new Set<string>();
  const accepted = planned.filter((p) => {
    if (p.status === "rejected") return true; // a rejected request never blocked the dates
    for (let d = p.from; d <= p.to; d = addDays(d, 1)) {
      if (claimed.has(`${p.employeeId}:${d}`)) return false;
    }
    for (let d = p.from; d <= p.to; d = addDays(d, 1)) claimed.add(`${p.employeeId}:${d}`);
    return true;
  });

  const requestRows = accepted.map((p) => {
    sequence += 1;
    const bsFrom = adToBs(p.from);
    return {
      orgId,
      reference: `LV-${bsStart.year}-H${String(sequence).padStart(4, "0")}`,
      employeeId: p.employeeId,
      leaveTypeId: p.leaveTypeId,
      fiscalYearId: previous.id,
      fromDate: p.from,
      toDate: p.to,
      fromDateBs: formatBsKey(bsFrom),
      toDateBs: formatBsKey(adToBs(p.to)),
      portion: "full" as const,
      totalDays: String(p.days),
      reason: p.reason,
      status: p.status,
      currentLevel: null,
      submittedAt: new Date(`${addDays(p.from, -3)}T04:00:00Z`),
      decidedAt: new Date(`${addDays(p.from, -1)}T09:30:00Z`),
      cancelledAt: p.status === "cancelled" ? new Date(`${addDays(p.from, -1)}T11:00:00Z`) : null,
      cancelReason: p.status === "cancelled" ? "Withdrawn by the employee" : null,
    };
  });

  const newRequests = requestRows.filter((r) => !existingRefs.has(r.reference));
  if (newRequests.length) {
    for (let i = 0; i < newRequests.length; i += 200) {
      await db.insert(leaveRequests).values(newRequests.slice(i, i + 200));
    }
  }

  const savedRequests = await db
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.orgId, orgId), eq(leaveRequests.fiscalYearId, previous.id)));

  // The approval ledger, so history shows who signed what rather than a bare
  // status column.
  const stepRows = savedRequests.map((r) => {
    const emp = staff.find((e) => e.id === r.employeeId);
    return {
      orgId,
      entityType: "leave_request",
      entityId: r.id,
      level: 1,
      approverEmployeeId: emp?.supervisorId ?? null,
      approverLabel: "Reporting supervisor",
      decision:
        r.status === "approved"
          ? ("approved" as const)
          : r.status === "rejected"
            ? ("rejected" as const)
            : ("skipped" as const),
      comment:
        r.status === "rejected" ? "Cover could not be arranged for these dates." : null,
      decidedAt: r.decidedAt,
    };
  });
  if (stepRows.length) {
    for (let i = 0; i < stepRows.length; i += 200) {
      await db.insert(approvalSteps).values(stepRows.slice(i, i + 200)).onConflictDoNothing();
    }
  }

  log(
    "leave requests",
    `${savedRequests.length} — ${savedRequests.filter((r) => r.status === "approved").length} approved, ` +
      `${savedRequests.filter((r) => r.status === "rejected").length} rejected, ` +
      `${savedRequests.filter((r) => r.status === "cancelled").length} withdrawn`,
  );

  /* ---------------------------------------------- balances match the requests */

  // Recomputed from the approved requests rather than accumulated as we go: if
  // the two ever disagree, the demo is lying about the invariant the product
  // claims to hold.
  const usedByPair = new Map<string, number>();
  for (const r of savedRequests) {
    if (r.status !== "approved") continue;
    const key = `${r.employeeId}:${r.leaveTypeId}`;
    usedByPair.set(key, (usedByPair.get(key) ?? 0) + Number(r.totalDays));
  }

  for (const [key, used] of usedByPair) {
    const [employeeId, leaveTypeId] = key.split(":");
    await db
      .update(leaveBalances)
      .set({ used: String(used), pending: "0", updatedAt: new Date() })
      .where(
        and(
          eq(leaveBalances.employeeId, employeeId),
          eq(leaveBalances.leaveTypeId, leaveTypeId),
          eq(leaveBalances.fiscalYearId, previous.id),
        ),
      );
  }
  log("balances reconciled", `${usedByPair.size} employee/type pairs`);

  /* ----------------------------------------------------------- attendance */

  const leaveDates = new Set<string>();
  for (const r of savedRequests) {
    if (r.status !== "approved") continue;
    for (let d = r.fromDate; d <= r.toDate; d = addDays(d, 1)) {
      leaveDates.add(`${r.employeeId}:${d}`);
    }
  }

  const shiftRows = await db.select().from(shifts).where(eq(shifts.orgId, orgId));
  if (shiftRows.length === 0) throw new Error("No shifts. Run pnpm db:seed first.");
  const generalShift = shiftRows.find((s) => s.code === "GEN") ?? shiftRows[0];

  const assignments = await db
    .select()
    .from(shiftAssignments)
    .where(eq(shiftAssignments.orgId, orgId));

  const shiftFor = (employeeId: string) => {
    const assigned = assignments.find((a) => a.employeeId === employeeId);
    return shiftRows.find((s) => s.id === assigned?.shiftId) ?? generalShift;
  };

  const asRule = (s: (typeof shiftRows)[number]): ShiftRule => ({
    id: s.id,
    code: s.code,
    name: s.name,
    colour: s.colour,
    startTime: s.startTime,
    endTime: s.endTime,
    breakMinutes: s.breakMinutes,
    graceInMinutes: s.graceInMinutes,
    graceOutMinutes: s.graceOutMinutes,
    fullDayMinutes: s.fullDayMinutes,
    halfDayMinutes: s.halfDayMinutes,
    isNightShift: s.isNightShift,
    otAfterMinutes: s.otAfterMinutes,
  });

  const existingDays = new Set(
    (
      await db
        .select({ employeeId: attendanceDays.employeeId, date: attendanceDays.date })
        .from(attendanceDays)
        .where(
          and(
            eq(attendanceDays.orgId, orgId),
            sql`${attendanceDays.date} BETWEEN ${previous.startDate} AND ${previous.endDate}`,
          ),
        )
    ).map((d) => `${d.employeeId}:${d.date}`),
  );

  const dayRows: (typeof attendanceDays.$inferInsert)[] = [];

  for (const emp of staff) {
    const rand = seededRandom(`att:${previous.code}:${emp.employeeCode}`);
    const shift = shiftFor(emp.id);
    const rule = asRule(shift);
    const [h, m] = shift.startTime.split(":").map(Number);
    const shiftStart = h * 60 + m;
    const [eh, em] = shift.endTime.split(":").map(Number);
    const spanMinutes = eh * 60 + em - shiftStart;

    // A per-person habit, so some people are reliably early and some reliably
    // late. Uniform jitter produces a late-arrival report nobody would act on.
    const habit = Math.round((rand() - 0.55) * 34);
    const absenceRate = 0.012 + rand() * 0.02;

    for (let date = previous.startDate; date <= previous.endDate; date = addDays(date, 1)) {
      if (date < emp.dateOfJoin) continue;
      if (existingDays.has(`${emp.id}:${date}`)) continue;

      const weeklyOff = isSaturday(date);
      const holiday = holidaySet.has(date);
      const onLeave = leaveDates.has(`${emp.id}:${date}`);

      let checkIn: string | null = null;
      let checkOut: string | null = null;
      let source: "device" | "manual" | "system" | "request" = "system";

      if (!weeklyOff && !holiday && !onLeave) {
        if (rand() > absenceRate) {
          source = "device";
          const inJitter = habit + Math.round((rand() - 0.5) * 26);
          const stay = spanMinutes + Math.round(rand() * 80) - 4;
          checkIn = fromMinutes(shiftStart + inJitter);
          checkOut = fromMinutes(shiftStart + inJitter + Math.max(150, stay));
        }
      }

      const computed = computeDay(rule, checkIn, checkOut, {
        isWeeklyOff: weeklyOff,
        isHoliday: holiday,
        isOnLeave: onLeave,
      });

      dayRows.push({
        orgId,
        employeeId: emp.id,
        date,
        dateBs: formatBsKey(adToBs(date)),
        shiftId: shift.id,
        checkIn,
        checkOut,
        workedMinutes: computed.workedMinutes,
        lateMinutes: computed.lateMinutes,
        earlyExitMinutes: computed.earlyExitMinutes,
        otMinutes: computed.otMinutes,
        status: computed.status,
        source,
        // A closed year is locked: payroll has run against every month of it.
        isLocked: true,
      });
    }
  }

  for (let i = 0; i < dayRows.length; i += 500) {
    await db.insert(attendanceDays).values(dayRows.slice(i, i + 500)).onConflictDoNothing();
  }
  log("attendance days", `${dayRows.length} rows across ${staff.length} staff`);

  /* -------------------------------------------- attendance corrections */

  const correctable = await db
    .select()
    .from(attendanceDays)
    .where(
      and(
        eq(attendanceDays.orgId, orgId),
        eq(attendanceDays.status, "absent"),
        sql`${attendanceDays.date} BETWEEN ${previous.startDate} AND ${previous.endDate}`,
      ),
    )
    .limit(24);

  const existingAttRefs = new Set(
    (
      await db
        .select({ reference: attendanceRequests.reference })
        .from(attendanceRequests)
        .where(eq(attendanceRequests.orgId, orgId))
    ).map((r) => r.reference),
  );

  const attRows = correctable.map((day, i) => {
    const emp = staff.find((e) => e.id === day.employeeId);
    const approved = i % 3 !== 2; // two in three were accepted
    return {
      orgId,
      reference: `AT-${bsStart.year}-H${String(i + 1).padStart(4, "0")}`,
      employeeId: day.employeeId,
      date: day.date,
      dateBs: day.dateBs,
      requestType: "missing_punch" as const,
      requestedCheckIn: "09:05:00",
      requestedCheckOut: "17:40:00",
      previousCheckIn: day.checkIn,
      previousCheckOut: day.checkOut,
      reason: approved
        ? "Device did not register the punch; verified with the gate register."
        : "Forgot to punch.",
      status: approved ? "approved" : "rejected",
      currentLevel: null,
      submittedAt: new Date(`${addDays(day.date, 1)}T04:30:00Z`),
      decidedAt: new Date(`${addDays(day.date, 2)}T05:15:00Z`),
      supervisorId: emp?.supervisorId ?? null,
      approved,
    };
  });

  const newAtt = attRows.filter((r) => !existingAttRefs.has(r.reference));
  for (const row of newAtt) {
    const { supervisorId, approved, ...values } = row;
    const [saved] = await db.insert(attendanceRequests).values(values).returning();

    await db
      .insert(approvalSteps)
      .values({
        orgId,
        entityType: "attendance_request",
        entityId: saved.id,
        level: 1,
        approverEmployeeId: supervisorId,
        approverLabel: "Reporting supervisor",
        decision: approved ? "approved" : "rejected",
        comment: approved ? null : "No supporting evidence.",
        decidedAt: saved.decidedAt,
      })
      .onConflictDoNothing();

    // An approved correction actually changed the day, so the register and the
    // request history agree — the thing the legacy system could not guarantee.
    if (approved) {
      const shift = shiftFor(saved.employeeId);
      const computed = computeDay(asRule(shift), "09:05:00", "17:40:00", {
        isWeeklyOff: false,
        isHoliday: false,
        isOnLeave: false,
      });
      await db
        .update(attendanceDays)
        .set({
          checkIn: "09:05:00",
          checkOut: "17:40:00",
          workedMinutes: computed.workedMinutes,
          lateMinutes: computed.lateMinutes,
          otMinutes: computed.otMinutes,
          status: computed.status,
          source: "request",
          remarks: `Corrected under ${saved.reference}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(attendanceDays.employeeId, saved.employeeId),
            eq(attendanceDays.date, saved.date),
          ),
        );
    }
  }
  log("attendance corrections", `${newAtt.length} raised and decided`);

  /* ------------------------------------------------------------- year end */

  const closingBalances = await db
    .select({
      id: leaveBalances.id,
      employeeId: leaveBalances.employeeId,
      leaveTypeId: leaveBalances.leaveTypeId,
      entitled: leaveBalances.entitled,
      carriedForward: leaveBalances.carriedForward,
      used: leaveBalances.used,
    })
    .from(leaveBalances)
    .where(and(eq(leaveBalances.orgId, orgId), eq(leaveBalances.fiscalYearId, previous.id)));

  const typeById = new Map(types.map((t) => [t.id, t]));
  let encashed = 0;
  let lapsed = 0;
  let carried = 0;

  for (const b of closingBalances) {
    const type = typeById.get(b.leaveTypeId);
    if (!type) continue;

    // What is genuinely left at the close: this year's entitlement plus whatever
    // arrived from previous years, less what was taken.
    const remaining = Number(b.entitled) + Number(b.carriedForward) - Number(b.used);
    if (remaining <= 0) continue;

    if (type.isEncashable && type.lapseType === "none") {
      // Encashable and non-lapsing: pay out the excess over the accumulation
      // cap, carry the rest.
      const cap = Number(type.maxCarryForwardDays ?? type.maxAccumulationDays ?? 0);
      const toCarry = cap > 0 ? Math.min(remaining, cap) : remaining;
      const toEncash = Math.max(0, remaining - toCarry);

      if (toEncash > 0) {
        await db
          .update(leaveBalances)
          .set({ encashed: String(toEncash), updatedAt: new Date() })
          .where(eq(leaveBalances.id, b.id));
        encashed += toEncash;
      }

      await db
        .update(leaveBalances)
        .set({ carriedForward: String(toCarry), updatedAt: new Date() })
        .where(
          and(
            eq(leaveBalances.employeeId, b.employeeId),
            eq(leaveBalances.leaveTypeId, b.leaveTypeId),
            eq(leaveBalances.fiscalYearId, current.id),
          ),
        );
      carried += toCarry;
    } else if (type.lapseType === "yearly") {
      lapsed += remaining;
    }
  }

  log(
    "year-end close",
    `${carried.toFixed(0)} days carried forward, ${encashed.toFixed(0)} encashed, ${lapsed.toFixed(0)} lapsed`,
  );

  /* ------------------------------------------------------------- lock it */

  const lockRows = FISCAL_MONTHS.flatMap((bsMonth) =>
    (["attendance", "leave", "payroll"] as const).map((module) => ({
      orgId,
      fiscalYearId: previous.id,
      module,
      bsMonth,
      lockedBy: "Year-end close",
      note: `${previous.code} closed`,
    })),
  );
  await db.insert(periodLocks).values(lockRows).onConflictDoNothing();

  // Stamp every day in the year, not only the ones this script inserted. The
  // main seed generates the last seventy-five days, which overlap the close of
  // the previous year — leaving those unlocked would mean a "closed" year that
  // still accepted corrections for its final weeks.
  const locked = await db
    .update(attendanceDays)
    .set({ isLocked: true })
    .where(
      and(
        eq(attendanceDays.orgId, orgId),
        eq(attendanceDays.isLocked, false),
        sql`${attendanceDays.date} BETWEEN ${previous.startDate} AND ${previous.endDate}`,
      ),
    )
    .returning({ id: attendanceDays.id });

  log(
    "period locks",
    `${lockRows.length} module-months, ${locked.length} straggler day(s) stamped`,
  );

  await db
    .update(fiscalYears)
    .set({ isClosed: true })
    .where(eq(fiscalYears.id, previous.id));

  /* ------------------------------------------------------------- notices */

  const historicNotices = [
    {
      orgId,
      title: `${previous.code} year-end close completed`,
      body: `All twelve months of ${previous.code} are locked. Attendance corrections and leave applications against those dates will be refused.\n\nUnused home and sick leave has been carried forward where the policy allows it; casual leave has lapsed.`,
      priority: "important" as const,
      audience: "everyone" as const,
      publishFrom: addDays(previous.endDate, 2),
      publishTo: addDays(previous.endDate, 60),
      postedBy: "Payroll",
      isActive: true,
    },
    {
      orgId,
      title: `Leave encashment for ${previous.code} paid`,
      body: "Encashment of leave above the accumulation cap has been paid with this month's salary. The days encashed are shown against each leave type on your desk.",
      priority: "normal" as const,
      audience: "everyone" as const,
      publishFrom: addDays(previous.endDate, 20),
      publishTo: addDays(previous.endDate, 70),
      postedBy: "Payroll",
      isActive: true,
    },
  ];

  const seenNotices = new Set(
    (await db.select({ title: notices.title }).from(notices).where(eq(notices.orgId, orgId))).map(
      (n) => n.title,
    ),
  );
  const newNotices = historicNotices.filter((n) => !seenNotices.has(n.title));
  if (newNotices.length) await db.insert(notices).values(newNotices);

  await db.insert(auditLog).values({
    orgId,
    action: "create",
    entityType: "fiscal_year",
    entityId: previous.id,
    actorLabel: "seed:history",
    summary: `Historical dataset seeded for ${previous.code}`,
  });

  /* -------------------------------------------------------------- summary */

  const [{ n: dayCount }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attendanceDays)
    .where(
      and(
        eq(attendanceDays.orgId, orgId),
        sql`${attendanceDays.date} BETWEEN ${previous.startDate} AND ${previous.endDate}`,
      ),
    );

  console.log(`
Done. ${previous.code} now holds:

  ${dayCount} attendance days, all locked
  ${savedRequests.length} leave requests, decided
  ${newAtt.length} attendance corrections, decided
  ${lockRows.length} period locks

  Switch to it from Organisation > Fiscal Years, or open any report and
  change the year. Try an attendance correction against a ${previous.code}
  date to see a locked period refuse it.
`);
}

const REASONS = [
  "Family function at home.",
  "Medical appointment.",
  "Unwell with fever.",
  "Travelling to the village for a ceremony.",
  "Personal work at the ward office.",
  "Child's school programme.",
  "Attending a wedding in Dhankuta.",
  "Recovering after a minor procedure.",
  "House shifting.",
  "Passport renewal appointment.",
];

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nHistory seed failed:\n", err);
    process.exit(1);
  });
