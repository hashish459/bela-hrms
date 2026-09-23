/**
 * The daily work-book: what each person did, day by day.
 *
 * One entry per employee per day holds the day's summary, blockers and plan;
 * its tasks hold the detail — what, for which project, how long, and where it
 * stands. `total_minutes` and `task_count` are kept on the entry by the service
 * (in the same transaction as the tasks) so the review screens can list and
 * aggregate thousands of days without summing tasks row by row.
 *
 * Only the author writes an entry, and only while it is a draft; only an
 * administrator (`workbook.record.viewAll`) reads anybody else's.
 */
import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./core";
import { employees } from "./hr";

export const workBookStatus = pgEnum("work_book_status", ["draft", "submitted"]);

export const workTaskCategory = pgEnum("work_task_category", [
  "development",
  "operations",
  "meeting",
  "support",
  "administration",
  "field_work",
  "training",
  "research",
  "planning",
  "other",
]);

export const workTaskStatus = pgEnum("work_task_status", ["done", "in_progress", "blocked"]);

export const workBookEntries = pgTable(
  "work_book_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    dateBs: text("date_bs").notNull(),
    status: workBookStatus("status").notNull().default("draft"),
    /** The day in a sentence or two. */
    summary: text("summary"),
    blockers: text("blockers"),
    planNext: text("plan_next"),
    /** How the day went, 1–5, in the author's own view. */
    selfRating: smallint("self_rating"),
    totalMinutes: integer("total_minutes").notNull().default(0),
    taskCount: integer("task_count").notNull().default(0),
    submittedAt: timestamp("submitted_at"),
    reopenedAt: timestamp("reopened_at"),
    reopenedByLabel: text("reopened_by_label"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("work_book_entries_employee_date_key").on(t.employeeId, t.date),
    index("work_book_entries_org_date_idx").on(t.orgId, t.date),
    index("work_book_entries_org_status_idx").on(t.orgId, t.status, t.date),
  ],
);

export const workBookTasks = pgTable(
  "work_book_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => workBookEntries.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    details: text("details"),
    category: workTaskCategory("category").notNull().default("other"),
    /** Project, client or work order — free text, so it fits any organisation. */
    project: text("project"),
    minutes: integer("minutes").notNull().default(0),
    status: workTaskStatus("status").notNull().default("done"),
    outcome: text("outcome"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("work_book_tasks_entry_idx").on(t.entryId, t.sortOrder),
    index("work_book_tasks_org_category_idx").on(t.orgId, t.category),
  ],
);
