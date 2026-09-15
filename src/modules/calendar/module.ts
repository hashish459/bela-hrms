import "server-only";

import { and, eq, gte, isNull, lte, or, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { holidays } from "@/db/schema/core";
import {
  holidayGroupBranches,
  holidayGroupEmployees,
  holidayGroups,
  weeklyOffs,
} from "@/db/schema/calendar";
import { register } from "@/kernel/registry";
import type { CalendarDay, CalendarPort, CalendarScope } from "@/kernel/ports";
import { addDays, adToBs, formatBsKey, weekdayOf } from "@/lib/bs";

/**
 * The calendar module: the single answer to "was this a working day".
 *
 * Attendance, leave and payroll all need that answer and must never disagree
 * about it, so it is one module they all read through rather than three copies
 * of the same weekday arithmetic. In the legacy system leave excluded Saturdays
 * with one expression and attendance with another, and a half-day Saturday
 * pattern made the two diverge permanently.
 *
 * Resolution order per date, and it matters:
 *
 *     scoped holiday  >  branch weekly off  >  organisation weekly off  >  working
 *
 * Scoping is deliberately resolved in one pass over three small tables rather
 * than per-date queries — a month sheet for 500 staff would otherwise be 15,000
 * round trips.
 */

/** Falls back to Saturday when an organisation has no pattern configured yet. */
const DEFAULT_WEEKLY_OFF = 6;

type WeeklyOffRow = {
  branchId: string | null;
  dayOfWeek: number;
  isHalfDay: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
};

async function loadWeeklyOffs(orgId: string, from: string, to: string): Promise<WeeklyOffRow[]> {
  return db
    .select({
      branchId: weeklyOffs.branchId,
      dayOfWeek: weeklyOffs.dayOfWeek,
      isHalfDay: weeklyOffs.isHalfDay,
      effectiveFrom: weeklyOffs.effectiveFrom,
      effectiveTo: weeklyOffs.effectiveTo,
    })
    .from(weeklyOffs)
    .where(
      and(
        eq(weeklyOffs.orgId, orgId),
        lte(weeklyOffs.effectiveFrom, to),
        or(isNull(weeklyOffs.effectiveTo), gte(weeklyOffs.effectiveTo, from)),
      ),
    );
}

type HolidayRow = {
  date: string;
  name: string;
  appliesToGender: string | null;
  holidayGroupId: string | null;
  isHalfDay: boolean;
};

async function loadHolidays(orgId: string, from: string, to: string): Promise<HolidayRow[]> {
  return db
    .select({
      date: holidays.date,
      name: holidays.name,
      appliesToGender: holidays.appliesToGender,
      holidayGroupId: holidays.holidayGroupId,
      isHalfDay: holidays.isHalfDay,
    })
    .from(holidays)
    .where(
      and(
        eq(holidays.orgId, orgId),
        eq(holidays.isActive, true),
        gte(holidays.date, from),
        lte(holidays.date, to),
      ),
    );
}

/**
 * Decides which holiday groups apply to the person being asked about. A group
 * with no employee and no branch relation applies to everyone — that is how the
 * legacy screens behaved, and re-reading it as "applies to nobody" would silently
 * turn every public holiday into a working day.
 */
async function applicableGroupIds(
  orgId: string,
  groupIds: string[],
  scope: CalendarScope,
): Promise<Set<string>> {
  const allowed = new Set<string>();
  if (groupIds.length === 0) return allowed;

  const groups = await db
    .select({
      id: holidayGroups.id,
      appliesToGender: holidayGroups.appliesToGender,
      isActive: holidayGroups.isActive,
    })
    .from(holidayGroups)
    .where(and(eq(holidayGroups.orgId, orgId), inArray(holidayGroups.id, groupIds)));

  const [empLinks, branchLinks] = await Promise.all([
    db
      .select({ groupId: holidayGroupEmployees.groupId, employeeId: holidayGroupEmployees.employeeId })
      .from(holidayGroupEmployees)
      .where(inArray(holidayGroupEmployees.groupId, groupIds)),
    db
      .select({ groupId: holidayGroupBranches.groupId, branchId: holidayGroupBranches.branchId })
      .from(holidayGroupBranches)
      .where(inArray(holidayGroupBranches.groupId, groupIds)),
  ]);

  const empByGroup = new Map<string, Set<string>>();
  for (const link of empLinks) {
    const set = empByGroup.get(link.groupId) ?? new Set<string>();
    set.add(link.employeeId);
    empByGroup.set(link.groupId, set);
  }
  const branchByGroup = new Map<string, Set<string>>();
  for (const link of branchLinks) {
    const set = branchByGroup.get(link.groupId) ?? new Set<string>();
    set.add(link.branchId);
    branchByGroup.set(link.groupId, set);
  }

  for (const group of groups) {
    if (!group.isActive) continue;
    if (group.appliesToGender && scope.gender && group.appliesToGender !== scope.gender) continue;

    const empScope = empByGroup.get(group.id);
    const branchScope = branchByGroup.get(group.id);

    // Unscoped group: applies to the whole organisation.
    if (!empScope && !branchScope) {
      allowed.add(group.id);
      continue;
    }
    if (empScope && scope.employeeId && empScope.has(scope.employeeId)) {
      allowed.add(group.id);
      continue;
    }
    if (branchScope && scope.branchId && branchScope.has(scope.branchId)) {
      allowed.add(group.id);
    }
  }

  return allowed;
}

/** Inclusive list of ISO dates between two bounds. */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  // guard against an inverted range rather than looping forever
  for (let i = 0; cursor <= to && i < 1000; i++) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export const calendarPort: CalendarPort = {
  async days(orgId, from, to, scope = {}) {
    if (to < from) return [];

    const [offs, holidayRows] = await Promise.all([
      loadWeeklyOffs(orgId, from, to),
      loadHolidays(orgId, from, to),
    ]);

    const groupIds = [...new Set(holidayRows.map((h) => h.holidayGroupId).filter(Boolean))] as string[];
    const allowedGroups = await applicableGroupIds(orgId, groupIds, scope);

    const holidayByDate = new Map<string, HolidayRow>();
    for (const row of holidayRows) {
      if (row.holidayGroupId && !allowedGroups.has(row.holidayGroupId)) continue;
      if (row.appliesToGender && scope.gender && row.appliesToGender !== scope.gender) continue;
      // first match wins; a date with two holidays is still one day off
      if (!holidayByDate.has(row.date)) holidayByDate.set(row.date, row);
    }

    // A branch pattern replaces the organisation pattern for that branch rather
    // than adding to it, so a branch that works Saturdays is expressed by giving
    // it a row for a different day.
    const branchRows = offs.filter((o) => scope.branchId && o.branchId === scope.branchId);
    const effective = branchRows.length > 0 ? branchRows : offs.filter((o) => o.branchId === null);
    const configured = effective.length > 0;

    return datesBetween(from, to).map((date): CalendarDay => {
      const dateBs = formatBsKey(adToBs(date));
      const holiday = holidayByDate.get(date);
      if (holiday) {
        return { date, dateBs, kind: "holiday", label: holiday.name };
      }

      const weekday = weekdayOf(date);
      const off = configured
        ? effective.find(
            (o) =>
              o.dayOfWeek === weekday &&
              o.effectiveFrom <= date &&
              (o.effectiveTo === null || o.effectiveTo >= date),
          )
        : weekday === DEFAULT_WEEKLY_OFF
          ? ({ isHalfDay: false } as WeeklyOffRow)
          : undefined;

      if (off && !off.isHalfDay) return { date, dateBs, kind: "weekly_off", label: null };
      return { date, dateBs, kind: "working", label: null };
    });
  },

  async workingDayCount(orgId, from, to, scope) {
    const days = await this.days(orgId, from, to, scope);
    return days.filter((d) => d.kind === "working").length;
  },
};

register({
  id: "calendar",
  version: "1.0.0",
  port: () => calendarPort,
});
