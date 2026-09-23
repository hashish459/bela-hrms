/**
 * The device pipeline, asserted end to end.
 *
 * Three things here are not testable by clicking around, and all three are the
 * kind that fail quietly months later:
 *
 *   - **A sync must never overwrite a day somebody decided.** An approved
 *     regularisation reverted overnight by a machine is the worst bug this
 *     module could have: the employee's claim was accepted, the manager signed
 *     it, and the old times came back while everyone was asleep.
 *   - **Re-sending the same readings must not double-count.** Every reader
 *     re-sends overlapping windows; the legacy system deduplicated in a stored
 *     procedure that the next importer would have had to remember to copy.
 *   - **A night shift's out-punch belongs to the previous day.** Get this wrong
 *     and both days show a missing punch.
 *
 * It writes to the database and cleans up after itself.
 *
 * Run with:  pnpm check:devices
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations } from "@/db/schema/core";
import { employees } from "@/db/schema/hr";
import { attendanceDays } from "@/db/schema/attendance";
import {
  attendanceDevices,
  deviceEnrolments,
  devicePunches,
  deviceKind,
  deviceConnection,
  deviceDirection,
  deviceStatus,
} from "@/db/schema/devices";
import { addDays, todayInNepal } from "@/lib/bs";
import type { ShiftRule } from "@/lib/attendance";
import {
  applyPunches,
  attendanceDateFor,
  deriveInOut,
  deviceHealth,
  ingestPunches,
  resolveUnmatched,
} from "@/modules/attendance/devices";
import {
  CONNECTIONS,
  DEVICE_KINDS,
  DEVICE_STATUSES,
  DIRECTIONS,
} from "@/app/(app)/attendance/devices/options";

let failures = 0;

function check(condition: boolean, label: string, detail = "") {
  if (condition) console.log(`  ok   ${label}${detail ? `  — ${detail}` : ""}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

const TEST_CODE = "CHECK-DEV";

function at(dateIso: string, time: string): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [hh, mm, ss] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, ss ?? 0);
}

async function cleanup(orgId: string) {
  const devices = await db
    .select({ id: attendanceDevices.id })
    .from(attendanceDevices)
    .where(and(eq(attendanceDevices.orgId, orgId), eq(attendanceDevices.code, TEST_CODE)));

  if (devices.length) {
    await db.delete(attendanceDevices).where(
      inArray(
        attendanceDevices.id,
        devices.map((d) => d.id),
      ),
    );
  }
}

async function main() {
  console.log("\nAttendance devices\n");

  const [org] = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (!org) {
    console.log("  no organisation — run pnpm db:seed first\n");
    process.exit(1);
  }

  await cleanup(org.id);

  /* ------------------------------------------------------------- vocabulary */

  console.log("The UI vocabulary matches the database");

  for (const [name, ui, enumValues] of [
    ["kinds", DEVICE_KINDS, deviceKind.enumValues],
    ["connections", CONNECTIONS, deviceConnection.enumValues],
    ["directions", DIRECTIONS, deviceDirection.enumValues],
    ["statuses", DEVICE_STATUSES, deviceStatus.enumValues],
  ] as const) {
    check(
      JSON.stringify([...ui].sort()) === JSON.stringify([...enumValues].sort()),
      `${name} offered in the UI all exist in the enum, and the reverse`,
    );
  }

  /* ----------------------------------------------------------------- health */

  console.log("\nHealth is derived from the last contact, not stored");

  const base = { status: "active", syncIntervalMinutes: 15 };
  const now = new Date("2026-09-20T12:00:00");
  const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);

  check(deviceHealth({ ...base, lastSeenAt: null }, now) === "never", "no contact ever");
  check(deviceHealth({ ...base, lastSeenAt: minutesAgo(5) }, now) === "healthy", "inside one cycle");
  check(
    deviceHealth({ ...base, lastSeenAt: minutesAgo(30) }, now) === "healthy",
    "exactly two cycles is still healthy",
  );
  check(
    deviceHealth({ ...base, lastSeenAt: minutesAgo(31) }, now) === "stale",
    "past two cycles is late",
  );
  check(
    deviceHealth({ ...base, lastSeenAt: minutesAgo(90) }, now) === "stale",
    "exactly six cycles is still only late",
  );
  check(
    deviceHealth({ ...base, lastSeenAt: minutesAgo(91) }, now) === "silent",
    "past six cycles is silent",
  );
  check(
    deviceHealth({ status: "inactive", syncIntervalMinutes: 15, lastSeenAt: minutesAgo(5) }, now) ===
      "disabled",
    "a withdrawn device is not judged on its silence",
  );

  /* ------------------------------------------------- night shift attribution */

  console.log("\nA night shift's out-punch belongs to the day it started");

  const night: ShiftRule = {
    id: "n",
    code: "NIGHT",
    name: "Night",
    colour: "#000",
    startTime: "21:00",
    endTime: "06:00",
    breakMinutes: 0,
    graceInMinutes: 10,
    graceOutMinutes: 15,
    fullDayMinutes: 480,
    halfDayMinutes: 240,
    isNightShift: true,
    otAfterMinutes: 30,
  };
  const dayShift: ShiftRule = { ...night, isNightShift: false, startTime: "09:00", endTime: "17:00" };

  check(
    attendanceDateFor(at("2026-09-20", "21:05:00"), night) === "2026-09-20",
    "the in-punch keeps its own date",
  );
  check(
    attendanceDateFor(at("2026-09-21", "06:10:00"), night) === "2026-09-20",
    "the out-punch the next morning belongs to the previous day",
  );
  check(
    attendanceDateFor(at("2026-09-21", "06:16:00"), night) === "2026-09-21",
    "past the end plus grace it is a new day",
  );
  check(
    attendanceDateFor(at("2026-09-21", "06:10:00"), dayShift) === "2026-09-21",
    "a day shift is never re-attributed",
  );
  check(
    attendanceDateFor(at("2026-09-21", "06:10:00"), null) === "2026-09-21",
    "no shift means no re-attribution",
  );

  /* ------------------------------------------------------------- in and out */

  console.log("\nMany punches a day become one arrival and one departure");

  const d = "2026-09-20";
  check(
    JSON.stringify(
      deriveInOut([
        { punchedAt: at(d, "09:02:00"), direction: "unknown" },
        { punchedAt: at(d, "13:00:00"), direction: "unknown" },
        { punchedAt: at(d, "13:45:00"), direction: "unknown" },
        { punchedAt: at(d, "17:30:00"), direction: "unknown" },
      ]),
    ) === JSON.stringify({ checkIn: "09:02", checkOut: "17:30" }),
    "the lunch punches in the middle are not an early exit",
  );

  check(
    JSON.stringify(deriveInOut([{ punchedAt: at(d, "09:02:00"), direction: "unknown" }])) ===
      JSON.stringify({ checkIn: "09:02", checkOut: null }),
    "one reading is an arrival with no departure, not a zero-length day",
  );

  check(
    JSON.stringify(
      deriveInOut([
        { punchedAt: at(d, "08:40:00"), direction: "out" },
        { punchedAt: at(d, "09:02:00"), direction: "in" },
        { punchedAt: at(d, "17:30:00"), direction: "out" },
      ]),
    ) === JSON.stringify({ checkIn: "09:02", checkOut: "17:30" }),
    "a known direction beats position: the stray early out is not the arrival",
  );

  check(
    JSON.stringify(deriveInOut([])) === JSON.stringify({ checkIn: null, checkOut: null }),
    "no punches, no times",
  );

  /* ------------------------------------------------------------ the database */

  const [employee] = await db
    .select({ id: employees.id, code: employees.employeeCode })
    .from(employees)
    .where(eq(employees.orgId, org.id))
    .limit(1);

  if (!employee) {
    console.log("  no employees — run pnpm db:seed first\n");
    process.exit(1);
  }

  const [device] = await db
    .insert(attendanceDevices)
    .values({
      orgId: org.id,
      code: TEST_CODE,
      name: "check:devices fixture",
      kind: "fingerprint",
      connection: "cloud_api",
      direction: "alternating",
      status: "active",
      syncIntervalMinutes: 15,
    })
    .returning();

  /*
   * A date well outside anything the seeds generate.
   *
   * The first version of this used today − 400 days and silently failed: that
   * lands inside the closed previous fiscal year, whose days are locked, so the
   * fold was correctly refusing to write and the assertions were measuring the
   * wrong thing. The row is deleted first regardless, so the test starts from a
   * state it controls rather than one it hopes for.
   */
  const testDate = addDays(todayInNepal(), -1500);

  await db
    .delete(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, testDate)));

  console.log("\nIngestion is idempotent, because the constraint says so");

  const reading = { enrollNumber: "7", punchedAt: at(testDate, "09:05:00") };

  const first = await ingestPunches(device, [reading]);
  check(first.stored === 1, "a new reading is stored", `stored ${first.stored}`);
  check(first.unmatched === 1, "with nobody enrolled it is unmatched, not discarded");

  const replay = await ingestPunches(device, [reading, reading]);
  check(
    replay.stored === 0 && replay.duplicates === 2,
    "the identical reading, sent twice more, is stored zero times",
    `duplicates ${replay.duplicates}`,
  );

  const [storedCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(devicePunches)
    .where(and(eq(devicePunches.deviceId, device.id), eq(devicePunches.enrollNumber, "7")));
  check(storedCount.n === 1, "one row on file for one real reading", `${storedCount.n} row(s)`);

  /* -------------------------------------------- enrolment rescues the past */

  console.log("\nEnrolling somebody claims the punches already on file");

  const [unmatchedBefore] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(devicePunches)
    .where(and(eq(devicePunches.deviceId, device.id), eq(devicePunches.status, "unmatched")));
  check(unmatchedBefore.n === 1, "the reading is waiting, unmatched");

  await db.insert(deviceEnrolments).values({
    orgId: org.id,
    deviceId: device.id,
    employeeId: employee.id,
    enrollNumber: "7",
  });

  const rescued = await resolveUnmatched(org.id, device.id);
  check(rescued === 1, "the earlier reading is matched retrospectively", `${rescued} rescued`);

  const [afterResolve] = await db
    .select({ employeeId: devicePunches.employeeId, status: devicePunches.status })
    .from(devicePunches)
    .where(and(eq(devicePunches.deviceId, device.id), eq(devicePunches.enrollNumber, "7")))
    .limit(1);
  check(
    afterResolve.employeeId === employee.id && afterResolve.status === "pending",
    "and it now points at the right person, ready to apply",
  );

  /* ----------------------------------------------------------- folding a day */

  console.log("\nPunches become an attendance day");

  await ingestPunches(device, [
    { enrollNumber: "7", punchedAt: at(testDate, "17:40:00") },
  ]);

  const [before] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, testDate)));
  check(before.n === 0, "no attendance row exists for that date yet");

  const applied = await applyPunches(org.id, { deviceId: device.id });
  check(applied.daysWritten === 1, "one day written", `${applied.daysWritten}`);

  const [written] = await db
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, testDate)))
    .limit(1);

  check(Boolean(written), "the attendance row exists");
  check(written?.checkIn?.slice(0, 5) === "09:05", "check-in is the earliest reading", written?.checkIn ?? "");
  check(written?.checkOut?.slice(0, 5) === "17:40", "check-out is the latest", written?.checkOut ?? "");
  check(written?.source === "device", "and it is marked as coming from a device", written?.source);

  const [punchesAfter] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(devicePunches)
    .where(and(eq(devicePunches.deviceId, device.id), eq(devicePunches.status, "applied")));
  check(punchesAfter.n === 2, "both readings are marked applied", `${punchesAfter.n}`);

  /* ------------------------------ the rule that matters: do not overwrite */

  console.log("\nA sync never overwrites a day somebody decided");

  for (const [source, label] of [
    ["request", "an approved regularisation"],
    ["manual", "a correction made by hand"],
  ] as const) {
    await db
      .update(attendanceDays)
      .set({ source, checkIn: "10:00:00", checkOut: "16:00:00" })
      .where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, testDate)));

    // A fresh reading arrives for that same day, as a reader re-sending would.
    await ingestPunches(device, [
      { enrollNumber: "7", punchedAt: at(testDate, "08:15:00") },
    ]);
    await db
      .update(devicePunches)
      .set({ status: "pending", note: null })
      .where(and(eq(devicePunches.deviceId, device.id), eq(devicePunches.status, "applied")));

    const result = await applyPunches(org.id, { deviceId: device.id });

    const [after] = await db
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, testDate)))
      .limit(1);

    check(
      after.checkIn === "10:00:00" && after.checkOut === "16:00:00" && after.source === source,
      `${label} survives the sync untouched`,
      `${after.checkIn}–${after.checkOut} (${after.source})`,
    );
    check(result.daysSkipped === 1, `and the sync reports it as left alone`);

    const [skippedPunches] = await db
      .select({ n: sql<number>`count(*)::int`, note: sql<string>`max(${devicePunches.note})` })
      .from(devicePunches)
      .where(and(eq(devicePunches.deviceId, device.id), eq(devicePunches.status, "skipped")));
    check(
      skippedPunches.n > 0 && Boolean(skippedPunches.note),
      "the punches are kept with a reason rather than discarded",
      skippedPunches.note ?? "",
    );

    await db
      .update(devicePunches)
      .set({ status: "pending", note: null })
      .where(eq(devicePunches.deviceId, device.id));
  }

  // And the same for a locked period, which is payroll's guarantee.
  await db
    .update(attendanceDays)
    .set({ source: "device", isLocked: true, checkIn: "11:11:00", checkOut: "15:15:00" })
    .where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, testDate)));

  const lockedResult = await applyPunches(org.id, { deviceId: device.id });

  const [locked] = await db
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, testDate)))
    .limit(1);

  check(
    locked.checkIn === "11:11:00" && lockedResult.daysSkipped === 1,
    "a locked day is not rewritten either",
    `${locked.checkIn} (locked ${locked.isLocked})`,
  );

  /* --------------------------------------------------------------- cleanup */

  await db
    .delete(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, testDate)));
  await cleanup(org.id);
  console.log("\n  cleaned up the fixture device, its punches and the test day");

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
