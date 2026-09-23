import { ChevronDown, Download, Search } from "lucide-react";
import { requirePermission } from "@/lib/session";
import { adToBs, BS_MONTHS, formatBs, weekdayOf } from "@/lib/bs";
import { offsetPage, PAGE_SIZE } from "@/lib/pagination";
import { Avatar } from "@/components/avatar";
import { BsMonthNav } from "@/components/bs-month-nav";
import { OffsetPagination } from "@/components/pagination";
import { Badge, ButtonLink, Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { hours } from "@/modules/workbook/catalogue";
import { records } from "@/modules/workbook/service";
import { EntryView, Rating } from "../entry-view";
import { filterOptions, readFilter } from "../filters";
import { stamp, WEEKDAYS } from "../format";
import { ReopenButton } from "./reopen-button";

export const metadata = { title: "Work-Book Records" };

/**
 * Every employee's work-book, for reviewers only. Entries open in place —
 * native disclosure, so a month of them is one light page rather than a
 * hydrated list.
 */
export default async function WorkBookRecordsPage({ searchParams }: PageProps<"/workbook/records">) {
  const viewer = await requirePermission("workbook.record.viewAll");
  const params = await searchParams;
  const { month, filter } = readFilter(params);

  const size = PAGE_SIZE.comfortable;
  const pageNo = Math.max(1, Math.floor(Number(params.page) || 1));
  const [{ total, rows }, options] = await Promise.all([
    records(viewer.orgId, filter, { limit: size, offset: (pageNo - 1) * size }),
    filterOptions(viewer.orgId),
  ]);
  const page = offsetPage({ page: pageNo, total, defaultSize: size });

  const keep = {
    dept: filter.departmentId ?? undefined,
    emp: filter.employeeId ?? undefined,
    status: filter.status ?? undefined,
    q: filter.q ?? undefined,
  };
  const exportQs = new URLSearchParams(
    Object.entries({ y: String(month.year), m: String(month.month), ...keep }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

  return (
    <>
      <PageHeader
        title="Work-Book Records"
        description={`What everybody recorded in ${BS_MONTHS[month.month - 1]} ${month.year}. Only reviewers see this screen.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <BsMonthNav basePath="/workbook/records" current={month} extraParams={keep} />
            <ButtonLink href={`/workbook/records/export?${exportQs}`} variant="secondary" prefetch={false}>
              <Download className="size-4" />
              CSV
            </ButtonLink>
          </div>
        }
      />

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-2 p-3" role="search">
          <input type="hidden" name="y" value={month.year} />
          <input type="hidden" name="m" value={month.month} />
          <label className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input name="q" defaultValue={filter.q ?? ""} placeholder="Search tasks, projects, summaries or people" className="pl-8" aria-label="Search" maxLength={100} />
          </label>
          <Select name="dept" defaultValue={filter.departmentId ?? ""} className="w-auto" aria-label="Department">
            <option value="">All departments</option>
            {options.depts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select name="emp" defaultValue={filter.employeeId ?? ""} className="w-auto max-w-56" aria-label="Employee">
            <option value="">Everybody</option>
            {options.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.firstName} {p.lastName} · {p.code}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={filter.status ?? ""} className="w-auto" aria-label="Status">
            <option value="">Any status</option>
            <option value="submitted">Submitted</option>
            <option value="draft">Draft</option>
          </Select>
          <button type="submit" className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover">
            Filter
          </button>
        </form>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No work-book days match." hint="Try another month or clear the filters." />
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.map(({ e, tasks, employeeName, firstName, lastName, employeeCode, photoFileId, department }) => {
              const blocked = tasks.filter((t) => t.status === "blocked").length;
              return (
                <li key={e.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors hover:bg-sunk/50 [&::-webkit-details-marker]:hidden">
                      <Avatar photoId={photoFileId} firstName={firstName} lastName={lastName} seed={e.employeeId} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">
                          {employeeName}
                          <span className="ml-2 text-xs font-normal text-ink-faint">
                            {employeeCode}
                            {department ? ` · ${department}` : ""}
                          </span>
                        </p>
                        <p className="truncate text-xs text-ink-soft">
                          {WEEKDAYS[weekdayOf(e.date)].slice(0, 3)}, {formatBs(adToBs(e.date))}
                          {e.summary ? <span className="text-ink-faint"> — {e.summary}</span> : null}
                        </p>
                      </div>
                      <div className="hidden items-center gap-3 sm:flex">
                        {blocked ? <Badge tone="danger">{blocked} blocked</Badge> : null}
                        <Rating value={e.selfRating} />
                        <span className="tabular w-20 text-right text-sm font-semibold text-ink">{hours(e.totalMinutes)}</span>
                        <span className="tabular w-14 text-right text-xs text-ink-faint">
                          {e.taskCount} {e.taskCount === 1 ? "task" : "tasks"}
                        </span>
                      </div>
                      <Badge tone={e.status === "submitted" ? "ok" : "warn"}>{e.status === "submitted" ? "Submitted" : "Draft"}</Badge>
                      <ChevronDown className="size-4 shrink-0 text-ink-faint transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="border-t border-line-soft bg-sunk/30 px-4 py-4 sm:pl-15">
                      <EntryView entry={{ ...e, tasks }} />
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-ink-faint">
                        <span>
                          {e.submittedAt ? `Submitted ${stamp(e.submittedAt)}` : `Draft, last saved ${stamp(e.updatedAt)}`}
                          {e.reopenedAt ? ` · reopened by ${e.reopenedByLabel} ${stamp(e.reopenedAt)}` : ""}
                        </span>
                        {e.status === "submitted" ? <ReopenButton id={e.id} /> : null}
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        <OffsetPagination page={page} params={params} label="days" />
      </Card>
    </>
  );
}
