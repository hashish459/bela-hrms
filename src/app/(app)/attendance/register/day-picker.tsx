"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, adToBs, formatBsKey, parseBsKey, bsToAd } from "@/lib/bs";

/** Day stepper for the register, in both calendars. */
export function DayPicker({ date, today }: { date: string; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (next: string) => {
    if (next > today) return;
    startTransition(() => router.replace(`/attendance/register?d=${next}`));
  };

  return (
    <div className="flex items-center gap-2" aria-busy={pending}>
      <button
        type="button"
        onClick={() => go(addDays(date, -1))}
        className="rounded border border-line p-1.5 text-ink-soft hover:bg-sunk hover:text-ink"
        aria-label="Previous day"
      >
        <ChevronLeft className="size-4" />
      </button>

      <input
        aria-label="Date, Bikram Sambat"
        defaultValue={formatBsKey(adToBs(date))}
        onChange={(e) => {
          const bs = parseBsKey(e.target.value);
          if (bs) go(bsToAd(bs));
        }}
        className="tabular w-28 rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
      />

      <input
        type="date"
        aria-label="Date, Gregorian"
        value={date}
        max={today}
        onChange={(e) => e.target.value && go(e.target.value)}
        className="tabular rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
      />

      <button
        type="button"
        onClick={() => go(addDays(date, 1))}
        disabled={date >= today}
        className="rounded border border-line p-1.5 text-ink-soft hover:bg-sunk hover:text-ink disabled:opacity-40"
        aria-label="Next day"
      >
        <ChevronRight className="size-4" />
      </button>

      {date !== today ? (
        <button
          type="button"
          onClick={() => go(today)}
          className="rounded border border-line px-2 py-1.5 text-xs text-ink-soft hover:bg-sunk hover:text-ink"
        >
          Today
        </button>
      ) : null}
    </div>
  );
}
