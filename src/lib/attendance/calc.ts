/**
 * The attendance calculation, with no database and no server-only import.
 *
 * Split out so the seed script and any future batch job can run the exact same
 * arithmetic the application does, outside a Next.js request. If these rules ever
 * disagree between seeding and serving, the demo stops being evidence.
 */

export type AttendanceStatus =
  | "present"
  | "half_day"
  | "absent"
  | "weekly_off"
  | "holiday"
  | "on_leave"
  | "missing_punch"
  | "not_marked";

export type ShiftRule = {
  id: string;
  code: string;
  name: string;
  colour: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  graceInMinutes: number;
  graceOutMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  isNightShift: boolean;
  otAfterMinutes: number;
};

/* ------------------------------------------------------------------ time */

/** "09:15:00" or "09:15" -> minutes since midnight. */
export function toMinutes(time: string | null): number | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function fromMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "8h 20m", or "—" for nothing. */
export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/** Trims "09:15:00" to "09:15" for display. */
export function shortTime(time: string | null | undefined): string {
  return time ? time.slice(0, 5) : "—";
}

/* ------------------------------------------------------- the day calculation */

export type ComputedDay = {
  workedMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  otMinutes: number;
  status: AttendanceStatus;
};

/**
 * Turns a pair of punches into the numbers a payslip is built from.
 *
 * Rules, taken from what the legacy Calculation Settings screen exposed:
 *   - worked minutes are out − in, less the shift's unpaid break
 *   - lateness only starts after the grace window, and likewise early exit
 *   - a night shift's out punch is on the next calendar day, so add 24h
 *   - overtime accrues only past the shift end plus its OT threshold
 *   - full day / half day / absent is decided on worked minutes, not on the clock
 */
export function computeDay(
  shift: ShiftRule | null,
  checkIn: string | null,
  checkOut: string | null,
  context: { isWeeklyOff: boolean; isHoliday: boolean; isOnLeave: boolean },
): ComputedDay {
  const inMin = toMinutes(checkIn);
  const outMinRaw = toMinutes(checkOut);

  // Leave and holidays win over the roster, but a punch on a day off still counts
  // as worked time — that is what overtime on a holiday is.
  if (inMin === null && outMinRaw === null) {
    if (context.isOnLeave) {
      return { workedMinutes: 0, lateMinutes: 0, earlyExitMinutes: 0, otMinutes: 0, status: "on_leave" };
    }
    if (context.isHoliday) {
      return { workedMinutes: 0, lateMinutes: 0, earlyExitMinutes: 0, otMinutes: 0, status: "holiday" };
    }
    if (context.isWeeklyOff) {
      return { workedMinutes: 0, lateMinutes: 0, earlyExitMinutes: 0, otMinutes: 0, status: "weekly_off" };
    }
    return { workedMinutes: 0, lateMinutes: 0, earlyExitMinutes: 0, otMinutes: 0, status: "absent" };
  }

  if (inMin === null || outMinRaw === null) {
    return {
      workedMinutes: 0,
      lateMinutes: 0,
      earlyExitMinutes: 0,
      otMinutes: 0,
      status: "missing_punch",
    };
  }

  if (!shift) {
    const worked = Math.max(0, outMinRaw - inMin);
    return {
      workedMinutes: worked,
      lateMinutes: 0,
      earlyExitMinutes: 0,
      otMinutes: 0,
      status: worked > 0 ? "present" : "absent",
    };
  }

  const shiftStart = toMinutes(shift.startTime)!;
  let shiftEnd = toMinutes(shift.endTime)!;
  if (shift.isNightShift && shiftEnd <= shiftStart) shiftEnd += 1440;

  const outMin = outMinRaw < inMin ? outMinRaw + 1440 : outMinRaw;

  const gross = Math.max(0, outMin - inMin);
  const workedMinutes = Math.max(0, gross - shift.breakMinutes);

  const lateMinutes = Math.max(0, inMin - (shiftStart + shift.graceInMinutes));
  const earlyExitMinutes = Math.max(0, shiftEnd - shift.graceOutMinutes - outMin);

  const otThreshold = shiftEnd + shift.otAfterMinutes;
  const otMinutes = outMin > otThreshold ? outMin - otThreshold : 0;

  // A punch on a day off is all overtime — there is no shift to be late for.
  if (context.isHoliday || context.isWeeklyOff) {
    return {
      workedMinutes,
      lateMinutes: 0,
      earlyExitMinutes: 0,
      otMinutes: workedMinutes,
      status: context.isHoliday ? "holiday" : "weekly_off",
    };
  }

  let status: AttendanceStatus = "absent";
  if (workedMinutes >= shift.fullDayMinutes) status = "present";
  else if (workedMinutes >= shift.halfDayMinutes) status = "half_day";

  return { workedMinutes, lateMinutes, earlyExitMinutes, otMinutes, status };
}

export const REQUEST_TYPE_LABEL: Record<string, string> = {
  missing_punch: "Missing punch",
  wrong_time: "Wrong time recorded",
  late_excuse: "Late arrival excused",
  early_exit: "Early exit approved",
  on_duty: "On duty / field work",
  overtime: "Overtime claim",
};

export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  half_day: "Half day",
  absent: "Absent",
  weekly_off: "Weekly off",
  holiday: "Holiday",
  on_leave: "On leave",
  missing_punch: "Missing punch",
  not_marked: "Not marked",
};

/** Compact letter for the monthly matrix. */
export const ATTENDANCE_STATUS_CODE: Record<AttendanceStatus, string> = {
  present: "P",
  half_day: "½",
  absent: "A",
  weekly_off: "W",
  holiday: "H",
  on_leave: "L",
  missing_punch: "!",
  not_marked: "·",
};
