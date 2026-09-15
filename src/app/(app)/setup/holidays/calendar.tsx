import { adToBs, bsToAd, daysInBsMonth, formatBsKey } from "@/lib/bs";
import { Card, CardHeader } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * A Bikram Sambat year, drawn as twelve month grids.
 *
 * A holiday list is a table of dates, and a table of dates does not answer the
 * question people actually bring to this screen: *where are the gaps, and what
 * clusters*. Dashain and Tihar are three weeks apart and between them eat a
 * fortnight of the working year; that is obvious in a grid and invisible in a
 * list sorted by date.
 *
 * Server-rendered on purpose. It is derived entirely from data the page already
 * has, so shipping a client component to draw it would add hydration cost for
 * nothing.
 *
 * Saturdays are shaded rather than marked: they are already the weekly off, and
 * a holiday landing on one costs the organisation nothing. Showing both states
 * on the same cell is what tells a clerk that a "holiday" they just added is
 * worth no extra day.
 */

const BS_MONTHS = [
  "Baishakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
];

const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

export type CalendarHoliday = {
  date: string;
  dateBs: string;
  name: string;
  isActive: boolean;
};

export function HolidayCalendar({
  bsYear,
  holidays,
  today,
  fiscalRange,
}: {
  bsYear: number;
  holidays: CalendarHoliday[];
  today: string;
  /** Highlights the fiscal year's bounds — Shrawan 1 to Ashadh end. */
  fiscalRange?: { from: string; to: string } | null;
}) {
  const byIso = new Map(holidays.filter((h) => h.isActive).map((h) => [h.date, h]));
  const todayBs = adToBs(today);

  return (
    <Card>
      <CardHeader
        title={`Calendar ${bsYear} BS`}
        description="Holidays in context. Saturdays are shaded — a holiday landing on one costs no extra day."
      />

      <div className="grid grid-cols-2 gap-x-3 gap-y-4 p-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
        {BS_MONTHS.map((monthName, index) => {
          const month = index + 1;
          const days = daysInBsMonth(bsYear, month);

          // A month outside the published calendar table is skipped rather than
          // guessed: BS month lengths are astronomical, not computable.
          if (!days) return null;

          const firstIso = bsToAd({ year: bsYear, month, day: 1 });
          const leading = new Date(firstIso).getUTCDay();
          const isCurrentMonth = todayBs.year === bsYear && todayBs.month === month;

          return (
            <div key={monthName}>
              <p
                className={cn(
                  "mb-1 text-[11px] font-medium",
                  isCurrentMonth ? "text-accent" : "text-ink-soft",
                )}
              >
                {monthName}
              </p>

              <div className="grid grid-cols-7 gap-px">
                {WEEKDAY_INITIALS.map((initial, i) => (
                  <span
                    key={`${initial}-${i}`}
                    className="grid h-4 place-items-center text-[9px] text-ink-faint"
                    aria-hidden
                  >
                    {initial}
                  </span>
                ))}

                {Array.from({ length: leading }, (_, i) => (
                  <span key={`pad-${i}`} />
                ))}

                {Array.from({ length: days }, (_, i) => {
                  const day = i + 1;
                  const iso = bsToAd({ year: bsYear, month, day });
                  const weekday = new Date(iso).getUTCDay();
                  const holiday = byIso.get(iso);
                  const isToday = iso === today;
                  const inFiscal =
                    !fiscalRange || (iso >= fiscalRange.from && iso <= fiscalRange.to);

                  return (
                    <span
                      key={day}
                      title={
                        holiday
                          ? `${holiday.name} — ${formatBsKey({ year: bsYear, month, day })}`
                          : formatBsKey({ year: bsYear, month, day })
                      }
                      className={cn(
                        "tabular grid h-5 place-items-center rounded-[3px] text-[10px] leading-none",
                        weekday === 6 && !holiday ? "bg-sunk text-ink-faint" : "",
                        holiday ? "bg-accent font-semibold text-on-accent" : "",
                        !holiday && weekday !== 6 ? "text-ink-soft" : "",
                        isToday ? "ring-1 ring-accent ring-offset-1 ring-offset-surface" : "",
                        inFiscal ? "" : "opacity-40",
                      )}
                    >
                      {day}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft px-3 py-2 text-[10px] text-ink-faint">
        <Legend className="bg-accent" label="Holiday" />
        <Legend className="bg-sunk" label="Saturday" />
        <Legend className="ring-1 ring-accent" label="Today" />
        {fiscalRange ? <span>Faded days fall outside the current fiscal year.</span> : null}
      </div>
    </Card>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-[3px]", className)} aria-hidden />
      {label}
    </span>
  );
}
