/**
 * End-to-end smoke check for the attendance regularisation workflow.
 *
 *   pnpm check:attendance
 *
 * Exercises the same functions the server actions call — submit, route, approve —
 * and asserts the attendance day is actually recalculated afterwards. Run it after
 * touching anything under src/lib/attendance.
 *
 * It writes to the demo database and restores what it touched.
 */
import { and, desc, eq, gte, notExists, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema/hr";
import { organizations, userAccounts } from "@/db/schema/core";
import { approvalSteps } from "@/db/schema/leave";
import { attendanceDays, attendanceRequests } from "@/db/schema/attendance";
import {
  ATTENDANCE_ENTITY,
  decideAttendanceRequest,
  submitAttendanceRequest,
} from "@/lib/attendance";
import { addDays, todayInNepal } from "@/lib/bs";
// Registers the modules. Every entry point needs this; the app does it in the
// authenticated layout, a script has to do it itself.
import "@/kernel/boot";

let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (!condition) failures++;
  console.log(`${condition ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
}

/**
 * Turns a recent ordinary present day into a missing-punch day so the workflow
 * always has something to correct. The original values are captured in the
 * returned `day`, which the cleanup at the end writes back — so running this
 * check twice leaves the database exactly as it found it.
 */
async function manufactureCandidate(orgId: string) {
  const [row] = await db
    .select({
      day: attendanceDays,
      employeeId: employees.id,
      employeeCode: employees.employeeCode,
      supervisorId: employees.supervisorId,
      approverUserId: userAccounts.userId,
    })
    .from(attendanceDays)
    .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
    .innerJoin(userAccounts, eq(userAccounts.employeeId, employees.supervisorId))
    .where(
      and(
        eq(attendanceDays.orgId, orgId),
        eq(attendanceDays.status, "present"),
        eq(attendanceDays.isLocked, false),
        gte(attendanceDays.date, addDays(todayInNepal(), -59)),
        notExists(
          db
            .select({ one: sql`1` })
            .from(attendanceRequests)
            .where(
              and(
                eq(attendanceRequests.employeeId, attendanceDays.employeeId),
                eq(attendanceRequests.date, attendanceDays.date),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(attendanceDays.date))
    .limit(1);

  if (!row) return null;

  await db
    .update(attendanceDays)
    .set({ checkOut: null, workedMinutes: 0, otMinutes: 0, status: "missing_punch" })
    .where(eq(attendanceDays.id, row.day.id));

  return row;
}

async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  if (!org) throw new Error("No organisation. Run pnpm db:seed first.");

  // Any employee with a correctable day inside the 60-day window that nothing has
  // been raised against yet, whose supervisor has a login to approve it with.
  const [candidate] = await db
    .select({
      day: attendanceDays,
      employeeId: employees.id,
      employeeCode: employees.employeeCode,
      supervisorId: employees.supervisorId,
      approverUserId: userAccounts.userId,
    })
    .from(attendanceDays)
    .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
    .innerJoin(userAccounts, eq(userAccounts.employeeId, employees.supervisorId))
    .where(
      and(
        eq(attendanceDays.orgId, org.id),
        eq(attendanceDays.status, "missing_punch"),
        eq(attendanceDays.isLocked, false),
        gte(attendanceDays.date, addDays(todayInNepal(), -59)),
        notExists(
          db
            .select({ one: sql`1` })
            .from(attendanceRequests)
            .where(
              and(
                eq(attendanceRequests.employeeId, attendanceDays.employeeId),
                eq(attendanceRequests.date, attendanceDays.date),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(attendanceDays.date))
    .limit(1);

  // The seed only produces a handful of correctable days, and each run of this
  // check consumes one. Rather than depending on that supply — which made the
  // check pass or fail according to how many times it had been run before — it
  // manufactures a candidate when none is left, and restores it at the end
  // exactly as it restores a natural one.
  const manufactured = candidate ? null : await manufactureCandidate(org.id);
  const target = candidate ?? manufactured;

  if (!target) {
    throw new Error(
      "No employee has a supervisor with a login. Run pnpm db:seed to restore the demo accounts.",
    );
  }

  const { day, approverUserId } = target;
  const supervisorId = target.supervisorId!;

  console.log(
    `
Correcting ${target.employeeCode} on ${day.dateBs} (${day.date})` +
      (manufactured ? "  [day prepared for this run]" : ""),
  );
  console.log(
    `  before: in ${day.checkIn ?? "—"}, out ${day.checkOut ?? "—"}, ` +
      `status ${day.status}, worked ${day.workedMinutes}m\n`,
  );

  // ------------------------------------------------------------------ submit
  const request = await submitAttendanceRequest({
    orgId: org.id,
    employeeId: target.employeeId,
    date: day.date,
    requestType: "missing_punch",
    requestedCheckIn: day.checkIn,
    requestedCheckOut: "18:30",
    reason: "Smoke check: reader missed the out punch.",
  });
  check("request created", !!request.id, request.reference);

  const steps = await db
    .select()
    .from(approvalSteps)
    .where(
      and(eq(approvalSteps.entityType, ATTENDANCE_ENTITY), eq(approvalSteps.entityId, request.id)),
    );
  check("approval chain written up front", steps.length === 1, `${steps.length} step(s)`);
  check("routed to the reporting supervisor", steps[0]?.approverEmployeeId === supervisorId);

  let duplicateRefused = false;
  try {
    await submitAttendanceRequest({
      orgId: org.id,
      employeeId: target.employeeId,
      date: day.date,
      requestType: "missing_punch",
      requestedCheckIn: day.checkIn,
      requestedCheckOut: "18:30",
      reason: "Smoke check: duplicate.",
    });
  } catch {
    duplicateRefused = true;
  }
  check("second request for the same day refused", duplicateRefused);

  let strangerRefused = false;
  try {
    await decideAttendanceRequest({
      orgId: org.id,
      requestId: request.id,
      decision: "approved",
      approverEmployeeId: target.employeeId, // the requester, not the approver
      decidedByUserId: approverUserId,
      canApproveAnything: false,
    });
  } catch {
    strangerRefused = true;
  }
  check("approval by somebody it is not routed to refused", strangerRefused);

  // ----------------------------------------------------------------- approve
  const decision = await decideAttendanceRequest({
    orgId: org.id,
    requestId: request.id,
    decision: "approved",
    comment: "Smoke check approval.",
    approverEmployeeId: supervisorId,
    decidedByUserId: approverUserId,
    canApproveAnything: false,
  });
  check("approved by the routed supervisor", decision.finalStatus === "approved");

  const [after] = await db.select().from(attendanceDays).where(eq(attendanceDays.id, day.id));

  console.log(
    `\n  after:  in ${after.checkIn ?? "—"}, out ${after.checkOut ?? "—"}, ` +
      `status ${after.status}, worked ${after.workedMinutes}m, ot ${after.otMinutes}m\n`,
  );

  check("out punch written onto the day", after.checkOut?.startsWith("18:30") ?? false);
  check("day recalculated off missing_punch", after.status !== "missing_punch", after.status);
  check("worked minutes computed", after.workedMinutes > 0, `${after.workedMinutes}m`);
  check("source marked as a correction", after.source === "request");
  check("remark references the request", after.remarks?.includes(request.reference) ?? false);

  // ----------------------------------------------------------------- cleanup
  await db
    .delete(approvalSteps)
    .where(
      and(eq(approvalSteps.entityType, ATTENDANCE_ENTITY), eq(approvalSteps.entityId, request.id)),
    );
  await db.delete(attendanceRequests).where(eq(attendanceRequests.id, request.id));
  await db
    .update(attendanceDays)
    .set({
      checkOut: day.checkOut,
      workedMinutes: day.workedMinutes,
      lateMinutes: day.lateMinutes,
      earlyExitMinutes: day.earlyExitMinutes,
      otMinutes: day.otMinutes,
      status: day.status,
      source: day.source,
      remarks: day.remarks,
    })
    .where(eq(attendanceDays.id, day.id));
  console.log("  restored the day\n");

  console.log(failures === 0 ? "All checks passed.\n" : `${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nSmoke check errored:\n", err);
  process.exit(1);
});
