import "server-only";

import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, onStrength } from "@/db/schema/hr";
import { departments } from "@/db/schema/org";
import { workBookEntries, workBookTasks } from "@/db/schema/workbook";
import { addDays, adToBs, formatBsKey, isSaturday, todayInNepal } from "@/lib/bs";
import { LIMITS, type EntryInput } from "./catalogue";

/**
 * The daily work-book.
 *
 * Two audiences, two doors:
 *
 *   The author — every function taking `Author` reads the employee id from the
 *   caller's session (the pages pass `viewer.employeeId`, never a form value),
 *   so nobody can open or write another person's day. A day is writable while
 *   it is a draft and inside the back-fill window; submitting locks it. An
 *   administrator can reopen a submitted day, which also lifts the window.
 *
 *   The reviewer — the `records` and `insights` functions take only an
 *   organisation and are called only behind `workbook.record.viewAll`. There
 *   is no supervisor view on purpose: the brief is that administrators review.
 */

export class WorkBookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkBookError";
  }
}

export type Author = { orgId: string; employeeId: string };

/** The earliest day an author may still write. */
export function earliestWritable(today = todayInNepal()) {
  return addDays(today, -LIMITS.backfillDays);
}

export async function entryFor(author: Author, date: string) {
  const [entry] = await db
    .select()
    .from(workBookEntries)
    .where(and(eq(workBookEntries.orgId, author.orgId), eq(workBookEntries.employeeId, author.employeeId), eq(workBookEntries.date, date)))
    .limit(1);
  if (!entry) return null;
  const tasks = await db
    .select()
    .from(workBookTasks)
    .where(eq(workBookTasks.entryId, entry.id))
    .orderBy(asc(workBookTasks.sortOrder));
  return { ...entry, tasks };
}

/**
 * Saves the author's day — replacing its tasks wholesale, which is what an
 * editor that shows all of them wants — and optionally submits it. Refused for
 * a future day, a day outside the back-fill window, and a submitted day.
 */
export async function saveEntry(author: Author, date: string, input: EntryInput, submit: boolean) {
  const today = todayInNepal();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new WorkBookError("Choose a day.");
  if (date > today) throw new WorkBookError("A work-book day can be written once it has started.");

  const totalMinutes = input.tasks.reduce((s, t) => s + t.minutes, 0);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: workBookEntries.id, status: workBookEntries.status, reopenedAt: workBookEntries.reopenedAt })
      .from(workBookEntries)
      .where(and(eq(workBookEntries.employeeId, author.employeeId), eq(workBookEntries.date, date)))
      .for("update")
      .limit(1);
    if (existing?.status === "submitted") throw new WorkBookError("This day is submitted and locked. An administrator can reopen it.");
    // an administrator reopening an old day is what lets it be corrected late
    if (date < earliestWritable(today) && !existing?.reopenedAt) {
      throw new WorkBookError(`Days older than ${LIMITS.backfillDays} days can no longer be written. Ask an administrator.`);
    }

    const values = {
      summary: input.summary,
      blockers: input.blockers,
      planNext: input.planNext,
      selfRating: input.selfRating,
      totalMinutes,
      taskCount: input.tasks.length,
      status: submit ? ("submitted" as const) : ("draft" as const),
      submittedAt: submit ? new Date() : null,
      updatedAt: new Date(),
    };

    let entryId: string;
    if (existing) {
      await tx.update(workBookEntries).set(values).where(eq(workBookEntries.id, existing.id));
      entryId = existing.id;
      await tx.delete(workBookTasks).where(eq(workBookTasks.entryId, entryId));
    } else {
      const [row] = await tx
        .insert(workBookEntries)
        .values({ orgId: author.orgId, employeeId: author.employeeId, date, dateBs: formatBsKey(adToBs(date)), ...values })
        .returning({ id: workBookEntries.id });
      entryId = row.id;
    }

    if (input.tasks.length) {
      await tx.insert(workBookTasks).values(
        input.tasks.map((t, i) => ({ orgId: author.orgId, entryId, ...t, sortOrder: i })),
      );
    }
    return { id: entryId, totalMinutes, submitted: submit };
  });
}

/** The author's recent days, for the streak strip and history. */
export async function recentDays(author: Author, days = 14) {
  const today = todayInNepal();
  const from = addDays(today, -(days - 1));
  const rows = await db
    .select({
      date: workBookEntries.date,
      status: workBookEntries.status,
      totalMinutes: workBookEntries.totalMinutes,
      taskCount: workBookEntries.taskCount,
    })
    .from(workBookEntries)
    .where(and(eq(workBookEntries.orgId, author.orgId), eq(workBookEntries.employeeId, author.employeeId), gte(workBookEntries.date, from)))
    .orderBy(desc(workBookEntries.date));
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(today, -i);
    const r = byDate.get(d);
    return { date: d, status: r?.status ?? null, totalMinutes: r?.totalMinutes ?? 0, taskCount: r?.taskCount ?? 0, weeklyOff: isSaturday(d) };
  });
}

/* ------------------------------------------------------------- review side */

export type RecordFilter = {
  from: string;
  to: string;
  departmentId?: string | null;
  employeeId?: string | null;
  status?: "draft" | "submitted" | null;
  q?: string | null;
};

function recordWhere(orgId: string, f: RecordFilter): SQL {
  const parts: (SQL | undefined)[] = [
    eq(workBookEntries.orgId, orgId),
    gte(workBookEntries.date, f.from),
    lte(workBookEntries.date, f.to),
    isNull(employees.deletedAt),
    f.departmentId ? eq(employees.departmentId, f.departmentId) : undefined,
    f.employeeId ? eq(workBookEntries.employeeId, f.employeeId) : undefined,
    f.status ? eq(workBookEntries.status, f.status) : undefined,
  ];
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    parts.push(
      or(
        ilike(workBookEntries.summary, like),
        sql`exists (select 1 from ${workBookTasks} t where t.entry_id = ${workBookEntries.id}
              and (t.title ilike ${like} or t.details ilike ${like} or t.project ilike ${like}))`,
        ilike(sql`${employees.firstName} || ' ' || ${employees.lastName}`, like),
      ),
    );
  }
  return and(...parts)!;
}

/** A page of entries with their tasks, newest first. */
export async function records(orgId: string, f: RecordFilter, page: { limit: number; offset: number }) {
  const where = recordWhere(orgId, f);
  const [[{ n }], rows] = await Promise.all([
    db
      .select({ n: count() })
      .from(workBookEntries)
      .innerJoin(employees, eq(employees.id, workBookEntries.employeeId))
      .where(where),
    db
      .select({
        e: workBookEntries,
        employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        firstName: employees.firstName,
        lastName: employees.lastName,
        employeeCode: employees.employeeCode,
        photoFileId: employees.photoFileId,
        department: departments.name,
      })
      .from(workBookEntries)
      .innerJoin(employees, eq(employees.id, workBookEntries.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(where)
      .orderBy(desc(workBookEntries.date), asc(employees.firstName))
      .limit(page.limit)
      .offset(page.offset),
  ]);

  const ids = rows.map((r) => r.e.id);
  const tasks = ids.length
    ? await db.select().from(workBookTasks).where(inArray(workBookTasks.entryId, ids)).orderBy(asc(workBookTasks.sortOrder))
    : [];
  const byEntry = new Map<string, typeof tasks>();
  for (const t of tasks) byEntry.set(t.entryId, [...(byEntry.get(t.entryId) ?? []), t]);

  return { total: Number(n), rows: rows.map((r) => ({ ...r, tasks: byEntry.get(r.e.id) ?? [] })) };
}

/** Every task in a filter, flat, for the CSV export. Capped. */
export async function exportRows(orgId: string, f: RecordFilter, cap = 50_000) {
  return db
    .select({
      date: workBookEntries.date,
      dateBs: workBookEntries.dateBs,
      status: workBookEntries.status,
      employeeCode: employees.employeeCode,
      employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      department: departments.name,
      summary: workBookEntries.summary,
      selfRating: workBookEntries.selfRating,
      title: workBookTasks.title,
      category: workBookTasks.category,
      project: workBookTasks.project,
      minutes: workBookTasks.minutes,
      taskStatus: workBookTasks.status,
      outcome: workBookTasks.outcome,
      details: workBookTasks.details,
    })
    .from(workBookEntries)
    .innerJoin(employees, eq(employees.id, workBookEntries.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(workBookTasks, eq(workBookTasks.entryId, workBookEntries.id))
    .where(recordWhere(orgId, f))
    .orderBy(desc(workBookEntries.date), asc(employees.employeeCode), asc(workBookTasks.sortOrder))
    .limit(cap);
}

/** Puts a submitted day back into draft so its author can correct it. */
export async function reopenEntry(orgId: string, entryId: string, byLabel: string) {
  const rows = await db
    .update(workBookEntries)
    .set({ status: "draft", submittedAt: null, reopenedAt: new Date(), reopenedByLabel: byLabel, updatedAt: new Date() })
    .where(and(eq(workBookEntries.id, entryId), eq(workBookEntries.orgId, orgId), eq(workBookEntries.status, "submitted")))
    .returning({ date: workBookEntries.date });
  if (!rows.length) throw new WorkBookError("Only a submitted day can be reopened.");
  return rows[0];
}

/**
 * The analysis behind the Insights screen, computed in SQL over the range:
 * submission discipline, where the time went, and who has not written today.
 */
export async function insights(orgId: string, from: string, to: string, departmentId: string | null) {
  const today = todayInNepal();
  const dept = departmentId ? eq(employees.departmentId, departmentId) : undefined;
  const base = and(eq(workBookEntries.orgId, orgId), gte(workBookEntries.date, from), lte(workBookEntries.date, to), isNull(employees.deletedAt), dept);
  const submitted = and(base, eq(workBookEntries.status, "submitted"));

  const [[totals], byDay, byCategory, byDepartment, byProject, byPerson, [staff], missingToday] = await Promise.all([
    db
      .select({
        entries: count(),
        submitted: sql<number>`count(*) filter (where ${workBookEntries.status} = 'submitted')::int`,
        minutes: sql<number>`coalesce(sum(${workBookEntries.totalMinutes}) filter (where ${workBookEntries.status} = 'submitted'), 0)::int`,
        tasks: sql<number>`coalesce(sum(${workBookEntries.taskCount}) filter (where ${workBookEntries.status} = 'submitted'), 0)::int`,
        rating: sql<number | null>`avg(${workBookEntries.selfRating}) filter (where ${workBookEntries.status} = 'submitted')`,
        people: sql<number>`count(distinct ${workBookEntries.employeeId})::int`,
      })
      .from(workBookEntries)
      .innerJoin(employees, eq(employees.id, workBookEntries.employeeId))
      .where(base),
    db
      .select({ date: workBookEntries.date, n: sql<number>`count(*)::int`, minutes: sql<number>`sum(${workBookEntries.totalMinutes})::int` })
      .from(workBookEntries)
      .innerJoin(employees, eq(employees.id, workBookEntries.employeeId))
      .where(submitted)
      .groupBy(workBookEntries.date)
      .orderBy(workBookEntries.date),
    db
      .select({ category: workBookTasks.category, minutes: sql<number>`sum(${workBookTasks.minutes})::int`, n: sql<number>`count(*)::int` })
      .from(workBookTasks)
      .innerJoin(workBookEntries, eq(workBookEntries.id, workBookTasks.entryId))
      .innerJoin(employees, eq(employees.id, workBookEntries.employeeId))
      .where(submitted)
      .groupBy(workBookTasks.category)
      .orderBy(desc(sql`sum(${workBookTasks.minutes})`)),
    db
      .select({
        department: sql<string>`coalesce(${departments.name}, 'No department')`,
        minutes: sql<number>`sum(${workBookEntries.totalMinutes})::int`,
        entries: sql<number>`count(*)::int`,
      })
      .from(workBookEntries)
      .innerJoin(employees, eq(employees.id, workBookEntries.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(submitted)
      .groupBy(departments.name)
      .orderBy(desc(sql`sum(${workBookEntries.totalMinutes})`)),
    db
      .select({ project: workBookTasks.project, minutes: sql<number>`sum(${workBookTasks.minutes})::int`, n: sql<number>`count(*)::int` })
      .from(workBookTasks)
      .innerJoin(workBookEntries, eq(workBookEntries.id, workBookTasks.entryId))
      .innerJoin(employees, eq(employees.id, workBookEntries.employeeId))
      .where(and(submitted, sql`${workBookTasks.project} is not null`))
      .groupBy(workBookTasks.project)
      .orderBy(desc(sql`sum(${workBookTasks.minutes})`))
      .limit(8),
    db
      .select({
        employeeId: workBookEntries.employeeId,
        name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        code: employees.employeeCode,
        days: sql<number>`count(*)::int`,
        minutes: sql<number>`sum(${workBookEntries.totalMinutes})::int`,
        blocked: sql<number>`(select count(*)::int from ${workBookTasks} t join ${workBookEntries} e2 on e2.id = t.entry_id
                  where e2.employee_id = ${workBookEntries.employeeId} and e2.date between ${from} and ${to} and t.status = 'blocked')`,
      })
      .from(workBookEntries)
      .innerJoin(employees, eq(employees.id, workBookEntries.employeeId))
      .where(submitted)
      .groupBy(workBookEntries.employeeId, employees.firstName, employees.lastName, employees.employeeCode)
      .orderBy(desc(sql`sum(${workBookEntries.totalMinutes})`))
      .limit(12),
    db
      .select({ n: count() })
      .from(employees)
      .where(and(eq(employees.orgId, orgId), onStrength(), dept)),
    db
      .select({
        id: employees.id,
        name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        code: employees.employeeCode,
        department: departments.name,
      })
      .from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .where(
        and(
          eq(employees.orgId, orgId),
          onStrength(),
          dept,
          sql`not exists (select 1 from ${workBookEntries} w where w.employee_id = ${employees.id} and w.date = ${today} and w.status = 'submitted')`,
        ),
      )
      .orderBy(asc(employees.firstName))
      .limit(50),
  ]);

  return {
    totals: { ...totals, rating: totals.rating === null ? null : Number(totals.rating) },
    byDay,
    byCategory,
    byDepartment,
    byProject,
    byPerson,
    staff: Number(staff.n),
    missingToday,
  };
}
