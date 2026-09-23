"use client";

import { useActionState, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Compass,
  Copy,
  Loader2,
  Lock,
  NotebookText,
  Plus,
  Save,
  Send,
  Star,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  CATEGORIES,
  CATEGORY_BY_KEY,
  hours,
  LIMITS,
  TASK_STATUSES,
  validateEntry,
  type CategoryKey,
  type TaskStatusKey,
} from "@/modules/workbook/catalogue";
import { saveWorkBookAction, type WorkBookState } from "./actions";
import { CategoryBar } from "./entry-view";

type Row = {
  key: string;
  title: string;
  details: string;
  category: CategoryKey;
  project: string;
  minutes: number;
  status: TaskStatusKey;
  outcome: string;
  open: boolean;
};

export type EditorInitial = {
  summary: string;
  blockers: string;
  planNext: string;
  selfRating: number | null;
  tasks: Omit<Row, "key" | "open">[];
};

const initialState: WorkBookState = {};
/** The working day the progress ring measures against. */
const TARGET_MINUTES = 8 * 60;

let seq = 0;
const newKey = () => `r${++seq}`;
const blank = (category: CategoryKey = "development"): Row => ({
  key: newKey(),
  title: "",
  details: "",
  category,
  project: "",
  minutes: 0,
  status: "done",
  outcome: "",
  open: false,
});

const toTask = (r: Row): Omit<Row, "key" | "open"> => ({
  title: r.title,
  details: r.details,
  category: r.category,
  project: r.project,
  minutes: r.minutes,
  status: r.status,
  outcome: r.outcome,
});

/** What the server would store for this state — the same cleaning both sides, so "unsaved" is honest. */
function normalised(v: { summary: string; blockers: string; planNext: string; selfRating: number | null; tasks: Omit<Row, "key" | "open">[] }) {
  const r = validateEntry(v, false);
  return JSON.stringify(r.ok ? r.value : v);
}

function Ring({ minutes }: { minutes: number }) {
  const size = 64;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const c = 2 * Math.PI * radius;
  const pct = Math.min(1, minutes / TARGET_MINUTES);
  const over = minutes > TARGET_MINUTES;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-sunk)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={over ? "var(--color-warn)" : "var(--color-accent)"}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${pct * c} ${c}`}
        className="transition-[stroke-dasharray] duration-300"
      />
    </svg>
  );
}

/** Hours and minutes for one task, kept as minutes in state. */
function Duration({ minutes, onChange, invalid, label }: { minutes: number; onChange: (m: number) => void; invalid?: boolean; label: string }) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const set = (nh: number, nm: number) => onChange(Math.max(0, Math.min(LIMITS.taskMinutes, (Number.isFinite(nh) ? nh : 0) * 60 + (Number.isFinite(nm) ? nm : 0))));
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <Input
        type="number"
        min={0}
        max={16}
        value={h}
        onChange={(e) => set(Number(e.target.value), m)}
        className={cn("tabular w-14 text-center", invalid && "border-danger")}
        aria-label={`${label} hours`}
      />
      <span className="text-xs text-ink-faint">h</span>
      <Input
        type="number"
        min={0}
        max={59}
        step={5}
        value={m}
        onChange={(e) => set(h, Number(e.target.value))}
        className={cn("tabular w-14 text-center", invalid && "border-danger")}
        aria-label={`${label} minutes`}
      />
      <span className="text-xs text-ink-faint">m</span>
    </div>
  );
}

const QUICK = [15, 30, 60, 120];

/**
 * The day's work-book. Everything is local state until Save or Submit, which
 * post it as one JSON field; the server re-validates with the same rules the
 * live totals here use.
 */
export function WorkBookEditor({
  date,
  initial,
  yesterdayPlan,
  reopenedBy,
}: {
  date: string;
  initial: EditorInitial;
  yesterdayPlan: string | null;
  reopenedBy: string | null;
}) {
  const [state, action, pending] = useActionState(saveWorkBookAction, initialState);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.tasks.length ? initial.tasks.map((t) => ({ ...t, key: newKey(), open: Boolean(t.details || t.outcome) })) : [blank()],
  );
  const [summary, setSummary] = useState(initial.summary);
  const [blockers, setBlockers] = useState(initial.blockers);
  const [planNext, setPlanNext] = useState(initial.planNext);
  const [rating, setRating] = useState<number | null>(initial.selfRating);

  const total = rows.reduce((s, r) => s + r.minutes, 0);
  const used = rows.filter((r) => r.title.trim() || r.minutes);
  const payload = { summary, blockers, planNext, selfRating: rating, tasks: rows.map(toTask) };
  const json = JSON.stringify(payload);
  const baseline = useMemo(() => normalised(initial), [initial]);
  const dirty = normalised(payload) !== baseline;
  const errors = state.fieldErrors ?? {};

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const add = () => setRows((rs) => (rs.length >= LIMITS.tasks ? rs : [...rs, blank(rs.at(-1)?.category)]));
  const remove = (key: string) => setRows((rs) => (rs.length === 1 ? [blank()] : rs.filter((r) => r.key !== key)));

  return (
    <form
      action={action}
      onSubmit={(e) => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.value === "submit" && !confirm("Submit this day? It locks, and only an administrator can reopen it.")) e.preventDefault();
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="payload" value={json} />

      {reopenedBy ? (
        <p className="flex items-center gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          Reopened by {reopenedBy} for correction. Make your changes and submit it again.
        </p>
      ) : null}

      {/* running total */}
      <div className="flex flex-wrap items-center gap-4 rounded-md border border-line bg-surface p-4">
        <div className="relative">
          <Ring minutes={total} />
          <span className="tabular absolute inset-0 grid place-items-center text-[11px] font-semibold text-ink">
            {Math.round((total / TARGET_MINUTES) * 100)}%
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="tabular text-2xl leading-none font-semibold text-ink">{hours(total)}</p>
          <p className="mt-1 text-xs text-ink-faint">
            {used.length} {used.length === 1 ? "task" : "tasks"} · of an {TARGET_MINUTES / 60}h day
          </p>
          <CategoryBar tasks={rows} className="mt-2.5" />
        </div>
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
            dirty ? "bg-warn-soft text-warn" : "bg-sunk text-ink-faint",
          )}
          aria-live="polite"
        >
          <span className={cn("size-1.5 rounded-full", dirty ? "bg-warn" : "bg-ok")} aria-hidden />
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
      </div>

      {/* tasks */}
      <section className="rounded-md border border-line bg-surface">
        <header className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Tasks</h2>
            <p className="mt-0.5 text-xs text-ink-faint">One row per piece of work. Empty rows are ignored.</p>
          </div>
          <span className="tabular text-[11px] text-ink-faint">
            {rows.length}/{LIMITS.tasks}
          </span>
        </header>

        {errors.tasks ? (
          <p className="mx-4 mt-3 flex items-center gap-1.5 rounded bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
            <AlertCircle className="size-3.5" aria-hidden />
            {errors.tasks}
          </p>
        ) : null}

        <ol className="flex flex-col divide-y divide-line-soft">
          {rows.map((r, i) => {
            const cat = CATEGORY_BY_KEY.get(r.category);
            return (
              <li key={r.key} className="group relative flex gap-3 px-4 py-3.5">
                <span className="w-1 shrink-0 rounded-full transition-colors" style={{ background: cat?.colour }} aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                  <div className="flex flex-wrap items-start gap-2">
                    <span className="tabular mt-2 w-5 text-xs text-ink-faint">{i + 1}.</span>
                    <div className="min-w-48 flex-1">
                      <Input
                        value={r.title}
                        onChange={(e) => update(r.key, { title: e.target.value })}
                        placeholder="What did you work on?"
                        maxLength={LIMITS.title}
                        aria-label={`Task ${i + 1}`}
                        aria-invalid={Boolean(errors[`tasks.${i}.title`])}
                        className={cn("font-medium", errors[`tasks.${i}.title`] && "border-danger")}
                      />
                      {errors[`tasks.${i}.title`] ? <p className="mt-1 text-[11px] text-danger">{errors[`tasks.${i}.title`]}</p> : null}
                    </div>
                    <Duration minutes={r.minutes} onChange={(m) => update(r.key, { minutes: m })} invalid={Boolean(errors[`tasks.${i}.minutes`])} label={`Task ${i + 1} time`} />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pl-7">
                    <Select
                      value={r.category}
                      onChange={(e) => update(r.key, { category: e.target.value as CategoryKey })}
                      className="w-auto py-1 text-xs"
                      aria-label={`Task ${i + 1} category`}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                    <Input
                      value={r.project}
                      onChange={(e) => update(r.key, { project: e.target.value })}
                      placeholder="Project / client"
                      maxLength={LIMITS.project}
                      className="w-40 py-1 text-xs"
                      aria-label={`Task ${i + 1} project`}
                      list="workbook-projects"
                    />
                    <div className="flex rounded border border-line p-0.5" role="radiogroup" aria-label={`Task ${i + 1} status`}>
                      {TASK_STATUSES.map((s) => (
                        <button
                          key={s.key}
                          type="button"
                          role="radio"
                          aria-checked={r.status === s.key}
                          onClick={() => update(r.key, { status: s.key })}
                          className={cn(
                            "rounded-sm px-2 py-0.5 text-[11px] transition-colors",
                            r.status === s.key
                              ? s.key === "blocked"
                                ? "bg-danger-soft font-medium text-danger"
                                : s.key === "in_progress"
                                  ? "bg-info-soft font-medium text-info"
                                  : "bg-ok-soft font-medium text-ok"
                              : "text-ink-faint hover:text-ink",
                          )}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <span className="flex gap-1">
                      {QUICK.map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => update(r.key, { minutes: Math.min(LIMITS.taskMinutes, r.minutes + q) })}
                          className="tabular rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink-faint hover:border-accent hover:text-accent"
                          title={`Add ${hours(q)}`}
                        >
                          +{hours(q)}
                        </button>
                      ))}
                    </span>
                    <button
                      type="button"
                      onClick={() => update(r.key, { open: !r.open })}
                      className="text-[11px] text-accent hover:underline"
                      aria-expanded={r.open}
                    >
                      {r.open ? "Hide details" : "Details & outcome"}
                    </button>
                  </div>

                  {r.open ? (
                    <div className="grid gap-2 pl-7 sm:grid-cols-2">
                      <Textarea
                        value={r.details}
                        onChange={(e) => update(r.key, { details: e.target.value })}
                        placeholder="Details — steps, tickets, people involved"
                        maxLength={LIMITS.details}
                        className="min-h-16 text-xs"
                        aria-label={`Task ${i + 1} details`}
                      />
                      <Textarea
                        value={r.outcome}
                        onChange={(e) => update(r.key, { outcome: e.target.value })}
                        placeholder="Outcome — what was delivered or decided"
                        maxLength={LIMITS.outcome}
                        className="min-h-16 text-xs"
                        aria-label={`Task ${i + 1} outcome`}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col gap-0.5 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-ink-faint hover:bg-sunk hover:text-ink disabled:opacity-30" aria-label={`Move task ${i + 1} up`}>
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="rounded p-1 text-ink-faint hover:bg-sunk hover:text-ink disabled:opacity-30" aria-label={`Move task ${i + 1} down`}>
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => remove(r.key)} className="rounded p-1 text-ink-faint hover:bg-danger-soft hover:text-danger" aria-label={`Remove task ${i + 1}`}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>

        <datalist id="workbook-projects">
          {[...new Set(rows.map((r) => r.project.trim()).filter(Boolean))].map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>

        <div className="border-t border-line-soft px-4 py-3">
          <Button type="button" variant="secondary" onClick={add} disabled={rows.length >= LIMITS.tasks}>
            <Plus className="size-4" />
            Add task
          </Button>
        </div>
      </section>

      {/* day notes */}
      <section className="grid gap-4 rounded-md border border-line bg-surface p-4 lg:grid-cols-3">
        <Field label="Summary of the day" hint="Two or three lines a reviewer reads first" className="lg:col-span-3">
          <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={LIMITS.text} placeholder="Closed the month-end reconciliation and started on the audit queries…" />
        </Field>
        <Field label="Blockers" hint="Anything holding you up">
          <Textarea value={blockers} onChange={(e) => setBlockers(e.target.value)} maxLength={LIMITS.text} className="min-h-16" placeholder="Waiting on…" />
        </Field>
        <Field label="Plan for the next day" hint="Tomorrow’s work-book shows you this">
          <Textarea value={planNext} onChange={(e) => setPlanNext(e.target.value)} maxLength={LIMITS.text} className="min-h-16" placeholder="Finish…" />
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">How did the day go?</span>
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Rate the day">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} of 5`}
                onClick={() => setRating(rating === n ? null : n)}
                className="rounded p-0.5 transition-transform hover:scale-110"
              >
                <Star className={cn("size-6", rating && n <= rating ? "fill-warn text-warn" : "text-line")} />
              </button>
            ))}
          </div>
          {errors.selfRating ? <span className="text-xs text-danger">{errors.selfRating}</span> : <span className="text-xs text-ink-faint">Optional — only reviewers see it</span>}
          {yesterdayPlan ? (
            <div className="mt-2 rounded-md border border-accent/20 bg-accent-soft/40 p-2.5">
              <p className="flex items-center justify-between gap-2 text-[11px] font-medium text-accent">
                <span className="flex items-center gap-1">
                  <Compass className="size-3.5" aria-hidden />
                  You planned
                </span>
                {!summary ? (
                  <button type="button" onClick={() => setSummary(yesterdayPlan)} className="flex items-center gap-1 hover:underline">
                    <Copy className="size-3" aria-hidden />
                    Use as summary
                  </button>
                ) : null}
              </p>
              <p className="mt-1 line-clamp-4 text-xs whitespace-pre-line text-ink-soft">{yesterdayPlan}</p>
            </div>
          ) : null}
        </div>
      </section>

      {/* actions */}
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="min-h-5 text-xs" role="status">
          {state.error ? (
            <span className="flex items-center gap-1.5 text-danger">
              <AlertCircle className="size-3.5" aria-hidden />
              {state.error}
            </span>
          ) : state.ok ? (
            <span className="flex items-center gap-1.5 text-ok">
              <CheckCircle2 className="size-3.5" aria-hidden />
              {state.ok}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-ink-faint">
              <NotebookText className="size-3.5" aria-hidden />
              Save a draft any time; submit when the day is done.
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="submit" name="intent" value="draft" variant="secondary" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save draft
          </Button>
          <Button type="submit" name="intent" value="submit" disabled={pending || total === 0}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Submit day
            <Lock className="size-3.5 opacity-70" aria-hidden />
          </Button>
        </div>
      </div>
    </form>
  );
}
