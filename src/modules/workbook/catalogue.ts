/**
 * The work-book's vocabulary and limits. Pure — the editor uses it for its live
 * totals and the service for validation, so the two cannot disagree.
 */

export const CATEGORIES = [
  { key: "development", label: "Development", colour: "#2f6f9f" },
  { key: "operations", label: "Operations", colour: "#0f766e" },
  { key: "meeting", label: "Meeting", colour: "#7c3aed" },
  { key: "support", label: "Support", colour: "#c2410c" },
  { key: "administration", label: "Administration", colour: "#4b5563" },
  { key: "field_work", label: "Field work", colour: "#15803d" },
  { key: "training", label: "Training", colour: "#b45309" },
  { key: "research", label: "Research", colour: "#0369a1" },
  { key: "planning", label: "Planning", colour: "#be185d" },
  { key: "other", label: "Other", colour: "#6b7280" },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export const CATEGORY_BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

export const TASK_STATUSES = [
  { key: "done", label: "Done" },
  { key: "in_progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
] as const;
export type TaskStatusKey = (typeof TASK_STATUSES)[number]["key"];

export const LIMITS = {
  tasks: 30,
  title: 200,
  details: 2000,
  project: 120,
  outcome: 500,
  text: 2000,
  /** Minutes one task can carry. */
  taskMinutes: 16 * 60,
  /** Minutes one day can carry. */
  dayMinutes: 24 * 60,
  /** How many days back a draft may still be written. */
  backfillDays: 7,
};

export type TaskInput = {
  title: string;
  details: string | null;
  category: CategoryKey;
  project: string | null;
  minutes: number;
  status: TaskStatusKey;
  outcome: string | null;
};

export type EntryInput = {
  summary: string | null;
  blockers: string | null;
  planNext: string | null;
  selfRating: number | null;
  tasks: TaskInput[];
};

export type Validation = { ok: true; value: EntryInput } | { ok: false; errors: Record<string, string> };

const clean = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

/**
 * Validates a submitted day. `submitting` adds the rules a finished day must
 * meet: at least one task, and time against it.
 */
export function validateEntry(raw: unknown, submitting: boolean): Validation {
  const errors: Record<string, string> = {};
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = Array.isArray(r.tasks) ? r.tasks : [];
  if (list.length > LIMITS.tasks) errors.tasks = `At most ${LIMITS.tasks} tasks in a day.`;

  const tasks: TaskInput[] = [];
  list.slice(0, LIMITS.tasks).forEach((t: Record<string, unknown>, i: number) => {
    const title = clean(t?.title, LIMITS.title);
    const minutes = Math.round(Number(t?.minutes ?? 0));
    const category = CATEGORY_BY_KEY.has(t?.category as CategoryKey) ? (t.category as CategoryKey) : "other";
    const status = TASK_STATUSES.some((s) => s.key === t?.status) ? (t.status as TaskStatusKey) : "done";
    // a row with nothing in it is an unused row, not an error
    if (!title && !clean(t?.details, 1) && !minutes) return;
    if (!title) errors[`tasks.${i}.title`] = "Say what the task was.";
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > LIMITS.taskMinutes) {
      errors[`tasks.${i}.minutes`] = "Between 0 and 16 hours.";
    }
    tasks.push({
      title: title ?? "",
      details: clean(t?.details, LIMITS.details),
      category,
      project: clean(t?.project, LIMITS.project),
      minutes: Number.isFinite(minutes) ? Math.max(0, minutes) : 0,
      status,
      outcome: clean(t?.outcome, LIMITS.outcome),
    });
  });

  const total = tasks.reduce((s, t) => s + t.minutes, 0);
  if (total > LIMITS.dayMinutes) errors.tasks = "A day holds at most 24 hours.";

  const rating = r.selfRating === null || r.selfRating === undefined || r.selfRating === "" ? null : Number(r.selfRating);
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) errors.selfRating = "Rate the day 1 to 5.";

  if (submitting) {
    if (tasks.length === 0) errors.tasks = "Add at least one task before submitting.";
    else if (total === 0) errors.tasks = "Record the time spent before submitting.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      summary: clean(r.summary, LIMITS.text),
      blockers: clean(r.blockers, LIMITS.text),
      planNext: clean(r.planNext, LIMITS.text),
      selfRating: rating,
      tasks,
    },
  };
}

export function hours(minutes: number): string {
  if (!minutes) return "0h";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
