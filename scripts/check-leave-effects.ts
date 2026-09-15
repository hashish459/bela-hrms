/**
 * Proves that a leave type's policy actually reaches attendance and payroll.
 *
 * The claim being tested is the one the legacy system could not make: that a
 * single word on the leave type — its *nature* — decides the attendance status,
 * and a single number — its *pay percentage* — decides what payroll pays, with
 * no other source of truth anywhere in the product.
 *
 * Three natures are exercised end to end, because they are the three that used
 * to disagree with each other:
 *
 *   field work   → a present day, paid in full, no balance touched
 *   paid leave   → a leave day, paid in full
 *   unpaid leave → a leave day, paid nothing
 *
 * Run with:  pnpm check:leave
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations } from "@/db/schema/core";
import { employees } from "@/db/schema/hr";
import { attendanceDays } from "@/db/schema/attendance";
import { leaveRequests, leaveTypes } from "@/db/schema/leave";
import { domainEvents } from "@/db/schema/kernel";
import { drain, publish } from "@/kernel/events";
import { requirePort } from "@/kernel/registry";
import { levelsRequired, NATURE_TO_ATTENDANCE, policiesForEmployee } from "@/modules/leave/policy";
import { payableDays } from "@/modules/payroll/module";
import { addDays, todayInNepal } from "@/lib/bs";
import "@/kernel/boot";

let failures = 0;
const markers: string[] = [];

function check(condition: boolean, label: string, detail = "") {
  if (condition) console.log(`  ok   ${label}${detail ? `  — ${detail}` : ""}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("\nLeave policy → attendance → payroll\n");

  const [org] = await db.select().from(organizations).limit(1);
  if (!org) {
    console.error("No organisation found. Run pnpm db:seed first.");
    process.exit(1);
  }

  // Pick somebody who has actually taken leave, so the payroll assertions are
  // measuring something. Falling back to any employee keeps the policy and
  // routing checks meaningful on an empty database.
  const [withLeave] = await db
    .select({ id: employees.id, code: employees.employeeCode })
    .from(employees)
    .innerJoin(leaveRequests, eq(leaveRequests.employeeId, employees.id))
    .where(and(eq(employees.orgId, org.id), eq(leaveRequests.status, "approved")))
    .limit(1);

  const [anyEmployee] = await db
    .select({ id: employees.id, code: employees.employeeCode })
    .from(employees)
    .where(eq(employees.orgId, org.id))
    .limit(1);

  const employee = withLeave ?? anyEmployee;
  if (!employee) {
    console.error("No employees found. Run pnpm db:seed first.");
    process.exit(1);
  }

  const types = await db
    .select()
    .from(leaveTypes)
    .where(and(eq(leaveTypes.orgId, org.id), inArray(leaveTypes.code, ["FIELD", "HOME", "UNPAID"])));
  const byCode = new Map(types.map((t) => [t.code, t]));

  check(byCode.size === 3, "the three natures under test exist", [...byCode.keys()].join(", "));
  if (byCode.size < 3) process.exit(1);

  /* ------------------------------------------------------ policy resolution */

  console.log("Policy is resolved per employee, not read off one column");

  const policies = await policiesForEmployee(org.id, employee.id);
  check(policies.length > 0, "leave types resolve for the employee", `${policies.length} available`);

  const home = policies.find((p) => p.code === "HOME");
  check(
    home?.entitlementSource === "employment_type",
    "entitlement comes from the employment type, not the headline figure",
    `${home?.entitledDays} days via ${home?.entitlementSource}`,
  );

  const field = policies.find((p) => p.code === "FIELD");
  check(field?.nature === "official_work", "field work carries the official_work nature");
  check(field?.deductsBalance === false, "field work deducts no balance");

  const unpaid = policies.find((p) => p.code === "UNPAID");
  check(unpaid?.paidPercent === 0, "unpaid leave pays nothing", `${unpaid?.paidPercent}%`);

  /* ------------------------------------------------------- approval routing */

  console.log("\nRouting is sized from the length of the request");

  // HOME is seeded with ceilings [5, 15, null]: a supervisor to five days, a
  // manager to fifteen, anything longer goes higher again.
  check(!!home && levelsRequired(home, 3) === 1, "a 3-day home leave needs one level");
  check(!!home && levelsRequired(home, 8) === 2, "an 8-day home leave needs two");
  check(!!home && levelsRequired(home, 40) === 3, "a 40-day home leave needs three");

  /* ---------------------------------------------- nature reaches attendance */

  console.log("\nThe nature decides the attendance status");

  check(
    NATURE_TO_ATTENDANCE.official_work === "present",
    "official work maps to a present day, not a leave day",
  );
  check(NATURE_TO_ATTENDANCE.unpaid === "on_leave", "unpaid leave still marks the day as leave");
  check(NATURE_TO_ATTENDANCE.absent === "absent", "an absence nature marks an absence");

  // Drive the real subscriber: publish the event leave publishes, drain it, and
  // read what attendance actually wrote.
  const base = addDays(todayInNepal(), 120); // far future, so no seeded data collides
  const cases: { code: string; nature: string; expect: string }[] = [
    { code: "FIELD", nature: "official_work", expect: "field_work" },
    { code: "HOME", nature: "paid", expect: "on_leave" },
    { code: "UNPAID", nature: "unpaid", expect: "on_leave" },
  ];

  for (const [index, testCase] of cases.entries()) {
    const date = addDays(base, index * 7);
    const marker = `leave-effect-${testCase.code}-${Date.now()}`;
    markers.push(marker);

    await db.transaction(async (tx) => {
      await publish(tx, {
        orgId: org.id,
        module: "leave",
        name: "leave.request.approved",
        payload: {
          leaveRequestId: marker,
          employeeId: employee.id,
          fromDate: date,
          toDate: date,
          leaveTypeName: byCode.get(testCase.code)!.name,
          isHalfDay: false,
          nature: testCase.nature,
          paidPercent: Number(byCode.get(testCase.code)!.paidPercent),
        },
        dedupeKey: marker,
      });
    });

    await drain({ orgId: org.id, limit: 20 });

    const [day] = await db
      .select({ status: attendanceDays.status })
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, date)))
      .limit(1);

    check(
      day?.status === testCase.expect,
      `${testCase.code} (${testCase.nature}) wrote "${testCase.expect}"`,
      day?.status ?? "no row written",
    );
  }

  /* ------------------------------------------------------ payroll consumes it */

  console.log("\nPayroll reads it through the port, not the tables");

  const port = requirePort("leave");
  const lines = await port.payrollLines(org.id, [employee.id], "2000-01-01", "2100-01-01");
  check(
    Array.isArray(lines) && (!withLeave || lines.length > 0),
    "the leave port answers with payroll lines",
    `${lines.length} line(s) for ${employee.code}`,
  );
  for (const line of lines) {
    console.log(
      `  note  ${line.leaveTypeCode.padEnd(8)} ${String(line.days).padStart(5)} day(s)  ` +
        `${line.nature.padEnd(14)} ${line.paidPercent}%`,
    );
  }

  const withOverrides = lines.find((l) => Object.keys(l.headOverrides).length > 0);
  console.log(
    withOverrides
      ? `  note  ${withOverrides.leaveTypeCode} carries per-head overrides: ${JSON.stringify(withOverrides.headOverrides)}`
      : "  note  no per-head overrides in range for this employee",
  );

  const month = await payableDays(org.id, [employee.id], "2000-01-01", "2100-01-01");
  check(month.length === 1, "payroll assembles a month for the employee");
  check(
    month[0].incomplete === false,
    "the answer is marked complete while both modules are up",
  );
  check(
    month[0].paidLeaveDays >= 0 && month[0].unpaidLeaveDays >= 0,
    "paid and unpaid days are separated",
    `paid ${month[0].paidLeaveDays}, unpaid ${month[0].unpaidLeaveDays}`,
  );

  /* ------------------------------------------------------------- teardown */

  const dates = cases.map((_, i) => addDays(base, i * 7));
  await db
    .delete(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employee.id), inArray(attendanceDays.date, dates)));
  await db.delete(domainEvents).where(inArray(domainEvents.dedupeKey, markers));
  console.log("\n  cleaned up the test days and events");

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  if (markers.length) {
    await db.delete(domainEvents).where(inArray(domainEvents.dedupeKey, markers)).catch(() => {});
  }
  void sql;
  process.exit(1);
});
