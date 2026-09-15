import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BS_MONTHS, BS_MONTHS_NP, bsToAd, daysInBsMonth, BS_MAX_YEAR, BS_MIN_YEAR } from "@/lib/bs";

export type BsMonth = { year: number; month: number };

/** Shifts a BS year/month by n months, staying inside the published calendar. */
export function shiftBsMonth({ year, month }: BsMonth, delta: number): BsMonth | null {
  const total = year * 12 + (month - 1) + delta;
  const next = { year: Math.floor(total / 12), month: (total % 12) + 1 };
  if (next.year < BS_MIN_YEAR || next.year > BS_MAX_YEAR) return null;
  return next;
}

/** The Gregorian range a BS month covers. */
export function bsMonthBounds({ year, month }: BsMonth) {
  return {
    from: bsToAd({ year, month, day: 1 }),
    to: bsToAd({ year, month, day: daysInBsMonth(year, month) }),
  };
}

/**
 * Month stepper for attendance and leave views.
 *
 * Periods are Bikram Sambat months, not Gregorian ones — a Nepali payroll month
 * runs Shrawan 1 to Shrawan 32, and slicing on Gregorian boundaries would split
 * every month across two payslips.
 */
export function BsMonthNav({
  basePath,
  current,
  extraParams,
}: {
  basePath: string;
  current: BsMonth;
  extraParams?: Record<string, string | undefined>;
}) {
  const prev = shiftBsMonth(current, -1);
  const next = shiftBsMonth(current, 1);
  const { from, to } = bsMonthBounds(current);

  const href = (m: BsMonth) => ({
    pathname: basePath,
    query: { ...extraParams, y: String(m.year), m: String(m.month) },
  });

  const gregorian = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {prev ? (
        <Link
          href={href(prev)}
          className="rounded border border-line p-1.5 text-ink-soft hover:bg-sunk hover:text-ink"
          aria-label="Previous month"
        >
          <ChevronLeft className="size-4" />
        </Link>
      ) : null}

      <div className="min-w-44 text-center">
        <p className="text-sm font-semibold text-ink">
          {BS_MONTHS[current.month - 1]} {current.year}
          <span className="ml-1.5 text-xs font-normal text-ink-faint">
            {BS_MONTHS_NP[current.month - 1]}
          </span>
        </p>
        <p className="tabular text-[11px] text-ink-faint">
          {gregorian(from)} – {gregorian(to)}
        </p>
      </div>

      {next ? (
        <Link
          href={href(next)}
          className="rounded border border-line p-1.5 text-ink-soft hover:bg-sunk hover:text-ink"
          aria-label="Next month"
        >
          <ChevronRight className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}
