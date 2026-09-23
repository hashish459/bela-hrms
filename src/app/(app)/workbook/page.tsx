import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Flame, Lock } from "lucide-react";
import { requirePermission } from "@/lib/session";
import { addDays, adToBs, BS_MONTHS, todayInNepal, weekdayOf } from "@/lib/bs";
import { cn } from "@/lib/utils";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { hours } from "@/modules/workbook/catalogue";
import { earliestWritable, entryFor, recentDays } from "@/modules/workbook/service";
import { adLabel, dayTitle, stamp, WEEKDAYS } from "./format";
import { EntryView, Rating } from "./entry-view";
import { WorkBookEditor, type EditorInitial } from "./editor";

export const metadata = { title: "My Work-Book" };

/** How far back an author may still look at their own days. */
const HISTORY_DAYS = 90;

/**
 * The author's own work-book, one day at a time. The employee is always the
 * session's — there is no parameter that could point it at anybody else.
 */
export default async function WorkBookPage({ searchParams }: PageProps<"/workbook">) {
  const viewer = await requirePermission("workbook.entry.write");
  if (!viewer.employeeId) notFound();
  const author = { orgId: viewer.orgId, employeeId: viewer.employeeId };

  const params = await searchParams;
  const today = todayInNepal();
  const requested = typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today;
  const date = requested > today || requested < addDays(today, -HISTORY_DAYS) ? today : requested;

  const [entry, previous, strip] = await Promise.all([entryFor(author, date), entryFor(author, addDays(date, -1)), recentDays(author, 14)]);

  const submitted = entry?.status === "submitted";
  const writable = !submitted && (date >= earliestWritable(today) || Boolean(entry?.reopenedAt));
  const done = strip.filter((d) => d.status === "submitted").length;
  let streak = 0;
  for (const d of strip) {
    if (d.status === "submitted") streak++;
    else if (d.weeklyOff || (d.date === today && !d.status)) continue;
    else break;
  }

  const initial: EditorInitial = {
    summary: entry?.summary ?? "",
    blockers: entry?.blockers ?? "",
    planNext: entry?.planNext ?? "",
    selfRating: entry?.selfRating ?? null,
    tasks: (entry?.tasks ?? []).map((t) => ({
      title: t.title,
      details: t.details ?? "",
      category: t.category,
      project: t.project ?? "",
      minutes: t.minutes,
      status: t.status,
      outcome: t.outcome ?? "",
    })),
  };

  const prev = addDays(date, -1);
  const next = addDays(date, 1);

  return (
    <>
      <PageHeader
        title="My Work-Book"
        description="What you worked on, day by day. Save a draft as you go and submit when the day is done — only administrators review work-books."
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* day header */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-gradient-to-br from-accent-soft/60 to-surface p-4">
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-md bg-accent text-on-accent">
                <span className="text-center leading-none">
                  <span className="tabular block text-lg font-semibold">{adToBs(date).day}</span>
                  <span className="block text-[9px] uppercase opacity-80">{BS_MONTHS[adToBs(date).month - 1].slice(0, 3)}</span>
                </span>
              </span>
              <div>
                <p className="text-base font-semibold text-ink">{dayTitle(date)}</p>
                <p className="text-xs text-ink-faint">
                  {adLabel(date)}
                  {date === today ? " · Today" : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {submitted ? (
                <Badge tone="ok">
                  <Lock className="size-3" aria-hidden />
                  Submitted
                </Badge>
              ) : entry ? (
                <Badge tone="warn">Draft</Badge>
              ) : (
                <Badge tone="neutral">Not started</Badge>
              )}
              <nav className="flex items-center rounded border border-line bg-surface" aria-label="Choose a day">
                <Link href={`/workbook?date=${prev}`} className={cn("p-1.5 text-ink-soft hover:bg-sunk hover:text-ink", prev < addDays(today, -HISTORY_DAYS) && "pointer-events-none opacity-30")} aria-label="Previous day">
                  <ChevronLeft className="size-4" />
                </Link>
                <Link href="/workbook" className="border-x border-line px-2.5 py-1 text-xs text-ink-soft hover:bg-sunk hover:text-ink">
                  Today
                </Link>
                <Link
                  href={`/workbook?date=${next}`}
                  className={cn("p-1.5 text-ink-soft hover:bg-sunk hover:text-ink", next > today && "pointer-events-none opacity-30")}
                  aria-label="Next day"
                  aria-disabled={next > today}
                  tabIndex={next > today ? -1 : undefined}
                >
                  <ChevronRight className="size-4" />
                </Link>
              </nav>
            </div>
          </div>

          {writable ? (
            <WorkBookEditor
              key={date}
              date={date}
              initial={initial}
              yesterdayPlan={previous?.planNext ?? null}
              reopenedBy={entry?.reopenedAt ? entry.reopenedByLabel : null}
            />
          ) : entry ? (
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <span className="tabular">{hours(entry.totalMinutes)}</span>
                    <span className="text-ink-faint">·</span>
                    {entry.taskCount} {entry.taskCount === 1 ? "task" : "tasks"}
                  </span>
                }
                description={
                  submitted
                    ? `Submitted ${stamp(entry.submittedAt)}. Locked — an administrator can reopen it for correction.`
                    : `This draft is older than the back-fill window and can no longer be edited.`
                }
                action={<Rating value={entry.selfRating} />}
              />
              <div className="p-4">
                <EntryView entry={entry} />
              </div>
            </Card>
          ) : (
            <Card>
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <CalendarDays className="size-7 text-ink-faint" aria-hidden />
                <p className="text-sm font-medium text-ink-soft">Nothing was written for this day.</p>
                <p className="text-xs text-ink-faint">Only the last 7 days can be back-filled.</p>
              </div>
            </Card>
          )}
        </div>

        {/* the last fortnight */}
        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Last 14 days" description={`${done} submitted`} />
            <div className="p-4">
              <div className="mb-4 flex items-center gap-3 rounded-md bg-sunk p-3">
                <Flame className={cn("size-6", streak ? "text-warn" : "text-ink-faint")} aria-hidden />
                <div>
                  <p className="tabular text-lg leading-none font-semibold text-ink">
                    {streak} {streak === 1 ? "day" : "days"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-faint">submitted in a row</p>
                </div>
              </div>
              <ol className="grid grid-cols-7 gap-1.5">
                {[...strip].reverse().map((d) => {
                  const bs = adToBs(d.date);
                  return (
                    <li key={d.date}>
                      <Link
                        href={d.date === today ? "/workbook" : `/workbook?date=${d.date}`}
                        title={`${dayTitle(d.date)} — ${d.status === "submitted" ? `submitted, ${hours(d.totalMinutes)}` : d.status === "draft" ? "draft" : d.weeklyOff ? "weekly off" : "not written"}`}
                        className={cn(
                          "flex aspect-square flex-col items-center justify-center rounded-md border text-[11px] transition-colors",
                          d.status === "submitted"
                            ? "border-ok/30 bg-ok-soft text-ok"
                            : d.status === "draft"
                              ? "border-warn/30 bg-warn-soft text-warn"
                              : d.weeklyOff
                                ? "border-dashed border-line text-ink-faint/60"
                                : "border-line text-ink-faint hover:bg-sunk",
                          d.date === date && "ring-2 ring-accent ring-offset-1 ring-offset-surface",
                        )}
                      >
                        <span className="text-[8px] uppercase opacity-70">{WEEKDAYS[weekdayOf(d.date)].slice(0, 2)}</span>
                        <span className="tabular font-semibold">{bs.day}</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
              <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-faint">
                <li className="flex items-center gap-1"><span className="size-2 rounded-sm bg-ok" />Submitted</li>
                <li className="flex items-center gap-1"><span className="size-2 rounded-sm bg-warn" />Draft</li>
                <li className="flex items-center gap-1"><span className="size-2 rounded-sm border border-dashed border-line" />Saturday</li>
              </ul>
            </div>
          </Card>

          <Card>
            <CardHeader title="Good entries" />
            <ul className="flex flex-col gap-2 p-4 text-xs text-ink-soft">
              <li>• One task per piece of work — not one per hour.</li>
              <li>• Put the project or client so time can be analysed.</li>
              <li>• Mark anything stuck as <span className="font-medium text-danger">Blocked</span> and say why.</li>
              <li>• You can back-fill up to 7 days; submitting locks the day.</li>
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
