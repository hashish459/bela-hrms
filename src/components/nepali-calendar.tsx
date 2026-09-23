"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Languages, PartyPopper, Plane } from "lucide-react";
import {
  addDays,
  adToBs,
  bsToAd,
  BS_MAX_YEAR,
  BS_MIN_YEAR,
  BS_MONTHS,
  BS_MONTHS_NP,
  daysInBsMonth,
  weekdayOf,
} from "@/lib/bs";
import { cn } from "@/lib/utils";

export type CalendarHoliday = { date: string; name: string; nameNepali: string | null; isHalfDay: boolean };
export type CalendarMark = { date: string; label: string; tone: "leave" | "pending" };

const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_NP = ["आइत", "सोम", "मंगल", "बुध", "बिहि", "शुक्र", "शनि"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const AD_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEVANAGARI = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];

const np = (n: number | string) => String(n).replace(/\d/g, (d) => DEVANAGARI[Number(d)]);

/** "23 Sep 2026" without the locale APIs, so server and browser render the same text. */
function adLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${AD_MONTHS[m - 1]} ${y}`;
}

function adMonthYear(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return `${AD_MONTHS[m - 1]} ${y}`;
}

/**
 * The organisation's calendar in Bikram Sambat — the calendar Nepal actually
 * lives by — opening on today. Saturdays and public holidays are marked the
 * way a printed Nepali calendar marks them; the Gregorian date sits in the
 * corner of every day for anybody who thinks in AD.
 *
 * Everything is computed from the BS table in `lib/bs`, which is pure, so the
 * month grid renders identically on the server and in the browser and
 * navigation never needs a round trip.
 */
export function NepaliCalendar({
  today,
  holidays,
  marks = [],
}: {
  /** Today in Kathmandu, ISO. */
  today: string;
  holidays: CalendarHoliday[];
  /** The viewer's own leave, when they have any. */
  marks?: CalendarMark[];
}) {
  const todayBs = useMemo(() => adToBs(today), [today]);
  const [cursor, setCursor] = useState({ year: todayBs.year, month: todayBs.month });
  const [selected, setSelected] = useState(today);
  const [nepali, setNepali] = useState(false);

  const holidayByDate = useMemo(() => {
    const map = new Map<string, CalendarHoliday[]>();
    for (const h of holidays) map.set(h.date, [...(map.get(h.date) ?? []), h]);
    return map;
  }, [holidays]);
  const markByDate = useMemo(() => new Map(marks.map((m) => [m.date, m])), [marks]);

  const grid = useMemo(() => {
    const first = bsToAd({ year: cursor.year, month: cursor.month, day: 1 });
    const length = daysInBsMonth(cursor.year, cursor.month);
    const lead = weekdayOf(first);
    const cells: ({ iso: string; day: number } | null)[] = Array.from({ length: lead }, () => null);
    for (let i = 0; i < length; i++) cells.push({ iso: addDays(first, i), day: i + 1 });
    while (cells.length % 7) cells.push(null);
    return { cells, first, last: addDays(first, length - 1) };
  }, [cursor]);

  const shift = (delta: number) => {
    let { year, month } = cursor;
    month += delta;
    if (month < 1) {
      month = 12;
      year -= 1;
    } else if (month > 12) {
      month = 1;
      year += 1;
    }
    if (year < BS_MIN_YEAR || year > BS_MAX_YEAR) return;
    setCursor({ year, month });
  };

  const goToday = () => {
    setCursor({ year: todayBs.year, month: todayBs.month });
    setSelected(today);
  };

  const monthHolidays = holidays.filter((h) => h.date >= grid.first && h.date <= grid.last);
  const sel = adToBs(selected);
  const selHolidays = holidayByDate.get(selected) ?? [];
  const selMark = markByDate.get(selected);
  const onThisMonth = cursor.year === todayBs.year && cursor.month === todayBs.month;
  const num = (n: number) => (nepali ? np(n) : String(n));

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm" aria-label="Nepali calendar">
      {/* ---------------------------------------------------------------- head */}
      <header className="flex items-center gap-2 bg-gradient-to-r from-accent to-accent/80 px-4 py-3 text-on-accent">
        <CalendarDays className="size-4 shrink-0 opacity-90" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" aria-live="polite">
            {nepali ? BS_MONTHS_NP[cursor.month - 1] : BS_MONTHS[cursor.month - 1]} {num(cursor.year)}
            <span className="ml-1.5 text-xs font-normal opacity-80">
              {nepali ? BS_MONTHS[cursor.month - 1] : BS_MONTHS_NP[cursor.month - 1]}
            </span>
          </p>
          <p className="truncate text-[11px] opacity-80">
            {adMonthYear(grid.first) === adMonthYear(grid.last) ? adMonthYear(grid.first) : `${adMonthYear(grid.first)} – ${adMonthYear(grid.last)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNepali((v) => !v)}
          className="rounded p-1.5 opacity-90 hover:bg-white/15 hover:opacity-100"
          aria-pressed={nepali}
          title={nepali ? "Show English numerals" : "नेपाली अंकमा देखाउनुहोस्"}
          aria-label="Toggle Nepali numerals"
        >
          <Languages className="size-4" />
        </button>
        {!onThisMonth ? (
          <button type="button" onClick={goToday} className="rounded bg-white/15 px-2 py-1 text-[11px] font-medium hover:bg-white/25">
            {nepali ? "आज" : "Today"}
          </button>
        ) : null}
        <button type="button" onClick={() => shift(-1)} className="rounded p-1.5 hover:bg-white/15" aria-label="Previous month">
          <ChevronLeft className="size-4" />
        </button>
        <button type="button" onClick={() => shift(1)} className="rounded p-1.5 hover:bg-white/15" aria-label="Next month">
          <ChevronRight className="size-4" />
        </button>
      </header>

      {/* ---------------------------------------------------------------- grid */}
      <div className="px-3 pt-3 pb-2">
        <div className="grid grid-cols-7 text-center text-[10px] font-medium tracking-wide uppercase" aria-hidden>
          {(nepali ? WEEKDAYS_NP : WEEKDAYS_EN).map((w, i) => (
            <span key={w} className={cn("pb-1.5", i === 6 ? "text-danger" : "text-ink-faint")}>
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1" role="grid">
          {grid.cells.map((cell, i) => {
            if (!cell) return <span key={`blank-${i}`} aria-hidden />;
            const isToday = cell.iso === today;
            const isSelected = cell.iso === selected;
            const isSaturday = i % 7 === 6;
            const hol = holidayByDate.get(cell.iso);
            const mark = markByDate.get(cell.iso);
            const off = isSaturday || !!hol;
            return (
              <button
                key={cell.iso}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                aria-current={isToday ? "date" : undefined}
                aria-label={`${cell.day} ${BS_MONTHS[cursor.month - 1]} ${cursor.year}${hol ? `, ${hol.map((h) => h.name).join(", ")}` : ""}`}
                onClick={() => setSelected(cell.iso)}
                className={cn(
                  "relative flex aspect-square flex-col items-center justify-center rounded-md text-sm transition-colors",
                  isSelected ? "bg-accent text-on-accent shadow" : off ? "text-danger hover:bg-danger-soft/60" : "text-ink hover:bg-sunk",
                  isToday && !isSelected ? "ring-2 ring-accent ring-offset-1 ring-offset-surface font-semibold" : "",
                  hol && !isSelected ? "bg-danger-soft/50" : "",
                )}
              >
                <span className="tabular leading-none font-medium">{num(cell.day)}</span>
                <span className={cn("tabular mt-0.5 text-[9px] leading-none", isSelected ? "opacity-80" : "text-ink-faint")}>
                  {Number(cell.iso.slice(8))}
                </span>
                {mark ? (
                  <span
                    className={cn(
                      "absolute bottom-1 size-1.5 rounded-full",
                      mark.tone === "leave" ? "bg-info" : "bg-warn",
                      isSelected ? "ring-1 ring-white" : "",
                    )}
                    aria-hidden
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* ----------------------------------------------------------- selected */}
      <div className="border-t border-line-soft px-4 py-3">
        <p className="text-sm font-semibold text-ink">
          {nepali
            ? `${np(sel.day)} ${BS_MONTHS_NP[sel.month - 1]} ${np(sel.year)}, ${WEEKDAYS_NP[weekdayOf(selected)]}बार`
            : `${WEEKDAYS_LONG[weekdayOf(selected)]}, ${sel.day} ${BS_MONTHS[sel.month - 1]} ${sel.year}`}
          {selected === today ? (
            <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 align-middle text-[10px] font-medium text-accent">
              {nepali ? "आज" : "Today"}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-ink-faint">{adLabel(selected)} AD</p>
        {selHolidays.map((h) => (
          <p key={h.name} className="mt-1.5 flex items-center gap-1.5 text-xs text-danger">
            <PartyPopper className="size-3.5" aria-hidden />
            {nepali && h.nameNepali ? h.nameNepali : h.name}
            {h.isHalfDay ? <span className="text-ink-faint">(half day)</span> : null}
          </p>
        ))}
        {selMark ? (
          <p className={cn("mt-1.5 flex items-center gap-1.5 text-xs", selMark.tone === "leave" ? "text-info" : "text-warn")}>
            <Plane className="size-3.5" aria-hidden />
            {selMark.label}
          </p>
        ) : null}
        {weekdayOf(selected) === 6 && selHolidays.length === 0 ? (
          <p className="mt-1.5 text-xs text-ink-faint">{nepali ? "साप्ताहिक बिदा" : "Weekly off"}</p>
        ) : null}
      </div>

      {/* ------------------------------------------------------ month holidays */}
      {monthHolidays.length ? (
        <ul className="border-t border-line-soft px-4 py-2.5">
          {monthHolidays.map((h) => {
            const b = adToBs(h.date);
            return (
              <li key={`${h.date}-${h.name}`}>
                <button
                  type="button"
                  onClick={() => setSelected(h.date)}
                  className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-sunk"
                >
                  <span className="tabular w-6 shrink-0 text-center font-semibold text-danger">{num(b.day)}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-soft">{nepali && h.nameNepali ? h.nameNepali : h.name}</span>
                  <span className="text-[10px] text-ink-faint">{WEEKDAYS_EN[weekdayOf(h.date)]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <footer className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line-soft px-4 py-2 text-[10px] text-ink-faint">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm bg-danger-soft ring-1 ring-danger/40" /> Holiday / Saturday
        </span>
        {marks.length ? (
          <>
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-info" /> My leave
            </span>
            <span className="flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-warn" /> Awaiting approval
            </span>
          </>
        ) : null}
      </footer>
    </section>
  );
}
