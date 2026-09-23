import { AlertTriangle, CheckCircle2, CircleDot, Compass, Flag, FolderKanban, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_BY_KEY, hours, type CategoryKey } from "@/modules/workbook/catalogue";

export type ViewTask = {
  id: string;
  title: string;
  details: string | null;
  category: string;
  project: string | null;
  minutes: number;
  status: string;
  outcome: string | null;
};

export type ViewEntry = {
  summary: string | null;
  blockers: string | null;
  planNext: string | null;
  selfRating: number | null;
  totalMinutes: number;
  tasks: ViewTask[];
};

const STATUS = {
  done: { label: "Done", icon: CheckCircle2, className: "text-ok" },
  in_progress: { label: "In progress", icon: CircleDot, className: "text-info" },
  blocked: { label: "Blocked", icon: AlertTriangle, className: "text-danger" },
} as const;

/** The proportion of the day each category took, as one thin bar. */
export function CategoryBar({ tasks, className }: { tasks: { category: string; minutes: number }[]; className?: string }) {
  const total = tasks.reduce((s, t) => s + t.minutes, 0);
  if (!total) return null;
  const by = new Map<string, number>();
  for (const t of tasks) by.set(t.category, (by.get(t.category) ?? 0) + t.minutes);
  const parts = [...by].sort((a, b) => b[1] - a[1]);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex h-2 overflow-hidden rounded-full bg-sunk" role="img" aria-label="Time by category">
        {parts.map(([k, m]) => (
          <span key={k} style={{ width: `${(m / total) * 100}%`, background: CATEGORY_BY_KEY.get(k as CategoryKey)?.colour ?? "#6b7280" }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
        {parts.map(([k, m]) => (
          <li key={k} className="flex items-center gap-1 text-[11px] text-ink-soft">
            <span className="size-2 rounded-full" style={{ background: CATEGORY_BY_KEY.get(k as CategoryKey)?.colour }} aria-hidden />
            {CATEGORY_BY_KEY.get(k as CategoryKey)?.label ?? k}
            <span className="tabular text-ink-faint">{hours(m)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Rating({ value, className }: { value: number | null; className?: string }) {
  if (!value) return null;
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`Rated ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn("size-3.5", n <= value ? "fill-warn text-warn" : "text-line")} aria-hidden />
      ))}
    </span>
  );
}

/** A day's tasks and notes, read-only — the locked view and the reviewer's card share it. */
export function EntryView({ entry, compact = false }: { entry: ViewEntry; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {entry.summary ? <p className="text-sm whitespace-pre-line text-ink">{entry.summary}</p> : null}

      <CategoryBar tasks={entry.tasks} />

      <ol className="flex flex-col gap-2">
        {entry.tasks.map((t, i) => {
          const cat = CATEGORY_BY_KEY.get(t.category as CategoryKey);
          const st = STATUS[t.status as keyof typeof STATUS] ?? STATUS.done;
          return (
            <li key={t.id} className="flex gap-3 rounded-md border border-line-soft bg-surface p-3">
              <span className="w-1 shrink-0 rounded-full" style={{ background: cat?.colour }} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink">
                    <span className="tabular mr-1.5 text-xs text-ink-faint">{i + 1}.</span>
                    {t.title}
                  </p>
                  <span className="tabular text-sm font-semibold text-ink">{hours(t.minutes)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                  <span className="rounded-full px-1.5 py-px font-medium" style={{ background: `${cat?.colour}1a`, color: cat?.colour }}>
                    {cat?.label ?? t.category}
                  </span>
                  {t.project ? (
                    <span className="flex items-center gap-1">
                      <FolderKanban className="size-3" aria-hidden />
                      {t.project}
                    </span>
                  ) : null}
                  <span className={cn("flex items-center gap-1", st.className)}>
                    <st.icon className="size-3" aria-hidden />
                    {st.label}
                  </span>
                </div>
                {t.details && !compact ? <p className="mt-2 text-xs whitespace-pre-line text-ink-soft">{t.details}</p> : null}
                {t.outcome ? (
                  <p className="mt-1.5 flex items-start gap-1 text-xs text-ink-soft">
                    <Flag className="mt-0.5 size-3 shrink-0 text-ok" aria-hidden />
                    {t.outcome}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {entry.blockers || entry.planNext ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {entry.blockers ? (
            <div className="rounded-md border border-danger/20 bg-danger-soft/40 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-danger uppercase">
                <AlertTriangle className="size-3.5" aria-hidden />
                Blockers
              </p>
              <p className="mt-1 text-xs whitespace-pre-line text-ink">{entry.blockers}</p>
            </div>
          ) : null}
          {entry.planNext ? (
            <div className="rounded-md border border-accent/20 bg-accent-soft/40 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-accent uppercase">
                <Compass className="size-3.5" aria-hidden />
                Plan for next day
              </p>
              <p className="mt-1 text-xs whitespace-pre-line text-ink">{entry.planNext}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
