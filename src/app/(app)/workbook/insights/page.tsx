import Link from "next/link";
import { UserX } from "lucide-react";
import { requirePermission } from "@/lib/session";
import { addDays, adToBs, BS_MONTHS, isSaturday, todayInNepal } from "@/lib/bs";
import { BarList, DonutChart, StackedColumnChart } from "@/components/charts";
import { BsMonthNav } from "@/components/bs-month-nav";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Select, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { CATEGORY_BY_KEY, hours, type CategoryKey } from "@/modules/workbook/catalogue";
import { insights } from "@/modules/workbook/service";
import { filterOptions, readFilter } from "../filters";
import { adLabel } from "../format";

export const metadata = { title: "Work-Book Insights" };

/** Working days (Sunday–Friday) in a range, counted no further than today. */
function workingDays(from: string, to: string, today: string) {
  let n = 0;
  for (let d = from; d <= to && d <= today; d = addDays(d, 1)) if (!isSaturday(d)) n++;
  return n;
}

/**
 * The reviewer's analysis of a BS month: how consistently people write, where
 * the hours go, and who is stuck or missing — all computed in SQL.
 */
export default async function WorkBookInsightsPage({ searchParams }: PageProps<"/workbook/insights">) {
  const viewer = await requirePermission("workbook.record.viewAll");
  const params = await searchParams;
  const { month, filter } = readFilter(params);
  const today = todayInNepal();

  const [data, options] = await Promise.all([
    insights(viewer.orgId, filter.from, filter.to, filter.departmentId ?? null),
    filterOptions(viewer.orgId),
  ]);
  const { totals } = data;

  const expected = data.staff * workingDays(filter.from, filter.to, today);
  const rate = expected ? Math.min(100, Math.round((totals.submitted / expected) * 100)) : 0;
  const perDay = totals.submitted ? Math.round(totals.minutes / totals.submitted) : 0;
  const inMonth = today >= filter.from && today <= filter.to;

  const byDay = new Map(data.byDay.map((d) => [d.date, d]));
  const columns: { label: string; title: string; segments: { key: string; value: number }[]; muted: boolean; caption?: string }[] = [];
  for (let d = filter.from; d <= filter.to; d = addDays(d, 1)) {
    const r = byDay.get(d);
    columns.push({
      label: String(adToBs(d).day),
      title: `${adToBs(d).day} ${BS_MONTHS[month.month - 1]} · ${adLabel(d)} — ${r?.n ?? 0} submitted, ${hours(r?.minutes ?? 0)}`,
      segments: [{ key: "entries", value: r?.n ?? 0 }],
      muted: isSaturday(d),
    });
  }

  const dept = filter.departmentId ?? undefined;

  return (
    <>
      <PageHeader
        title="Work-Book Insights"
        description={`${BS_MONTHS[month.month - 1]} ${month.year} — submission discipline and where the time went. Counts submitted days only.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <form className="flex items-center gap-2">
              <input type="hidden" name="y" value={month.year} />
              <input type="hidden" name="m" value={month.month} />
              <Select name="dept" defaultValue={dept ?? ""} className="w-auto" aria-label="Department">
                <option value="">All departments</option>
                {options.depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
              <button type="submit" className="rounded border border-line px-3 py-1.5 text-sm text-ink-soft hover:bg-sunk hover:text-ink">
                Apply
              </button>
            </form>
            <BsMonthNav basePath="/workbook/insights" current={month} extraParams={{ dept }} />
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Submission rate" value={`${rate}%`} sub={`${totals.submitted} of ${expected} expected days`} tone={rate >= 85 ? "ok" : rate >= 60 ? "warn" : "danger"} />
        <StatTile label="Hours recorded" value={hours(totals.minutes)} sub={`${totals.tasks} tasks`} tone="accent" />
        <StatTile label="Average day" value={hours(perDay)} sub="per submitted day" tone="info" />
        <StatTile label="Self-rating" value={totals.rating ? totals.rating.toFixed(1) : "—"} sub="average, out of 5" tone="warn" />
        <StatTile label="People writing" value={`${totals.people}/${data.staff}`} sub={`${totals.entries - totals.submitted} drafts open`} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Submitted days, day by day" description="Saturdays drawn faint" />
          <div className="p-4">
            <StackedColumnChart columns={columns} keys={[{ key: "entries", label: "Submitted days", colour: "var(--color-accent)" }]} absolute />
          </div>
        </Card>

        <Card>
          <CardHeader title="Time by category" />
          <div className="p-4">
            {data.byCategory.length ? (
              <DonutChart
                slices={data.byCategory.map((c) => ({
                  label: CATEGORY_BY_KEY.get(c.category as CategoryKey)?.label ?? c.category,
                  value: c.minutes,
                  colour: CATEGORY_BY_KEY.get(c.category as CategoryKey)?.colour ?? "#6b7280",
                  hint: `${hours(c.minutes)} · ${c.n} tasks`,
                }))}
                centreValue={hours(totals.minutes)}
                centreLabel="recorded"
                size={148}
              />
            ) : (
              <EmptyState title="Nothing submitted yet." />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Hours by department" />
          <div className="p-4">
            <BarList
              items={data.byDepartment.map((d) => ({ key: d.department, label: d.department, value: d.minutes, display: hours(d.minutes), hint: `${d.entries} days` }))}
              empty="Nothing submitted yet"
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Top projects" />
          <div className="p-4">
            <BarList
              items={data.byProject.map((p) => ({ key: p.project ?? "", label: p.project, value: p.minutes, display: hours(p.minutes), hint: `${p.n} tasks` }))}
              colour="var(--color-info)"
              empty="No task names a project"
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Not submitted today"
            description={`${data.missingToday.length} of ${data.staff} people${inMonth ? "" : " · today is outside this month"}`}
          />
          {data.missingToday.length === 0 ? (
            <EmptyState title="Everybody has submitted today." />
          ) : (
            <ul className="max-h-72 divide-y divide-line-soft overflow-y-auto">
              {data.missingToday.map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-4 py-2 text-xs">
                  <UserX className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                  <span className="truncate text-ink-faint">{p.department ?? p.code}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader title="By person" description="Most hours recorded this month" />
          {data.byPerson.length === 0 ? (
            <EmptyState title="Nothing submitted yet." />
          ) : (
            <TableShell className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th className="text-right">Days</Th>
                  <Th className="text-right">Hours</Th>
                  <Th className="text-right">Avg / day</Th>
                  <Th className="text-right">Blocked tasks</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.byPerson.map((p) => (
                  <Tr key={p.employeeId}>
                    <Td>
                      <span className="font-medium text-ink">{p.name}</span>
                      <span className="ml-2 text-xs text-ink-faint">{p.code}</span>
                    </Td>
                    <Td className="tabular text-right">{p.days}</Td>
                    <Td className="tabular text-right font-medium">{hours(p.minutes)}</Td>
                    <Td className="tabular text-right">{hours(Math.round(p.minutes / Math.max(1, p.days)))}</Td>
                    <Td className="text-right">{p.blocked ? <Badge tone="danger">{p.blocked}</Badge> : <span className="text-ink-faint">0</span>}</Td>
                    <Td className="text-right">
                      <Link href={`/workbook/records?y=${month.year}&m=${month.month}&emp=${p.employeeId}`} className="text-xs text-accent hover:underline">
                        Records
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Card>
      </div>
    </>
  );
}
