import Link from "next/link";
import { CalendarCheck2, Clock3, Flame, TriangleAlert } from "lucide-react";
import { adToBs, BS_MONTHS, weekdayOf } from "@/lib/bs";
import { cn } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui";
import { hours } from "@/modules/workbook/catalogue";
import { dayTitle } from "./format";

type Day = { date: string; status: "draft" | "submitted" | null; totalMinutes: number; taskCount: number; weeklyOff: boolean };

const HEAD = ["S", "M", "T", "W", "T", "F", "S"];
/** The day the colour scale tops out at. */
const FULL_DAY = 8 * 60;

/**
 * The last 30 days at a glance: a calendar-aligned heat grid (deeper green is
 * more hours), with the figures that matter above it — how many working days
 * are submitted, hours in total and per day, the current streak, and which
 * days were missed.
 */
export function WorkBookGlance({ days, today, selected }: { days: Day[]; today: string; selected: string }) {
  const ordered = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  // counted from the first day this person actually wrote, so starting to use
  // the work-book mid-month does not show the weeks before as missed; today
  // counts once it has been written
  const started = ordered.find((d) => d.status)?.date ?? today;
  const working = ordered.filter((d) => !d.weeklyOff && d.date >= started && (d.date !== today || d.status));
  const submitted = ordered.filter((d) => d.status === "submitted");
  const drafts = ordered.filter((d) => d.status === "draft").length;
  const missed = working.filter((d) => !d.status);
  const isMissedDay = (d: Day) => !d.status && !d.weeklyOff && d.date !== today && d.date >= started;
  const minutes = submitted.reduce((s, d) => s + d.totalMinutes, 0);
  const rate = working.length ? Math.round((working.filter((d) => d.status === "submitted").length / working.length) * 100) : 0;

  let streak = 0;
  for (const d of [...ordered].reverse()) {
    if (d.status === "submitted") streak++;
    else if (d.weeklyOff || (d.date === today && !d.status)) continue;
    else break;
  }

  const first = ordered[0];
  const lead = first ? weekdayOf(first.date) : 0;
  const firstBs = first ? adToBs(first.date) : null;
  const lastBs = ordered.length ? adToBs(ordered[ordered.length - 1].date) : null;
  const span =
    firstBs && lastBs
      ? firstBs.month === lastBs.month
        ? `${BS_MONTHS[firstBs.month - 1]} ${firstBs.year}`
        : `${BS_MONTHS[firstBs.month - 1]} – ${BS_MONTHS[lastBs.month - 1]} ${lastBs.year}`
      : "";

  return (
    <Card>
      <CardHeader title="Last 30 days" description={span} />
      <div className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md bg-sunk p-2.5">
            <p className="flex items-center gap-1 text-[10px] tracking-wide text-ink-faint uppercase">
              <CalendarCheck2 className="size-3" aria-hidden />
              Submitted
            </p>
            <p className="tabular mt-1 text-lg leading-none font-semibold text-ink">
              {rate}
              <span className="text-xs font-normal text-ink-faint">%</span>
            </p>
            <p className="mt-0.5 text-[10px] text-ink-faint">
              {submitted.length} of {working.length} working days
            </p>
          </div>
          <div className="rounded-md bg-sunk p-2.5">
            <p className="flex items-center gap-1 text-[10px] tracking-wide text-ink-faint uppercase">
              <Clock3 className="size-3" aria-hidden />
              Hours
            </p>
            <p className="tabular mt-1 text-lg leading-none font-semibold text-ink">{hours(minutes)}</p>
            <p className="mt-0.5 text-[10px] text-ink-faint">{submitted.length ? `${hours(Math.round(minutes / submitted.length))} a day` : "none yet"}</p>
          </div>
          <div className="rounded-md bg-sunk p-2.5">
            <p className="flex items-center gap-1 text-[10px] tracking-wide text-ink-faint uppercase">
              <Flame className={cn("size-3", streak && "text-warn")} aria-hidden />
              Streak
            </p>
            <p className="tabular mt-1 text-lg leading-none font-semibold text-ink">
              {streak}
              <span className="text-xs font-normal text-ink-faint"> {streak === 1 ? "day" : "days"}</span>
            </p>
            <p className="mt-0.5 text-[10px] text-ink-faint">submitted in a row</p>
          </div>
          <div className={cn("rounded-md p-2.5", missed.length ? "bg-danger-soft/60" : "bg-sunk")}>
            <p className="flex items-center gap-1 text-[10px] tracking-wide text-ink-faint uppercase">
              <TriangleAlert className={cn("size-3", missed.length && "text-danger")} aria-hidden />
              Missed
            </p>
            <p className={cn("tabular mt-1 text-lg leading-none font-semibold", missed.length ? "text-danger" : "text-ink")}>{missed.length}</p>
            <p className="mt-0.5 text-[10px] text-ink-faint">{drafts ? `${drafts} draft${drafts === 1 ? "" : "s"} open` : "no drafts open"}</p>
          </div>
        </div>

        <div>
          <div className="mb-1 grid grid-cols-7 gap-1">
            {HEAD.map((h, i) => (
              <span key={i} className={cn("text-center text-[9px] font-medium", i === 6 ? "text-danger" : "text-ink-faint")}>
                {h}
              </span>
            ))}
          </div>
          <ol className="grid grid-cols-7 gap-1">
            {Array.from({ length: lead }, (_, i) => (
              <li key={`pad-${i}`} aria-hidden />
            ))}
            {ordered.map((d) => {
              const bs = adToBs(d.date);
              const isMissed = isMissedDay(d);
              const depth = d.status === "submitted" ? Math.max(0.25, Math.min(1, d.totalMinutes / FULL_DAY)) : 0;
              const label =
                d.status === "submitted"
                  ? `submitted · ${hours(d.totalMinutes)} · ${d.taskCount} ${d.taskCount === 1 ? "task" : "tasks"}`
                  : d.status === "draft"
                    ? `draft · ${hours(d.totalMinutes)}`
                    : d.weeklyOff
                      ? "weekly off"
                      : d.date === today
                        ? "today — not written yet"
                        : "not written";
              return (
                <li key={d.date}>
                  <Link
                    href={d.date === today ? "/workbook" : `/workbook?date=${d.date}`}
                    title={`${dayTitle(d.date)} — ${label}`}
                    aria-label={`${dayTitle(d.date)}: ${label}`}
                    aria-current={d.date === selected ? "date" : undefined}
                    className={cn(
                      "relative flex aspect-square flex-col items-center justify-center rounded-md border text-[10px] transition-transform hover:scale-110 hover:shadow-sm",
                      d.status === "submitted"
                        ? "border-transparent text-white"
                        : d.status === "draft"
                          ? "border-warn/40 bg-warn-soft text-warn"
                          : d.weeklyOff
                            ? "border-dashed border-line text-ink-faint/60"
                            : isMissed
                              ? "border-danger/40 bg-danger-soft/40 text-danger"
                              : "border-line text-ink-faint",
                      d.date === selected && "ring-2 ring-accent ring-offset-1 ring-offset-surface",
                    )}
                    style={
                      d.status === "submitted"
                        ? { background: `color-mix(in srgb, var(--color-ok) ${Math.round(depth * 100)}%, var(--color-ok-soft))` }
                        : undefined
                    }
                  >
                    {bs.day === 1 ? (
                      <span className="absolute -top-1.5 left-0.5 rounded bg-surface px-0.5 text-[7px] font-semibold text-ink-soft uppercase shadow-sm">
                        {BS_MONTHS[bs.month - 1].slice(0, 3)}
                      </span>
                    ) : null}
                    <span className={cn("tabular font-semibold", d.date === today && d.status !== "submitted" && "text-accent")}>{bs.day}</span>
                    {d.date === today ? <span className="absolute bottom-0.5 size-1 rounded-full bg-accent" aria-hidden /> : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>

        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-faint">
          <li className="flex items-center gap-1">
            Fewer
            <span className="flex gap-0.5" aria-hidden>
              {[0.25, 0.5, 0.75, 1].map((v) => (
                <span key={v} className="size-2 rounded-sm" style={{ background: `color-mix(in srgb, var(--color-ok) ${v * 100}%, var(--color-ok-soft))` }} />
              ))}
            </span>
            more hours
          </li>
          <li className="flex items-center gap-1"><span className="size-2 rounded-sm bg-warn" />Draft</li>
          <li className="flex items-center gap-1"><span className="size-2 rounded-sm border border-danger/50 bg-danger-soft" />Missed</li>
          <li className="flex items-center gap-1"><span className="size-2 rounded-sm border border-dashed border-line" />Saturday</li>
        </ul>
      </div>
    </Card>
  );
}
