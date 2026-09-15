import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { personalCalendar } from "@/modules/selfservice/desk";
import { requireSelf } from "@/modules/selfservice/guard";
import { adToBs, bsToAd, daysInBsMonth, todayInNepal } from "@/lib/bs";
import { Card, PageHeader, StatTile } from "@/components/ui";
import { STATUS_META } from "../parts";

export const metadata = { title: "My calendar" };

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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Search = { [key: string]: string | string[] | undefined };

/**
 * The personal calendar from the manual — "click the attendance date and apply
 * leave, attendance request or in/out request".
 *
 * A Bikram Sambat month, because that is the period attendance and payroll are
 * counted in. A Gregorian grid would split a Nepali payroll month across two
 * screens and the totals underneath it would match neither.
 *
 * Every day that can be acted on is a link carrying the date, so the action
 * lands on the right day without the employee re-entering it — the step people
 * most often got wrong on the legacy screen.
 */
export default async function MyCalendarPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireSelf();
  const params = await searchParams;

  const today = todayInNepal();
  const todayBs = adToBs(today);

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const year = Number(one(params.y)) || todayBs.year;
  const month = Math.min(12, Math.max(1, Number(one(params.m)) || todayBs.month));

  const days = daysInBsMonth(year, month);
  const from = bsToAd({ year, month, day: 1 });
  const to = bsToAd({ year, month, day: days });

  const entries = await personalCalendar(ctx, { from, to });

  const leading = new Date(from).getUTCDay();
  const counted = entries.filter(
    (d) => d.status && !["weekly_off", "holiday", "not_marked"].includes(d.status),
  );
  const present = counted.filter((d) => d.status === "present" || d.status === "field_work").length;
  const onLeave = counted.filter((d) => d.status === "on_leave").length;
  const absent = counted.filter((d) => d.status === "absent").length;
  const exceptions = entries.filter(
    (d) => d.status === "missing_punch" || d.status === "absent",
  ).length;

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };

  return (
    <>
      <PageHeader
        title="My calendar"
        description="Your month at a glance. Click any day to raise a request against it."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Days at work" value={present} tone="ok" />
        <StatTile label="On leave" value={onLeave} tone="accent" />
        <StatTile label="Absent" value={absent} tone={absent > 0 ? "danger" : "neutral"} />
        <StatTile
          label="Needs attention"
          value={exceptions}
          sub={exceptions > 0 ? "missing punches or absences" : "nothing outstanding"}
          tone={exceptions > 0 ? "warn" : "neutral"}
        />
      </div>

      <Card>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              {BS_MONTHS[month - 1]} {year} BS
            </h2>
            <p className="tabular mt-0.5 text-[11px] text-ink-faint">
              {new Date(from).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} —{" "}
              {new Date(to).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>

          <div className="flex items-center gap-1">
            <MonthLink href={`/me/calendar?y=${prev.y}&m=${prev.m}`} label="Previous month">
              <ChevronLeft className="size-4" />
            </MonthLink>
            <Link
              href="/me/calendar"
              className="rounded border border-line px-2 py-1 text-[11px] text-ink-soft hover:bg-sunk hover:text-ink"
            >
              This month
            </Link>
            <MonthLink href={`/me/calendar?y=${next.y}&m=${next.m}`} label="Next month">
              <ChevronRight className="size-4" />
            </MonthLink>
          </div>
        </header>

        <div className="p-3">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w, i) => (
              <span
                key={w}
                className={`px-1 pb-1 text-center text-[10px] font-medium ${
                  i === 6 ? "text-ink-faint" : "text-ink-soft"
                }`}
              >
                {w}
              </span>
            ))}

            {Array.from({ length: leading }, (_, i) => (
              <span key={`pad-${i}`} />
            ))}

            {entries.map((d) => (
              <DayCell key={d.date} entry={d} />
            ))}
          </div>
        </div>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line-soft px-4 py-2.5 text-[10px] text-ink-faint">
          {["present", "field_work", "half_day", "on_leave", "absent", "missing_punch"].map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-full"
                style={{ background: STATUS_META[s].dot }}
                aria-hidden
              />
              {STATUS_META[s].label}
            </span>
          ))}
          <span className="ml-auto">Click a day to apply for leave or fix a punch.</span>
        </footer>
      </Card>
    </>
  );
}

function MonthLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="grid size-7 place-items-center rounded border border-line text-ink-soft hover:bg-sunk hover:text-ink"
    >
      {children}
    </Link>
  );
}

/**
 * One day.
 *
 * A future day links to the leave form; a past day with a problem links to the
 * attendance-correction form. That split is the whole interaction: you cannot
 * correct a day that has not happened, and you rarely book leave for one that
 * has. Days with nothing to do are rendered as static cells rather than dead
 * links, so the pointer only changes over something actionable.
 */
function DayCell({ entry }: { entry: Awaited<ReturnType<typeof personalCalendar>>[number] }) {
  const meta = entry.status ? STATUS_META[entry.status] : null;
  const isOff = entry.status === "weekly_off" || entry.status === "holiday";
  const needsFix = entry.status === "missing_punch" || entry.status === "absent";

  const body = (
    <>
      <span className="flex items-start justify-between gap-1">
        <span
          className={`tabular text-[11px] font-medium ${
            entry.isToday ? "text-accent" : isOff ? "text-ink-faint" : "text-ink"
          }`}
        >
          {entry.day}
        </span>
        {meta && !isOff ? (
          <span
            className="mt-0.5 size-2 shrink-0 rounded-full"
            style={{ background: meta.dot }}
            aria-hidden
          />
        ) : null}
      </span>

      {entry.holidayName ? (
        <span className="mt-auto line-clamp-2 text-[9px] leading-tight text-accent">
          {entry.holidayName}
        </span>
      ) : entry.leaveName ? (
        <span
          className="mt-auto line-clamp-2 text-[9px] leading-tight"
          style={{ color: entry.leaveColour ?? "var(--color-accent)" }}
        >
          {entry.leaveName}
        </span>
      ) : entry.checkIn ? (
        <span className="tabular mt-auto text-[9px] leading-tight text-ink-faint">
          {entry.checkIn.slice(0, 5)}
          {entry.checkOut ? `–${entry.checkOut.slice(0, 5)}` : ""}
        </span>
      ) : needsFix ? (
        <span className="mt-auto text-[9px] leading-tight text-warn">needs a fix</span>
      ) : null}
    </>
  );

  const shell = [
    "flex h-16 flex-col rounded-md border p-1.5 transition-colors",
    entry.isToday ? "border-accent ring-1 ring-accent" : "border-line",
    isOff ? "bg-sunk" : "bg-surface",
    needsFix ? "border-warn/50" : "",
  ].join(" ");

  const title = `${entry.dateBs} · ${meta?.label ?? "Not marked"}${
    entry.holidayName ? ` · ${entry.holidayName}` : ""
  }`;

  if (isOff || (!needsFix && !entry.isFuture && entry.status === "present")) {
    return (
      <span className={shell} title={title}>
        {body}
      </span>
    );
  }

  const href = entry.isFuture
    ? `/leave/my?from=${entry.date}`
    : `/attendance/requests?date=${entry.date}`;

  return (
    <Link href={href} className={`${shell} hover:border-accent hover:bg-accent-soft`} title={`${title} — click to ${entry.isFuture ? "apply for leave" : "raise a correction"}`}>
      {body}
    </Link>
  );
}
