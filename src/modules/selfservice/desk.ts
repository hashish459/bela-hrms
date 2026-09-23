import "server-only";

import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { holidays } from "@/db/schema/core";
import { branches, departments, designations, employmentTypes, grades } from "@/db/schema/org";
import { employeeAssignments, employees, onStrength } from "@/db/schema/hr";
import { leaveBalances, leaveRequests, leaveTypes } from "@/db/schema/leave";
import { attendanceDays } from "@/db/schema/attendance";
import {
  employeeDocuments,
  employeeExperience,
  employeeFamily,
  employeeQualifications,
  noticeReads,
  notices,
} from "@/db/schema/selfservice";
import { addDays, adToBs, formatBsKey, todayInNepal } from "@/lib/bs";
import type { Viewer } from "@/lib/session";

/**
 * The Employee Desk service.
 *
 * One rule governs this entire file, and it is the reason it exists as a service
 * rather than as queries scattered through pages:
 *
 *   **The employee id comes from the session. Never from the request.**
 *
 * The legacy self-service module took `?empId=` on fifty API actions and checked
 * it on none of them, so any employee could read any other employee's payslips,
 * documents and family details by editing the address bar. Every function below
 * takes a `SelfContext` that only `requireSelf()` can produce, and
 * `requireSelf()` reads the id off the session — there is no parameter to
 * tamper with.
 *
 * Permission alone is not the control here. Everybody holds `self.desk.view`;
 * what differs is *whose* record it opens, and that is ownership, not a grant.
 */

export type SelfContext = {
  orgId: string;
  employeeId: string;
  viewer: Viewer;
};

/*
 * The guard that produces a SelfContext lives in ./guard.ts, not here.
 *
 * It has to import `next/navigation` to raise a 403, which drags the client
 * router into anything that touches this file — including the check script that
 * asserts these queries filter correctly. Keeping the data layer free of the
 * framework is what lets that script exercise it directly.
 */

/* ------------------------------------------------------------------ profile */

export type SelfProfile = Awaited<ReturnType<typeof profile>>;

/** The employee's own record, joined to the names of everything it points at. */
export async function profile(ctx: SelfContext) {
  const [row] = await db
    .select({
      employee: employees,
      branch: branches.name,
      department: departments.name,
      designation: designations.name,
      employmentType: employmentTypes.name,
      grade: grades.name,
      supervisorName: sql<string | null>`sup.first_name || ' ' || sup.last_name`,
      supervisorCode: sql<string | null>`sup.employee_code`,
    })
    .from(employees)
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(employmentTypes, eq(employmentTypes.id, employees.employmentTypeId))
    .leftJoin(grades, eq(grades.id, employees.gradeId))
    .leftJoin(sql`employees sup`, sql`sup.id = ${employees.supervisorId}`)
    // Both predicates: the id is already trusted, and the tenant check makes a
    // cross-organisation read impossible even if it ever stops being.
    .where(and(eq(employees.id, ctx.employeeId), eq(employees.orgId, ctx.orgId)))
    .limit(1);

  return row ?? null;
}

/** Service history — the legacy "Job Allocation" tab. */
export async function serviceHistory(ctx: SelfContext) {
  return db
    .select({
      id: employeeAssignments.id,
      effectiveFrom: employeeAssignments.effectiveFrom,
      effectiveTo: employeeAssignments.effectiveTo,
      reason: employeeAssignments.reason,
      isCurrent: employeeAssignments.isCurrent,
      branch: branches.name,
      department: departments.name,
      designation: designations.name,
      grade: grades.name,
    })
    .from(employeeAssignments)
    .leftJoin(branches, eq(branches.id, employeeAssignments.branchId))
    .leftJoin(departments, eq(departments.id, employeeAssignments.departmentId))
    .leftJoin(designations, eq(designations.id, employeeAssignments.designationId))
    .leftJoin(grades, eq(grades.id, employeeAssignments.gradeId))
    .where(eq(employeeAssignments.employeeId, ctx.employeeId))
    .orderBy(desc(employeeAssignments.effectiveFrom));
}

export async function family(ctx: SelfContext) {
  return db
    .select()
    .from(employeeFamily)
    .where(and(eq(employeeFamily.employeeId, ctx.employeeId), isNull(employeeFamily.deletedAt)))
    .orderBy(asc(employeeFamily.relationship), asc(employeeFamily.fullName));
}

export async function qualifications(ctx: SelfContext) {
  return db
    .select()
    .from(employeeQualifications)
    .where(and(eq(employeeQualifications.employeeId, ctx.employeeId), isNull(employeeQualifications.deletedAt)))
    .orderBy(desc(employeeQualifications.completedYear), asc(employeeQualifications.title));
}

export async function experience(ctx: SelfContext) {
  return db
    .select()
    .from(employeeExperience)
    .where(and(eq(employeeExperience.employeeId, ctx.employeeId), isNull(employeeExperience.deletedAt)))
    .orderBy(desc(employeeExperience.fromDate));
}

/**
 * Documents the employee is allowed to see.
 *
 * The visibility filter is applied here, in the service, and not in the page.
 * A filter in a page is one somebody forgets when they add the next screen.
 */
export async function documents(ctx: SelfContext) {
  return db
    .select()
    .from(employeeDocuments)
    .where(
      and(
        eq(employeeDocuments.employeeId, ctx.employeeId),
        eq(employeeDocuments.isVisibleToEmployee, true),
        isNull(employeeDocuments.deletedAt),
      ),
    )
    .orderBy(desc(employeeDocuments.issuedOn));
}

/* ------------------------------------------------------------------- notices */

/**
 * Notices addressed to this employee, newest and pinned first.
 *
 * Audience is resolved in SQL rather than by fetching everything and filtering
 * in JavaScript: on a board with a few hundred notices the difference is
 * invisible, and the habit is what keeps it invisible at a few hundred thousand.
 */
export async function noticeBoard(ctx: SelfContext, options: { unreadOnly?: boolean } = {}) {
  const me = await profile(ctx);
  const today = todayInNepal();

  const rows = await db
    .select({
      notice: notices,
      readAt: noticeReads.readAt,
    })
    .from(notices)
    .leftJoin(
      noticeReads,
      and(eq(noticeReads.noticeId, notices.id), eq(noticeReads.employeeId, ctx.employeeId)),
    )
    .where(
      and(
        eq(notices.orgId, ctx.orgId),
        eq(notices.isActive, true),
        isNull(notices.deletedAt),
        lte(notices.publishFrom, today),
        or(isNull(notices.publishTo), gte(notices.publishTo, today)),
        or(
          eq(notices.audience, "everyone"),
          and(
            eq(notices.audience, "branch"),
            me?.employee.branchId ? eq(notices.branchId, me.employee.branchId) : sql`false`,
          ),
          and(
            eq(notices.audience, "department"),
            me?.employee.departmentId
              ? eq(notices.departmentId, me.employee.departmentId)
              : sql`false`,
          ),
        ),
      ),
    )
    .orderBy(desc(notices.isPinned), desc(notices.publishFrom));

  const mapped = rows.map((r) => ({ ...r.notice, readAt: r.readAt }));
  return options.unreadOnly ? mapped.filter((n) => !n.readAt) : mapped;
}

/** Idempotent: reading a notice twice is one row, so the count stays honest. */
export async function markNoticeRead(ctx: SelfContext, noticeId: string): Promise<void> {
  await db
    .insert(noticeReads)
    .values({ noticeId, employeeId: ctx.employeeId })
    .onConflictDoNothing();
}

/* ------------------------------------------------------------------ the desk */

export type DeskSummary = Awaited<ReturnType<typeof deskSummary>>;

/**
 * Everything the desk landing page shows, in one round of queries.
 *
 * Assembled here rather than in the page so the page stays a layout and this
 * stays testable — and so the six queries fan out in parallel instead of
 * waterfalling through six awaits in JSX.
 */
export async function deskSummary(ctx: SelfContext) {
  const today = todayInNepal();
  const monthStart = addDays(today, -30);
  const horizon = addDays(today, 45);

  const [
    todayRow,
    balances,
    pendingLeave,
    recentAttendance,
    upcomingHolidays,
    unreadNotices,
    birthdays,
  ] = await Promise.all([
    db
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, ctx.employeeId), eq(attendanceDays.date, today)))
      .limit(1),

    db
      .select({
        id: leaveBalances.id,
        typeName: leaveTypes.name,
        colour: leaveTypes.colour,
        entitled: leaveBalances.entitled,
        carriedForward: leaveBalances.carriedForward,
        used: leaveBalances.used,
        pending: leaveBalances.pending,
      })
      .from(leaveBalances)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
      .where(eq(leaveBalances.employeeId, ctx.employeeId))
      .orderBy(asc(leaveTypes.leaveOrder), asc(leaveTypes.name)),

    db
      .select({
        id: leaveRequests.id,
        reference: leaveRequests.reference,
        fromDateBs: leaveRequests.fromDateBs,
        toDateBs: leaveRequests.toDateBs,
        totalDays: leaveRequests.totalDays,
        status: leaveRequests.status,
        typeName: leaveTypes.name,
        colour: leaveTypes.colour,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(
        and(eq(leaveRequests.employeeId, ctx.employeeId), eq(leaveRequests.status, "pending")),
      )
      .orderBy(asc(leaveRequests.fromDate)),

    db
      .select({
        date: attendanceDays.date,
        dateBs: attendanceDays.dateBs,
        status: attendanceDays.status,
        checkIn: attendanceDays.checkIn,
        checkOut: attendanceDays.checkOut,
        workedMinutes: attendanceDays.workedMinutes,
        lateMinutes: attendanceDays.lateMinutes,
        otMinutes: attendanceDays.otMinutes,
      })
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.employeeId, ctx.employeeId),
          gte(attendanceDays.date, monthStart),
          lte(attendanceDays.date, today),
        ),
      )
      .orderBy(desc(attendanceDays.date)),

    db
      .select()
      .from(holidays)
      .where(
        and(
          eq(holidays.orgId, ctx.orgId),
          eq(holidays.isActive, true),
          gte(holidays.date, today),
          lte(holidays.date, horizon),
        ),
      )
      .orderBy(asc(holidays.date))
      .limit(6),

    noticeBoard(ctx, { unreadOnly: true }),

    // Birthdays inside the horizon, compared on month and day so the year is
    // irrelevant. `to_char` keeps it one indexed scan rather than 200 date
    // objects built in JavaScript.
    db
      .select({
        id: employees.id,
        code: employees.employeeCode,
        name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        dateOfBirth: employees.dateOfBirth,
        department: departments.name,
        // Prefer a photograph uploaded through the product over a legacy
        // hosted URL, resolved here so every desk screen gets one field and
        // none of them has to know the file route exists. In Postgres
        // `'x' || NULL` is NULL, so the coalesce falls through cleanly.
        photoUrl: sql<string | null>`coalesce('/api/files/' || ${employees.photoFileId}, ${employees.photoUrl})`,
      })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(
        and(
          eq(employees.orgId, ctx.orgId),
          sql`${employees.deletedAt} IS NULL`,
          sql`${employees.dateOfBirth} IS NOT NULL`,
          sql`to_char(${employees.dateOfBirth}, 'MM-DD') BETWEEN to_char(${today}::date, 'MM-DD') AND to_char(${today}::date + 14, 'MM-DD')`,
        ),
      )
      .orderBy(sql`to_char(${employees.dateOfBirth}, 'MM-DD')`)
      .limit(8),
  ]);

  const worked = recentAttendance.filter((d) => d.status === "present" || d.status === "field_work");
  const absences = recentAttendance.filter((d) => d.status === "absent");
  const lateDays = recentAttendance.filter((d) => d.lateMinutes > 0);

  return {
    today: {
      iso: today,
      bs: formatBsKey(adToBs(today)),
      record: todayRow[0] ?? null,
    },
    balances: balances.map((b) => {
      const available =
        Number(b.entitled) + Number(b.carriedForward) - Number(b.used) - Number(b.pending);
      return { ...b, available };
    }),
    pendingLeave,
    recentAttendance,
    stats: {
      workedDays: worked.length,
      absentDays: absences.length,
      lateDays: lateDays.length,
      otMinutes: recentAttendance.reduce((sum, d) => sum + d.otMinutes, 0),
    },
    upcomingHolidays,
    unreadNotices,
    birthdays,
  };
}

/* -------------------------------------------------------------- directory */

/**
 * The staff directory.
 *
 * Deliberately narrow: name, code, designation, department, branch, work email
 * and work mobile. Salary, date of birth, address and every statutory number
 * are absent — a directory that carries them is a data breach waiting for one
 * curious employee, and the legacy staff list carried all of them.
 */
export async function directory(
  ctx: SelfContext,
  filter: { q?: string; departmentId?: string; branchId?: string } = {},
) {
  const conditions = [eq(employees.orgId, ctx.orgId), onStrength()];

  if (filter.q) {
    const like = `%${filter.q.toLowerCase()}%`;
    conditions.push(
      sql`lower(${employees.firstName} || ' ' || ${employees.lastName} || ' ' || ${employees.employeeCode}) LIKE ${like}`,
    );
  }
  if (filter.departmentId) conditions.push(eq(employees.departmentId, filter.departmentId));
  if (filter.branchId) conditions.push(eq(employees.branchId, filter.branchId));

  return db
    .select({
      id: employees.id,
      code: employees.employeeCode,
      name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      nameNepali: employees.fullNameNepali,
      workEmail: employees.workEmail,
      mobile: employees.mobile,
      photoUrl: sql<string | null>`coalesce('/api/files/' || ${employees.photoFileId}, ${employees.photoUrl})`,
      designation: designations.name,
      department: departments.name,
      branch: branches.name,
      isMe: sql<boolean>`${employees.id} = ${ctx.employeeId}`,
    })
    .from(employees)
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(branches, eq(branches.id, employees.branchId))
    .where(and(...conditions))
    .orderBy(asc(employees.employeeCode));
}

/* --------------------------------------------------------------- calendar */

export type CalendarDayEntry = {
  date: string;
  dateBs: string;
  day: number;
  weekday: number;
  status: string | null;
  checkIn: string | null;
  checkOut: string | null;
  holidayName: string | null;
  leaveName: string | null;
  leaveColour: string | null;
  isToday: boolean;
  isFuture: boolean;
};

/**
 * One Bikram Sambat month of the employee's own days, ready to render.
 *
 * The legacy personal calendar issued one API call per cell. This is three
 * queries for the whole month, joined in memory — the same screen, two orders
 * of magnitude fewer round trips.
 */
export async function personalCalendar(
  ctx: SelfContext,
  range: { from: string; to: string },
): Promise<CalendarDayEntry[]> {
  const today = todayInNepal();

  const [days, hols, leaves] = await Promise.all([
    db
      .select()
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.employeeId, ctx.employeeId),
          gte(attendanceDays.date, range.from),
          lte(attendanceDays.date, range.to),
        ),
      ),

    db
      .select({ date: holidays.date, name: holidays.name })
      .from(holidays)
      .where(
        and(
          eq(holidays.orgId, ctx.orgId),
          eq(holidays.isActive, true),
          gte(holidays.date, range.from),
          lte(holidays.date, range.to),
        ),
      ),

    db
      .select({
        fromDate: leaveRequests.fromDate,
        toDate: leaveRequests.toDate,
        name: leaveTypes.name,
        colour: leaveTypes.colour,
        status: leaveRequests.status,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(
        and(
          eq(leaveRequests.employeeId, ctx.employeeId),
          lte(leaveRequests.fromDate, range.to),
          gte(leaveRequests.toDate, range.from),
          sql`${leaveRequests.status} IN ('pending','approved')`,
        ),
      ),
  ]);

  const dayByDate = new Map(days.map((d) => [d.date, d]));
  const holidayByDate = new Map(hols.map((h) => [h.date, h.name]));

  const leaveByDate = new Map<string, { name: string; colour: string }>();
  for (const l of leaves) {
    for (let d = l.fromDate; d <= l.toDate; d = addDays(d, 1)) {
      leaveByDate.set(d, { name: l.name, colour: l.colour });
    }
  }

  const out: CalendarDayEntry[] = [];
  for (let d = range.from, guard = 0; d <= range.to && guard < 40; d = addDays(d, 1), guard++) {
    const bs = adToBs(d);
    const record = dayByDate.get(d);
    const leave = leaveByDate.get(d);
    out.push({
      date: d,
      dateBs: formatBsKey(bs),
      day: bs.day,
      weekday: new Date(d).getUTCDay(),
      status: record?.status ?? null,
      checkIn: record?.checkIn ?? null,
      checkOut: record?.checkOut ?? null,
      holidayName: holidayByDate.get(d) ?? null,
      leaveName: leave?.name ?? null,
      leaveColour: leave?.colour ?? null,
      isToday: d === today,
      isFuture: d > today,
    });
  }
  return out;
}
