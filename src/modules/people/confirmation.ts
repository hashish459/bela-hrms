import "server-only";

import { daysUntil, todayInNepal } from "@/lib/bs";

/**
 * Probation — when a review falls due.
 *
 * Reverse-engineering the legacy database, confirmation was two columns on
 * `EmployeeInfo`: `ProbationDate` and `DateOfPermanent`, each with a Bikram
 * Sambat twin. Nothing read them on a schedule. The consequence was the one
 * every HR team recognises — people stayed "on probation" in the system for
 * years because the date passed and no screen ever said so.
 *
 * The fix is not a new workflow engine. It is a derived state that a page can
 * sort by, so a review that has fallen due is impossible to miss.
 */

export type ProbationState =
  /** The probation end date has passed and no decision has been recorded. */
  | "overdue"
  /** Falls due inside the notice window. */
  | "due"
  /** Falls due later. */
  | "upcoming"
  /** On probation with no end date set — nothing will ever fall due. */
  | "unscheduled";

/**
 * How far ahead a review is raised.
 *
 * Thirty days: long enough for a supervisor to be asked for an opinion and for
 * a decision to be taken before the date rather than after it.
 */
export const REVIEW_WINDOW_DAYS = 30;

export function probationState(
  probationEndDate: string | null,
  today = todayInNepal(),
): ProbationState {
  if (!probationEndDate) return "unscheduled";
  const days = daysUntil(today, probationEndDate);
  if (days < 0) return "overdue";
  if (days <= REVIEW_WINDOW_DAYS) return "due";
  return "upcoming";
}

export function daysToProbationEnd(
  probationEndDate: string | null,
  today = todayInNepal(),
): number | null {
  return probationEndDate ? daysUntil(today, probationEndDate) : null;
}

export const PROBATION_TONE: Record<ProbationState, "danger" | "warn" | "info" | "neutral"> = {
  overdue: "danger",
  due: "warn",
  upcoming: "info",
  unscheduled: "neutral",
};

export function probationLabel(state: ProbationState, days: number | null) {
  switch (state) {
    case "overdue":
      return `${Math.abs(days ?? 0)} days overdue`;
    case "due":
      return days === 0 ? "Due today" : `Due in ${days} days`;
    case "upcoming":
      return `${days} days remaining`;
    case "unscheduled":
      return "No end date set";
  }
}

/**
 * Sort order for the review queue: overdue first, then by date.
 *
 * `unscheduled` sits between overdue and due rather than at the bottom. Someone
 * on probation with no end date is not a low priority — it is the case that
 * silently never surfaces, which is exactly the legacy failure.
 */
export const STATE_RANK: Record<ProbationState, number> = {
  overdue: 0,
  unscheduled: 1,
  due: 2,
  upcoming: 3,
};
