import Link from "next/link";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, probationReviews } from "@/db/schema/hr";
import { departments, designations } from "@/db/schema/org";
import { can, requirePermission } from "@/lib/session";
import { adToBs, daysUntil, formatBs, todayInNepal } from "@/lib/bs";
import { cn } from "@/lib/utils";
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatTile } from "@/components/ui";
import {
  daysToProbationEnd,
  probationLabel,
  probationState,
  REVIEW_WINDOW_DAYS,
  STATE_RANK,
  type ProbationState,
} from "@/modules/people/confirmation";
import { ConfirmationQueue, type ProbationRow } from "./confirmation-queue";

export const metadata = { title: "Confirmations" };

/**
 * Probation reviews and the confirmation decision.
 *
 * In the legacy database this was two columns and no screen: `ProbationDate`
 * passed, nobody was told, and people stayed "on probation" in the system long
 * after everyone had stopped thinking of them that way. The queue below is the
 * whole fix — a list, sorted so the thing that has been waiting longest is at
 * the top, with the decision takeable in the row.
 *
 * `unscheduled` — on probation with no end date at all — sorts near the top on
 * purpose. It is the case that silently never surfaces, which is precisely the
 * failure being corrected.
 */

const TABS: { value: string; label: string; states: ProbationState[] }[] = [
  { value: "", label: "All", states: ["overdue", "unscheduled", "due", "upcoming"] },
  { value: "overdue", label: "Overdue", states: ["overdue"] },
  { value: "due", label: "Due soon", states: ["due"] },
  { value: "unscheduled", label: "No end date", states: ["unscheduled"] },
  { value: "upcoming", label: "Upcoming", states: ["upcoming"] },
];

function bs(date: string | null) {
  return date ? formatBs(adToBs(date)) : null;
}

export default async function ConfirmationsPage({
  searchParams,
}: PageProps<"/hr/confirmations">) {
  const viewer = await requirePermission("hr.employee.view");
  const params = await searchParams;
  const tabValue = typeof params.state === "string" ? params.state : "";
  const tab = TABS.find((t) => t.value === tabValue) ?? TABS[0];

  const today = todayInNepal();

  const [onProbation, recent] = await Promise.all([
    /*
     * Everyone currently on probation, which is a small and naturally bounded
     * set — the derived state has to be computed in TypeScript because it
     * depends on today's date, so the rows have to come back to be sorted. That
     * is only safe because this filter is narrow; the same approach on the whole
     * employee table would be a scan.
     */
    db
      .select({
        id: employees.id,
        code: employees.employeeCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
        photoFileId: employees.photoFileId,
        dateOfJoin: employees.dateOfJoin,
        probationEndDate: employees.probationEndDate,
        designation: designations.name,
        department: departments.name,
        supervisorName: sql<string | null>`sup.first_name || ' ' || sup.last_name`,
      })
      .from(employees)
      .leftJoin(designations, eq(designations.id, employees.designationId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(sql`employees sup`, sql`sup.id = ${employees.supervisorId}`)
      .where(and(eq(employees.orgId, viewer.orgId), eq(employees.status, "probation"), isNull(employees.deletedAt))),

    db
      .select({
        id: probationReviews.id,
        employeeId: probationReviews.employeeId,
        name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        code: employees.employeeCode,
        outcome: probationReviews.outcome,
        effectiveDate: probationReviews.effectiveDate,
        remarks: probationReviews.remarks,
        decidedBy: probationReviews.decidedByLabel,
        decidedAt: probationReviews.decidedAt,
      })
      .from(probationReviews)
      .innerJoin(employees, eq(employees.id, probationReviews.employeeId))
      .where(eq(probationReviews.orgId, viewer.orgId))
      .orderBy(desc(probationReviews.decidedAt))
      .limit(8),
  ]);

  const all: ProbationRow[] = onProbation
    .map((e) => {
      const state = probationState(e.probationEndDate, today);
      return {
        id: e.id,
        code: e.code,
        name: `${e.firstName} ${e.lastName}`,
        photoFileId: e.photoFileId,
        designation: e.designation,
        department: e.department,
        supervisorName: e.supervisorName,
        dateOfJoinBs: formatBs(adToBs(e.dateOfJoin)),
        probationEndDate: e.probationEndDate,
        probationEndBs: bs(e.probationEndDate),
        state,
        stateLabel: probationLabel(state, daysToProbationEnd(e.probationEndDate, today)),
        tenureMonths: Math.max(0, Math.floor(daysUntil(e.dateOfJoin, today) / 30)),
      } satisfies ProbationRow;
    })
    .sort(
      (a, b) =>
        STATE_RANK[a.state] - STATE_RANK[b.state] ||
        (a.probationEndDate ?? "9999-12-31").localeCompare(b.probationEndDate ?? "9999-12-31"),
    );

  const counts = {
    overdue: all.filter((r) => r.state === "overdue").length,
    due: all.filter((r) => r.state === "due").length,
    unscheduled: all.filter((r) => r.state === "unscheduled").length,
    upcoming: all.filter((r) => r.state === "upcoming").length,
  };

  const rows = all.filter((r) => tab.states.includes(r.state));
  const canDecide = can(viewer, "hr.employee.update");

  return (
    <>
      <PageHeader
        title="Confirmations"
        description="Probation reviews falling due, and the decision that moves someone onto the permanent establishment."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Overdue"
          value={counts.overdue}
          sub="probation already ended"
          tone={counts.overdue > 0 ? "danger" : "neutral"}
        />
        <StatTile
          label="Due soon"
          value={counts.due}
          sub={`within ${REVIEW_WINDOW_DAYS} days`}
          tone={counts.due > 0 ? "warn" : "neutral"}
        />
        <StatTile
          label="No end date"
          value={counts.unscheduled}
          sub="nothing will fall due"
          tone={counts.unscheduled > 0 ? "warn" : "neutral"}
        />
        <StatTile label="On probation" value={all.length} sub="whole organisation" tone="accent" />
      </div>

      <div className="mt-4 mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => {
          const n =
            t.value === "" ? all.length : counts[t.value as keyof typeof counts];
          const active = t.value === tab.value;
          return (
            <Link
              key={t.value}
              href={t.value ? `/hr/confirmations?state=${t.value}` : "/hr/confirmations"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-transparent bg-accent text-on-accent"
                  : "border-line bg-surface text-ink-soft hover:bg-sunk hover:text-ink",
              )}
            >
              {t.label}
              <span className={cn("tabular", active ? "opacity-80" : "text-ink-faint")}>{n}</span>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader
          title="Review queue"
          description={
            canDecide
              ? "Overdue first, then the ones with no end date at all."
              : "Read only — recording a decision needs permission to edit employees."
          }
        />
        <ConfirmationQueue rows={rows} today={today} canDecide={canDecide} />
      </Card>

      <Card className="mt-4">
        <CardHeader title="Recent decisions" description="The last eight recorded" />
        {recent.length === 0 ? (
          <EmptyState title="No decisions recorded yet" />
        ) : (
          <ul className="divide-y divide-line-soft">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2.5">
                <Badge
                  tone={
                    r.outcome === "confirmed" ? "ok" : r.outcome === "extended" ? "warn" : "danger"
                  }
                >
                  {r.outcome}
                </Badge>
                <Link
                  href={`/hr/employees/${r.employeeId}`}
                  className="text-sm text-ink hover:text-accent"
                >
                  {r.name}
                </Link>
                <span className="font-mono text-[11px] text-ink-faint">{r.code}</span>
                <span className="tabular text-xs text-ink-soft">
                  effective {formatBs(adToBs(r.effectiveDate))}
                </span>
                {r.remarks ? (
                  <span className="w-full truncate text-xs text-ink-faint">{r.remarks}</span>
                ) : null}
                {r.decidedBy ? (
                  <span className="ml-auto text-[11px] text-ink-faint">by {r.decidedBy}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
