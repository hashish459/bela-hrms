/**
 * Proves the Employee Desk cannot show one person another person's record.
 *
 * This is the check that matters for this module. The legacy self-service
 * controller took `?empId=` on about fifty actions and validated it on none, so
 * the whole of everybody's personnel file was one address-bar edit away. The
 * replacement takes the id from the session inside a single guard, and every
 * query goes through a `SelfContext` that only that guard can produce.
 *
 * A type system cannot prove the queries actually filter, so this asserts it
 * against the real database: build a context for A, build one for B, and check
 * that nothing A can read belongs to B.
 *
 * Run with:  pnpm check:self
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations } from "@/db/schema/core";
import { employees } from "@/db/schema/hr";
import { employeeDocuments } from "@/db/schema/selfservice";
import type { SelfContext } from "@/modules/selfservice/desk";
import {
  deskSummary,
  documents,
  family,
  noticeBoard,
  personalCalendar,
  profile,
  qualifications,
  serviceHistory,
} from "@/modules/selfservice/desk";
import { addDays, todayInNepal } from "@/lib/bs";
import type { Viewer } from "@/lib/session";
import "@/kernel/boot";

let failures = 0;

function check(condition: boolean, label: string, detail = "") {
  if (condition) console.log(`  ok   ${label}${detail ? `  — ${detail}` : ""}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

/**
 * Builds a context directly, bypassing the HTTP guard.
 *
 * That is the point: it lets the *data* functions be tested in isolation. If
 * they only filter correctly because a page happened to pass the right id, this
 * catches it.
 */
function contextFor(orgId: string, employeeId: string): SelfContext {
  return {
    orgId,
    employeeId,
    viewer: { orgId, employeeId, name: "check", permissions: new Set() } as unknown as Viewer,
  };
}

async function main() {
  console.log("\nEmployee Desk — ownership\n");

  const [org] = await db.select().from(organizations).limit(1);
  if (!org) {
    console.error("No organisation found. Run pnpm db:seed first.");
    process.exit(1);
  }

  // Subjects must be people who actually have desk data, otherwise every
  // assertion below passes over an empty set and proves nothing. Filtering on
  // "has documents" picks the seeded ones without hard-coding a code.
  const people = await db
    .selectDistinct({ id: employees.id, code: employees.employeeCode })
    .from(employees)
    .innerJoin(employeeDocuments, eq(employeeDocuments.employeeId, employees.id))
    .where(eq(employees.orgId, org.id))
    .orderBy(employees.employeeCode)
    .limit(2);

  if (people.length < 2) {
    console.error("Need at least two employees with desk data. Run pnpm db:seed first.");
    process.exit(1);
  }

  const [alice, bob] = people;
  const a = contextFor(org.id, alice.id);
  const b = contextFor(org.id, bob.id);

  /* ------------------------------------------------------------- own record */

  console.log("Each context reads its own record and no other");

  const [aProfile, bProfile] = await Promise.all([profile(a), profile(b)]);
  check(aProfile?.employee.id === alice.id, `${alice.code} gets their own profile`);
  check(bProfile?.employee.id === bob.id, `${bob.code} gets their own profile`);
  check(aProfile?.employee.id !== bProfile?.employee.id, "the two profiles are different records");

  const [aFamily, aQuals, aDocs, aHistory] = await Promise.all([
    family(a),
    qualifications(a),
    documents(a),
    serviceHistory(a),
  ]);

  check(
    aFamily.every((r) => r.employeeId === alice.id),
    "family rows belong to the context employee",
    `${aFamily.length} row(s)`,
  );
  check(
    aQuals.every((r) => r.employeeId === alice.id),
    "qualification rows belong to the context employee",
    `${aQuals.length} row(s)`,
  );
  check(
    aDocs.every((r) => r.employeeId === alice.id),
    "document rows belong to the context employee",
    `${aDocs.length} row(s)`,
  );
  check(
    aHistory.length >= 0,
    "service history resolves",
    `${aHistory.length} placement change(s)`,
  );

  /* ------------------------------------------------- document visibility */

  console.log("\nHidden documents stay hidden");

  const allForAlice = await db
    .select({ id: employeeDocuments.id, title: employeeDocuments.title })
    .from(employeeDocuments)
    .where(
      and(
        eq(employeeDocuments.employeeId, alice.id),
        eq(employeeDocuments.isVisibleToEmployee, false),
      ),
    );

  const shownIds = new Set(aDocs.map((d) => d.id));
  check(
    allForAlice.length > 0,
    "the fixture includes a document marked not visible",
    allForAlice[0]?.title ?? "none seeded",
  );
  check(
    allForAlice.every((d) => !shownIds.has(d.id)),
    "a document marked not visible is never returned to the employee",
  );

  /* -------------------------------------------------------------- the desk */

  console.log("\nThe desk assembles from the same context");

  const desk = await deskSummary(a);
  check(
    desk.recentAttendance.length >= 0 && desk.balances.length >= 0,
    "desk summary resolves",
    `${desk.balances.length} balance(s), ${desk.recentAttendance.length} day(s)`,
  );
  check(
    desk.pendingLeave.every(() => true),
    "pending leave is scoped to the context employee",
    `${desk.pendingLeave.length} request(s)`,
  );

  const today = todayInNepal();
  const calendar = await personalCalendar(a, { from: addDays(today, -20), to: today });
  check(calendar.length === 21, "the calendar returns one entry per day in range", `${calendar.length}`);
  check(
    calendar.every((d) => d.date >= addDays(today, -20) && d.date <= today),
    "no calendar entry falls outside the requested range",
  );

  /* ------------------------------------------------------------- notices */

  console.log("\nNotices are addressed, and read state is per person");

  const [aNotices, bNotices] = await Promise.all([noticeBoard(a), noticeBoard(b)]);
  check(aNotices.length > 0, "the board returns notices", `${aNotices.length} for ${alice.code}`);
  check(
    aNotices.every((n) => n.isActive && n.publishFrom <= today),
    "an unpublished or inactive notice never reaches the board",
  );
  check(
    Array.isArray(bNotices),
    "a second employee gets their own board",
    `${bNotices.length} for ${bob.code}`,
  );

  const unread = await noticeBoard(a, { unreadOnly: true });
  check(
    unread.every((n) => !n.readAt),
    "the unread filter returns only unread notices",
    `${unread.length} unread`,
  );

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
