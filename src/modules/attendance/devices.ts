import "server-only";

import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { attendanceDays } from "@/db/schema/attendance";
import {
  attendanceDevices,
  deviceEnrolments,
  devicePunches,
} from "@/db/schema/devices";
import { adToBs, addDays, formatBsKey, isSaturday } from "@/lib/bs";
import {
  computeDay,
  fromMinutes,
  holidayMap,
  leaveMap,
  shiftsForDate,
  defaultShift,
  toMinutes,
  type ShiftRule,
} from "@/lib/attendance";

/**
 * The device pipeline: punches in, attendance days out.
 *
 * Three stages, deliberately separate, because they fail for different reasons
 * and at different times:
 *
 *   ingest   a reader hands us readings. Never rejects a reading it cannot
 *            explain — an unknown enrolment number is stored as evidence that
 *            somebody's enrolment is missing.
 *   resolve  enrolment number + device → employee.
 *   fold     the punches for one person on one day become a check-in, a
 *            check-out and a computed status.
 *
 * Fusing them, as the legacy stored procedures did, means a single bad reading
 * aborts a whole night's import and nobody can see how far it got.
 */

/* ------------------------------------------------------------------ health */

export type DeviceHealth = "healthy" | "stale" | "silent" | "never" | "disabled";

/**
 * Whether a reader is still reporting.
 *
 * Derived from `lastSeenAt` and the expected interval rather than stored,
 * because a stored flag is only as fresh as the last job that wrote it — and
 * the failure being detected here is precisely "nothing ran".
 *
 * One missed cycle is ordinary jitter, so the healthy window is two intervals.
 * Six is the point at which a reader is not coming back without someone walking
 * over to it: on the default fifteen-minute interval that is an hour and a half,
 * comfortably inside a morning, which is when it still matters.
 */
export function deviceHealth(
  device: { status: string; lastSeenAt: Date | null; syncIntervalMinutes: number },
  now = new Date(),
): DeviceHealth {
  if (device.status !== "active") return "disabled";
  if (!device.lastSeenAt) return "never";

  const minutes = (now.getTime() - device.lastSeenAt.getTime()) / 60_000;
  if (minutes <= device.syncIntervalMinutes * 2) return "healthy";
  if (minutes <= device.syncIntervalMinutes * 6) return "stale";
  return "silent";
}

export const HEALTH_TONE: Record<DeviceHealth, "ok" | "warn" | "danger" | "neutral"> = {
  healthy: "ok",
  stale: "warn",
  silent: "danger",
  never: "neutral",
  disabled: "neutral",
};

export const HEALTH_LABEL: Record<DeviceHealth, string> = {
  healthy: "Reporting",
  stale: "Late reporting",
  silent: "Not reporting",
  never: "Never reported",
  disabled: "Not in service",
};

/* ------------------------------------------------------------------ ingest */

export type IncomingPunch = {
  enrollNumber: string;
  /** Local wall clock at the reader. */
  punchedAt: Date;
  direction?: "in" | "out" | "unknown";
  payload?: unknown;
};

export type IngestResult = {
  received: number;
  stored: number;
  duplicates: number;
  unmatched: number;
};

/**
 * Which calendar day a punch belongs to.
 *
 * Not simply the date part. A night shift that starts at 21:00 and ends at
 * 06:00 produces an out-punch on the following calendar date that belongs to
 * the *previous* attendance day — and `attendance_days` has exactly one row per
 * employee per date, so putting it on the wrong one creates a spurious
 * missing-punch on both.
 *
 * The cut-off is the shift end plus its out-grace: anything earlier in the
 * morning is still yesterday's shift.
 */
export function attendanceDateFor(punchedAt: Date, shift: ShiftRule | null): string {
  const iso = localIso(punchedAt);
  if (!shift?.isNightShift) return iso;

  const minuteOfDay = punchedAt.getHours() * 60 + punchedAt.getMinutes();
  const end = toMinutes(shift.endTime) ?? 0;
  const cutoff = end + shift.graceOutMinutes;

  // A night shift's end time is before its start time, so an out-punch lands in
  // the small hours. Before the cut-off, it is still the previous day's shift.
  return minuteOfDay <= cutoff ? addDays(iso, -1) : iso;
}

/** `Date` → "YYYY-MM-DD" in local time, avoiding the UTC shift `toISOString` applies. */
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Store readings from one device.
 *
 * Idempotent by construction: the unique constraint on
 * `(device, enrolment, timestamp)` absorbs the re-sends that every reader does,
 * so the caller can replay a window without counting anything twice.
 */
export async function ingestPunches(
  device: typeof attendanceDevices.$inferSelect,
  incoming: IncomingPunch[],
): Promise<IngestResult> {
  const result: IngestResult = {
    received: incoming.length,
    stored: 0,
    duplicates: 0,
    unmatched: 0,
  };

  if (incoming.length === 0) {
    await touchDevice(device.id, null);
    return result;
  }

  const enrolments = await db
    .select({ enrollNumber: deviceEnrolments.enrollNumber, employeeId: deviceEnrolments.employeeId })
    .from(deviceEnrolments)
    .where(eq(deviceEnrolments.deviceId, device.id));

  const byNumber = new Map(enrolments.map((e) => [e.enrollNumber, e.employeeId]));

  // Night-shift attribution needs the employee's shift, which is only known
  // once the enrolment has been resolved — so the shift lookup happens after
  // matching, for the people actually involved.
  const matchedIds = [
    ...new Set(
      incoming.map((p) => byNumber.get(p.enrollNumber)).filter((id): id is string => Boolean(id)),
    ),
  ];

  const shiftByEmployee = matchedIds.length
    ? await shiftsForDate(device.orgId, localIso(incoming[0].punchedAt), matchedIds)
    : new Map<string, ShiftRule>();
  const fallbackShift = await defaultShift(device.orgId);

  const rows = incoming.map((p) => {
    const employeeId = byNumber.get(p.enrollNumber) ?? null;
    if (!employeeId) result.unmatched += 1;

    const shift = employeeId ? (shiftByEmployee.get(employeeId) ?? fallbackShift) : fallbackShift;

    return {
      orgId: device.orgId,
      deviceId: device.id,
      enrollNumber: p.enrollNumber,
      employeeId,
      punchedAt: p.punchedAt,
      punchDate: attendanceDateFor(p.punchedAt, shift),
      direction: resolveDirection(device.direction, p.direction),
      status: employeeId ? ("pending" as const) : ("unmatched" as const),
      payload: (p.payload ?? null) as never,
    };
  });

  const inserted = await db
    .insert(devicePunches)
    .values(rows)
    // The constraint is the deduplication. Legacy did this with two DELETE
    // passes inside a procedure, which the next importer would have had to
    // remember to repeat.
    .onConflictDoNothing({
      target: [devicePunches.deviceId, devicePunches.enrollNumber, devicePunches.punchedAt],
    })
    .returning({ id: devicePunches.id });

  result.stored = inserted.length;
  result.duplicates = rows.length - inserted.length;

  await touchDevice(device.id, null);
  return result;
}

/**
 * What a punch on this reader means.
 *
 * A device configured `in_only` says so regardless of what the payload claims —
 * a turnstile wired for entry does not stop being an entry because a firmware
 * field says otherwise.
 */
function resolveDirection(
  deviceDirection: string,
  reported: "in" | "out" | "unknown" | undefined,
): "in" | "out" | "unknown" {
  switch (deviceDirection) {
    case "in_only":
      return "in";
    case "out_only":
      return "out";
    case "device_reported":
      return reported ?? "unknown";
    default:
      // `alternating` is decided when the day is folded, where the full
      // ordered set of that person's punches is in hand. It cannot be known
      // one punch at a time.
      return "unknown";
  }
}

async function touchDevice(deviceId: string, error: string | null) {
  await db
    .update(attendanceDevices)
    .set({ lastSeenAt: new Date(), lastError: error, updatedAt: new Date() })
    .where(eq(attendanceDevices.id, deviceId));
}

/* ----------------------------------------------------------------- resolve */

/**
 * Try to match previously unmatched punches again.
 *
 * Run after an enrolment is added: the punches from the days before somebody
 * was enrolled in *this* system are still on file, and they are usually exactly
 * the days the employee is asking about.
 */
export async function resolveUnmatched(orgId: string, deviceId?: string): Promise<number> {
  const matched = await db
    .update(devicePunches)
    .set({ employeeId: sql`e.employee_id`, status: "pending" })
    .from(
      sql`(SELECT device_id, enroll_number, employee_id FROM attendance_device_enrolments) AS e`,
    )
    .where(
      and(
        eq(devicePunches.orgId, orgId),
        eq(devicePunches.status, "unmatched"),
        deviceId ? eq(devicePunches.deviceId, deviceId) : undefined,
        sql`e.device_id = ${devicePunches.deviceId}`,
        sql`e.enroll_number = ${devicePunches.enrollNumber}`,
      ),
    )
    .returning({ id: devicePunches.id });

  return matched.length;
}

/* -------------------------------------------------------------------- fold */

export type SyncResult = {
  punchesConsidered: number;
  daysWritten: number;
  daysSkipped: number;
  unmatched: number;
  skippedReasons: string[];
};

/**
 * Fold pending punches into attendance days.
 *
 * The rule that matters most is what this **refuses** to do. A day is left
 * alone when:
 *
 *   - it is locked, because payroll has consumed the period; or
 *   - its source is `manual` or `request`, meaning a human corrected it or an
 *     approved regularisation wrote it.
 *
 * A device sync silently reverting an approved correction would be the worst
 * possible bug in this module: the employee's claim was accepted, the manager
 * signed it, and then a machine quietly put the old times back overnight. The
 * punches are kept and marked `skipped` with the reason, so the evidence
 * survives even though the row is not touched.
 */
export async function applyPunches(
  orgId: string,
  opts: { deviceId?: string; from?: string; to?: string } = {},
): Promise<SyncResult> {
  const result: SyncResult = {
    punchesConsidered: 0,
    daysWritten: 0,
    daysSkipped: 0,
    unmatched: 0,
    skippedReasons: [],
  };

  const pending = await db
    .select({
      id: devicePunches.id,
      employeeId: devicePunches.employeeId,
      punchDate: devicePunches.punchDate,
      punchedAt: devicePunches.punchedAt,
      direction: devicePunches.direction,
    })
    .from(devicePunches)
    .where(
      and(
        eq(devicePunches.orgId, orgId),
        eq(devicePunches.status, "pending"),
        isNotNull(devicePunches.employeeId),
        opts.deviceId ? eq(devicePunches.deviceId, opts.deviceId) : undefined,
        opts.from ? gte(devicePunches.punchDate, opts.from) : undefined,
        opts.to ? lte(devicePunches.punchDate, opts.to) : undefined,
      ),
    )
    .orderBy(asc(devicePunches.punchedAt));

  result.punchesConsidered = pending.length;
  if (pending.length === 0) return result;

  /* ---- group into (employee, date) buckets ------------------------------ */

  type Bucket = { employeeId: string; date: string; punches: typeof pending };
  const buckets = new Map<string, Bucket>();

  for (const p of pending) {
    const key = `${p.employeeId}:${p.punchDate}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.punches.push(p);
    else buckets.set(key, { employeeId: p.employeeId!, date: p.punchDate, punches: [p] });
  }

  const dates = [...new Set(pending.map((p) => p.punchDate))].sort();
  const employeeIds = [...new Set(pending.map((p) => p.employeeId!))];
  const from = dates[0];
  const to = dates[dates.length - 1];

  /* ---- everything the calculation needs, fetched once ------------------- */

  const [holidays, leave, existingRows, fallback] = await Promise.all([
    holidayMap(orgId, from, to),
    leaveMap(orgId, from, to, employeeIds),
    db
      .select({
        employeeId: attendanceDays.employeeId,
        date: attendanceDays.date,
        source: attendanceDays.source,
        isLocked: attendanceDays.isLocked,
      })
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.orgId, orgId),
          gte(attendanceDays.date, from),
          lte(attendanceDays.date, to),
          inArray(attendanceDays.employeeId, employeeIds),
        ),
      ),
    defaultShift(orgId),
  ]);

  const existing = new Map(existingRows.map((r) => [`${r.employeeId}:${r.date}`, r]));

  // Shifts are dated, so they are looked up per distinct date rather than once.
  const shiftsByDate = new Map<string, Map<string, ShiftRule>>();
  for (const date of dates) {
    shiftsByDate.set(date, await shiftsForDate(orgId, date, employeeIds));
  }

  const applied: string[] = [];
  const skipped: { ids: string[]; note: string }[] = [];

  for (const bucket of buckets.values()) {
    const key = `${bucket.employeeId}:${bucket.date}`;
    const prior = existing.get(key);

    if (prior?.isLocked) {
      skipped.push({
        ids: bucket.punches.map((p) => p.id),
        note: "The period is locked for payroll; the day was not changed.",
      });
      result.daysSkipped += 1;
      continue;
    }

    if (prior && (prior.source === "manual" || prior.source === "request")) {
      skipped.push({
        ids: bucket.punches.map((p) => p.id),
        note:
          prior.source === "request"
            ? "An approved regularisation owns this day; the punches were not applied."
            : "This day was corrected by hand; the punches were not applied.",
      });
      result.daysSkipped += 1;
      continue;
    }

    const shift = shiftsByDate.get(bucket.date)?.get(bucket.employeeId) ?? fallback;
    const { checkIn, checkOut } = deriveInOut(bucket.punches);

    const computed = computeDay(shift, checkIn, checkOut, {
      isWeeklyOff: isSaturday(bucket.date),
      isHoliday: holidays.has(bucket.date),
      isOnLeave: leave.has(key),
    });

    await db
      .insert(attendanceDays)
      .values({
        orgId,
        employeeId: bucket.employeeId,
        date: bucket.date,
        dateBs: formatBsKey(adToBs(bucket.date)),
        shiftId: shift?.id ?? null,
        checkIn,
        checkOut,
        workedMinutes: computed.workedMinutes,
        lateMinutes: computed.lateMinutes,
        earlyExitMinutes: computed.earlyExitMinutes,
        otMinutes: computed.otMinutes,
        status: computed.status,
        source: "device",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [attendanceDays.employeeId, attendanceDays.date],
        set: {
          shiftId: shift?.id ?? null,
          checkIn,
          checkOut,
          workedMinutes: computed.workedMinutes,
          lateMinutes: computed.lateMinutes,
          earlyExitMinutes: computed.earlyExitMinutes,
          otMinutes: computed.otMinutes,
          status: computed.status,
          source: "device",
          updatedAt: new Date(),
        },
      });

    applied.push(...bucket.punches.map((p) => p.id));
    result.daysWritten += 1;
  }

  if (applied.length) {
    await db
      .update(devicePunches)
      .set({ status: "applied", processedAt: new Date() })
      .where(inArray(devicePunches.id, applied));
  }

  for (const group of skipped) {
    await db
      .update(devicePunches)
      .set({ status: "skipped", processedAt: new Date(), note: group.note })
      .where(inArray(devicePunches.id, group.ids));
    if (!result.skippedReasons.includes(group.note)) result.skippedReasons.push(group.note);
  }

  const [unmatchedCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(devicePunches)
    .where(and(eq(devicePunches.orgId, orgId), eq(devicePunches.status, "unmatched")));
  result.unmatched = unmatchedCount?.n ?? 0;

  return result;
}

/**
 * A day's punches become one check-in and one check-out.
 *
 * People punch more than twice — at the gate, at the floor reader, going out
 * for lunch. The legacy system pivoted up to ten readings into `Log1..Log10`
 * and took the extremes, which is the right answer: the earliest arrival and
 * the latest departure bound the working day, and the lunch punch in between is
 * not an early exit.
 *
 * Where directions are known, they are respected — the earliest *in* and the
 * latest *out* — so a reader that reports direction gives a better answer than
 * one that does not. Where nothing is known (`alternating`, decided here), the
 * extremes are used.
 */
export function deriveInOut(
  punches: { punchedAt: Date; direction: string }[],
): { checkIn: string | null; checkOut: string | null } {
  if (punches.length === 0) return { checkIn: null, checkOut: null };

  const ordered = [...punches].sort((a, b) => a.punchedAt.getTime() - b.punchedAt.getTime());

  const ins = ordered.filter((p) => p.direction === "in");
  const outs = ordered.filter((p) => p.direction === "out");

  const first = ins.length ? ins[0] : ordered[0];
  const last = outs.length ? outs[outs.length - 1] : ordered[ordered.length - 1];

  const checkIn = clock(first.punchedAt);
  // A single reading is an arrival with no departure, which is a missing punch
  // rather than a zero-length day. Returning the same time for both would
  // compute as "worked 0 minutes, present", and nobody would ever chase it.
  const checkOut = last === first ? null : clock(last.punchedAt);

  return { checkIn, checkOut };
}

function clock(d: Date): string {
  return fromMinutes(d.getHours() * 60 + d.getMinutes());
}

/* ------------------------------------------------------------------ counts */

/** Everything the register page tiles need, in one round trip. */
export async function deviceDigest(orgId: string) {
  const [devices] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) FILTER (WHERE ${attendanceDevices.status} = 'active')::int`,
    })
    .from(attendanceDevices)
    .where(eq(attendanceDevices.orgId, orgId));

  const [punches] = await db
    .select({
      today: sql<number>`count(*) FILTER (WHERE ${devicePunches.punchDate} = to_char(now(), 'YYYY-MM-DD'))::int`,
      pending: sql<number>`count(*) FILTER (WHERE ${devicePunches.status} = 'pending')::int`,
      unmatched: sql<number>`count(*) FILTER (WHERE ${devicePunches.status} = 'unmatched')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(devicePunches)
    .where(eq(devicePunches.orgId, orgId));

  const [enrolled] = await db
    .select({ n: sql<number>`count(DISTINCT ${deviceEnrolments.employeeId})::int` })
    .from(deviceEnrolments)
    .where(eq(deviceEnrolments.orgId, orgId));

  const [staff] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(employees)
    .where(
      and(
        eq(employees.orgId, orgId),
        sql`${employees.status} IN ('probation','active','on_leave','suspended')`,
        sql`${employees.deletedAt} IS NULL`,
      ),
    );

  return {
    devices: devices?.total ?? 0,
    activeDevices: devices?.active ?? 0,
    punchesToday: punches?.today ?? 0,
    punchesPending: punches?.pending ?? 0,
    punchesUnmatched: punches?.unmatched ?? 0,
    punchesTotal: punches?.total ?? 0,
    enrolled: enrolled?.n ?? 0,
    headcount: staff?.n ?? 0,
  };
}
