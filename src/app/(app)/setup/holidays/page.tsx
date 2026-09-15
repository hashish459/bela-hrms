import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { fiscalYears, holidays } from "@/db/schema/core";
import { requirePermission } from "@/lib/session";
import { adToBs, todayInNepal } from "@/lib/bs";
import { offsetPage, sliceOffsetPage, PAGE_SIZE } from "@/lib/pagination";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  StatTile,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { OffsetPagination } from "@/components/pagination";
import { HolidayCalendar } from "./calendar";
import { HolidayFilters, type HolidayFilterValues } from "./filters";
import { AddHolidayPanel, ToggleHolidayButton } from "./forms";

export const metadata = { title: "Holidays" };

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Search = { [key: string]: string | string[] | undefined };

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requirePermission("setup.holiday.manage");
  const today = todayInNepal();
  const params = await searchParams;

  const [rows, [currentFy]] = await Promise.all([
    db.select().from(holidays).where(eq(holidays.orgId, viewer.orgId)).orderBy(asc(holidays.date)),
    db
      .select()
      .from(fiscalYears)
      .where(and(eq(fiscalYears.orgId, viewer.orgId), eq(fiscalYears.isCurrent, true)))
      .limit(1),
  ]);

  // The full set is loaded once and drives four things: the tiles, the calendar,
  // the filter counts and the table. Paging this in SQL would mean querying the
  // same table repeatedly to render one screen — at a few hundred holidays a
  // year, slicing in memory is both simpler and faster. See lib/pagination.ts
  // for when that stops being true.
  const inYear = currentFy
    ? rows.filter((r) => r.date >= currentFy.startDate && r.date <= currentFy.endDate)
    : rows;
  const upcoming = rows.filter((r) => r.date >= today && r.isActive);
  const saturdayClash = rows.filter((r) => new Date(r.date).getUTCDay() === 6);

  const filters: HolidayFilterValues = {
    q: one(params.q),
    scope: (["all", "upcoming", "past"] as const).includes(one(params.scope) as never)
      ? (one(params.scope) as HolidayFilterValues["scope"])
      : "all",
    status: (["all", "active", "disabled"] as const).includes(one(params.status) as never)
      ? (one(params.status) as HolidayFilterValues["status"])
      : "all",
    clash: one(params.clash) === "saturday" ? "saturday" : "all",
  };

  const needle = filters.q.toLowerCase();
  const filtered = rows.filter((r) => {
    if (needle && !`${r.name} ${r.nameNepali ?? ""} ${r.dateBs}`.toLowerCase().includes(needle)) {
      return false;
    }
    if (filters.scope === "upcoming" && r.date < today) return false;
    if (filters.scope === "past" && r.date >= today) return false;
    if (filters.status === "active" && !r.isActive) return false;
    if (filters.status === "disabled" && r.isActive) return false;
    if (filters.clash === "saturday" && new Date(r.date).getUTCDay() !== 6) return false;
    return true;
  });

  const page = offsetPage({
    page: one(params.page),
    total: filtered.length,
    defaultSize: PAGE_SIZE.compact,
  });
  const visible = sliceOffsetPage(filtered, page);

  // The calendar follows the fiscal year, not the filters: it is context for the
  // list, and a calendar that empties as you filter stops being context.
  const calendarYear = adToBs(currentFy?.startDate ?? today).year;

  return (
    <>
      <PageHeader
        title="Holidays"
        description="Excluded from leave and attendance day counting, alongside Saturdays — Nepal works a six-day week."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={currentFy ? `In ${currentFy.code}` : "Recorded"}
          value={inYear.length}
          tone="accent"
        />
        <StatTile label="Upcoming" value={upcoming.length} tone="info" />
        <StatTile label="Disabled" value={rows.filter((r) => !r.isActive).length} />
        <StatTile
          label="Falling on a Saturday"
          value={saturdayClash.length}
          tone={saturdayClash.length ? "warn" : "neutral"}
          sub={saturdayClash.length ? "Already a weekly off — counted once" : "None"}
        />
      </div>

      {/*
        The add form is a disclosure below the tiles rather than a permanent
        panel beside the table. It is used a dozen times a year and was taking
        40% of the screen for the other 353 days; the calendar that now occupies
        that space is read every time somebody opens this page.
      */}
      <div className="mt-4 flex flex-col gap-3">
        <AddHolidayPanel />
        <HolidayFilters values={filters} total={rows.length} showing={filtered.length} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_minmax(0,26rem)]">
        <div>
          {filtered.length === 0 ? (
            <Card>
              <EmptyState
                title={rows.length === 0 ? "No holidays defined" : "No holidays match these filters"}
                hint={
                  rows.length === 0
                    ? "Add the public holidays for the year."
                    : "Clear the filters to see the rest."
                }
              />
            </Card>
          ) : (
            <div className="overflow-hidden rounded-md border border-line bg-surface">
              <TableShell className="rounded-none border-0">
                <thead>
                  <tr>
                    <Th>Date (BS)</Th>
                    <Th>Date (AD)</Th>
                    <Th>Day</Th>
                    <Th>Holiday</Th>
                    <Th>Applies to</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((h) => {
                    const weekday = new Date(h.date).getUTCDay();
                    return (
                      <Tr key={h.id} className={h.isActive ? undefined : "opacity-60"}>
                        <Td>
                          <span className="flex items-center gap-2">
                            <span className="tabular font-medium text-ink">{h.dateBs}</span>
                            {h.date >= today ? <Badge tone="info">Upcoming</Badge> : null}
                          </span>
                        </Td>
                        <Td className="tabular text-ink-soft">
                          {new Date(h.date).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </Td>
                        <Td
                          className={weekday === 6 ? "text-xs text-warn" : "text-xs text-ink-faint"}
                        >
                          {WEEKDAY[weekday]}
                        </Td>
                        <Td>
                          <span className="block text-ink">{h.name}</span>
                          {h.nameNepali ? (
                            <span className="block text-xs text-ink-faint">{h.nameNepali}</span>
                          ) : null}
                        </Td>
                        <Td className="text-ink-soft capitalize">
                          {h.appliesToGender ?? "everyone"}
                        </Td>
                        <Td>
                          <Badge tone={h.isActive ? "ok" : "neutral"}>
                            {h.isActive ? "Active" : "Disabled"}
                          </Badge>
                        </Td>
                        <Td className="text-right">
                          <ToggleHolidayButton id={h.id} active={h.isActive} />
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </TableShell>

              <OffsetPagination page={page} params={params} label="holidays" />
            </div>
          )}
        </div>

        <HolidayCalendar
          bsYear={calendarYear}
          holidays={rows}
          today={today}
          fiscalRange={currentFy ? { from: currentFy.startDate, to: currentFy.endDate } : null}
        />
      </div>
    </>
  );
}
