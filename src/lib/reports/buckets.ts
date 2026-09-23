/**
 * Time buckets for trend charts, and the number formats every report shares.
 *
 * Pure. Module-neutral, so attendance and leave draw the same axis for the
 * same period — a report that buckets Shrawan by week while its neighbour
 * buckets it by day invites the reader to compare columns that mean different
 * things.
 */
import { adToBs, BS_MONTHS } from "@/lib/bs";

export type Granularity = "day" | "week" | "month";

export type DateBucket = {
  label: string;
  /** Tooltip text: the full date or range the bucket covers. */
  sublabel: string;
  from: string;
  to: string;
  /** Indexes into the input array, in order. */
  indexes: number[];
};

/**
 * Axis abbreviations. Not a three-letter slice: Ashadh and Ashwin would both
 * read "Ash", and a 90-day trend spans both of them.
 */
export const BS_MONTH_SHORT = ["Bai", "Jes", "Asr", "Shr", "Bha", "Asw", "Kar", "Man", "Pou", "Mag", "Fal", "Cha"];

/**
 * Groups consecutive ISO dates so a chart stays readable: a column per day up
 * to two months, per week up to about four, then one per Bikram Sambat month —
 * the unit payroll closes on, so a long trend lines up with payslips.
 */
export function bucketDates(dates: readonly string[]): { granularity: Granularity; buckets: DateBucket[] } {
  const granularity: Granularity = dates.length <= 62 ? "day" : dates.length <= 126 ? "week" : "month";

  const groups: number[][] = [];
  if (granularity === "day") {
    dates.forEach((_, i) => groups.push([i]));
  } else if (granularity === "week") {
    for (let i = 0; i < dates.length; i += 7) {
      groups.push(Array.from({ length: Math.min(7, dates.length - i) }, (_, k) => i + k));
    }
  } else {
    let current: number[] = [];
    let key = "";
    dates.forEach((d, i) => {
      const bs = adToBs(d);
      const k = `${bs.year}-${bs.month}`;
      if (k !== key && current.length) {
        groups.push(current);
        current = [];
      }
      key = k;
      current.push(i);
    });
    if (current.length) groups.push(current);
  }

  const buckets = groups.map((indexes) => {
    const from = dates[indexes[0]];
    const to = dates[indexes[indexes.length - 1]];
    const bs = adToBs(from);

    let label: string;
    let sublabel: string;
    if (granularity === "day") {
      label = String(bs.day);
      sublabel = from;
    } else if (granularity === "week") {
      label = `${bs.day} ${BS_MONTH_SHORT[bs.month - 1]}`;
      sublabel = `${from} – ${to}`;
    } else {
      label = BS_MONTH_SHORT[bs.month - 1];
      sublabel = `${BS_MONTHS[bs.month - 1]} ${bs.year}`;
    }
    return { label, sublabel, from, to, indexes };
  });

  return { granularity, buckets };
}

/* -------------------------------------------------------------- formatting */

/** "92.4%", or "—" when there is nothing to divide by. */
export function formatRate(rate: number | null, digits = 1): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(digits)}%`;
}

/** Half days make fractional totals; show them without a trailing ".0". */
export function formatDayCount(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}
