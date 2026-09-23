/**
 * Bikram Sambat <-> Gregorian conversion.
 *
 * Nepal runs its payroll, leave and fiscal calendars on Bikram Sambat, so BS is a
 * first-class date type here rather than a display format. Conversion is a lookup
 * against the published calendar table, not arithmetic: BS month lengths vary
 * year to year (29-32 days) and are fixed by observation, not by rule.
 *
 * Storage convention: the Gregorian date is the source of truth in the database
 * (`date` columns), and BS is derived for display and input. Anything else makes
 * range queries and sorting wrong.
 */
import { BS_CALENDAR, BS_MAX_YEAR, BS_MIN_YEAR, BS_MONTHS, BS_MONTHS_NP } from "./calendar";

export { BS_MONTHS, BS_MONTHS_NP, BS_MIN_YEAR, BS_MAX_YEAR };

export type BsDate = {
  /** Bikram Sambat year, e.g. 2083 */
  year: number;
  /** 1 = Baisakh ... 12 = Chaitra */
  month: number;
  /** 1-32 */
  day: number;
};

const MS_PER_DAY = 86_400_000;

/** Days from the Unix epoch, ignoring time-of-day and timezone. */
function toEpochDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

function fromEpochDay(epochDay: number): string {
  const dt = new Date(epochDay * MS_PER_DAY);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Epoch day of Baisakh 1 for each BS year, built once. */
const yearStartEpochDay = new Map<number, number>();
for (const [year, gregorianStart] of BS_CALENDAR) {
  yearStartEpochDay.set(year, toEpochDay(gregorianStart));
}

const monthLengths = new Map<number, readonly number[]>();
for (const [year, , months] of BS_CALENDAR) {
  monthLengths.set(year, months);
}

export class BsRangeError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = "BsRangeError";
  }
}

/** Number of days in a BS month. Throws if the year is outside the table. */
export function daysInBsMonth(year: number, month: number): number {
  const months = monthLengths.get(year);
  if (!months) {
    throw new BsRangeError(
      `BS year ${year} is outside the published calendar (${BS_MIN_YEAR}-${BS_MAX_YEAR}).`,
    );
  }
  if (month < 1 || month > 12) throw new BsRangeError(`BS month ${month} is out of range.`);
  return months[month - 1];
}

/** Gregorian ISO date (YYYY-MM-DD) -> Bikram Sambat. */
export function adToBs(iso: string): BsDate {
  const target = toEpochDay(iso);
  const first = BS_CALENDAR[0];
  const firstStart = yearStartEpochDay.get(first[0])!;
  if (target < firstStart) {
    throw new BsRangeError(`${iso} is before Baisakh 1, ${first[0]} BS.`);
  }

  // find the BS year whose Baisakh 1 is the latest one not after `target`
  let lo = 0;
  let hi = BS_CALENDAR.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (yearStartEpochDay.get(BS_CALENDAR[mid][0])! <= target) lo = mid;
    else hi = mid - 1;
  }

  const year = BS_CALENDAR[lo][0];
  const months = monthLengths.get(year)!;
  let remaining = target - yearStartEpochDay.get(year)!;

  for (let month = 1; month <= 12; month++) {
    const len = months[month - 1];
    if (remaining < len) return { year, month, day: remaining + 1 };
    remaining -= len;
  }
  throw new BsRangeError(`${iso} falls past the end of BS ${year}; calendar table exhausted.`);
}

/** Bikram Sambat -> Gregorian ISO date (YYYY-MM-DD). */
export function bsToAd({ year, month, day }: BsDate): string {
  const start = yearStartEpochDay.get(year);
  if (start === undefined) {
    throw new BsRangeError(
      `BS year ${year} is outside the published calendar (${BS_MIN_YEAR}-${BS_MAX_YEAR}).`,
    );
  }
  const len = daysInBsMonth(year, month);
  if (day < 1 || day > len) {
    throw new BsRangeError(`${BS_MONTHS[month - 1]} ${year} has ${len} days; got ${day}.`);
  }
  const months = monthLengths.get(year)!;
  let offset = day - 1;
  for (let m = 1; m < month; m++) offset += months[m - 1];
  return fromEpochDay(start + offset);
}

/** "2083-05-22" style key, zero padded - safe to sort as a string. */
export function formatBsKey(bs: BsDate): string {
  return `${bs.year}-${String(bs.month).padStart(2, "0")}-${String(bs.day).padStart(2, "0")}`;
}

/** "22 Bhadra 2083" */
export function formatBs(bs: BsDate, locale: "en" | "np" = "en"): string {
  const names = locale === "np" ? BS_MONTHS_NP : BS_MONTHS;
  return `${bs.day} ${names[bs.month - 1]} ${bs.year}`;
}

/** Parses "2083-05-22" or "2083/05/22". Returns null when malformed. */
export function parseBsKey(value: string): BsDate | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value.trim());
  if (!m) return null;
  const bs = { year: +m[1], month: +m[2], day: +m[3] };
  try {
    bsToAd(bs);
  } catch {
    return null;
  }
  return bs;
}

/**
 * Inclusive day count between two ISO dates: the same day is **1**, not 0.
 *
 * That is the leave convention and it is deliberate — a one-day leave from
 * Sunday to Sunday is one day, not zero — but it is the wrong primitive for a
 * countdown. Use `daysUntil` for "how many days until this expires".
 */
export function daysBetween(fromIso: string, toIso: string): number {
  return toEpochDay(toIso) - toEpochDay(fromIso) + 1;
}

/**
 * Exclusive day difference: today to today is **0**, yesterday is **-1**.
 *
 * The counterpart to `daysBetween`, and separate from it because the two answer
 * genuinely different questions. Expiry and probation countdowns need this one:
 * with the inclusive count, a document that expired yesterday reads as zero
 * days remaining rather than one day overdue, and the reminder never fires.
 */
export function daysUntil(fromIso: string, toIso: string): number {
  return toEpochDay(toIso) - toEpochDay(fromIso);
}

/** Adds days to an ISO date. */
export function addDays(iso: string, days: number): string {
  return fromEpochDay(toEpochDay(iso) + days);
}

/** 0 = Sunday. Nepal's weekend is Saturday, so this matters for leave maths. */
export function weekdayOf(iso: string): number {
  return ((toEpochDay(iso) % 7) + 11) % 7;
}

export function isSaturday(iso: string): boolean {
  return weekdayOf(iso) === 6;
}

/**
 * Working days between two dates, excluding Saturdays and any supplied holidays.
 * Nepal works a six-day week: only Saturday is a weekly off.
 */
export function workingDaysBetween(fromIso: string, toIso: string, holidays: Iterable<string> = []): number {
  const holidaySet = holidays instanceof Set ? holidays : new Set(holidays);
  const start = toEpochDay(fromIso);
  const end = toEpochDay(toIso);
  let count = 0;
  for (let d = start; d <= end; d++) {
    const iso = fromEpochDay(d);
    if (isSaturday(iso) || holidaySet.has(iso)) continue;
    count++;
  }
  return count;
}

/** Today in Kathmandu (UTC+05:45), as an ISO date. */
export function todayInNepal(): string {
  const nowUtcMs = Date.now();
  const kathmanduOffsetMs = (5 * 60 + 45) * 60 * 1000;
  return fromEpochDay(Math.floor((nowUtcMs + kathmanduOffsetMs) / MS_PER_DAY));
}

/**
 * The Nepali fiscal year containing a date. FY runs Shrawan 1 (month 4) to
 * Ashadh end (month 3), so "2083/84" starts on Shrawan 1, 2083 BS.
 */
export function fiscalYearOf(iso: string): { code: string; startBs: BsDate; endBs: BsDate } {
  const bs = adToBs(iso);
  const startYear = bs.month >= 4 ? bs.year : bs.year - 1;
  const endYear = startYear + 1;
  return {
    code: `${startYear}/${String(endYear).slice(-2)}`,
    startBs: { year: startYear, month: 4, day: 1 },
    endBs: { year: endYear, month: 3, day: daysInBsMonth(endYear, 3) },
  };
}
