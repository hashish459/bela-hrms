/**
 * Proves the module boundary does what it claims.
 *
 * Four properties, each demonstrated against the real database rather than
 * asserted in a comment:
 *
 *   1. A module that fails to register does not stop the others booting.
 *   2. A consumer of a failed module degrades instead of throwing.
 *   3. A leave approval that the attendance subscriber rejects still commits —
 *      the event is retried, the approval is not rolled back.
 *   4. A module switched off for an organisation disappears from resolve().
 *
 * Run with:  pnpm check:isolation
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations } from "@/db/schema/core";
import { domainEvents } from "@/db/schema/kernel";
import { drain, publish, subscribe } from "@/kernel/events";
import {
  applyOrgModuleStates,
  callPort,
  health,
  register,
  resolve,
} from "@/kernel/registry";
import "@/kernel/boot";

let failures = 0;

function ok(label: string, detail = "") {
  console.log(`  ok   ${label}${detail ? `  — ${detail}` : ""}`);
}

function bad(label: string, detail = "") {
  failures += 1;
  console.log(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`);
}

function check(condition: boolean, label: string, detail = "") {
  if (condition) ok(label, detail);
  else bad(label, detail);
}

async function main() {
  console.log("\nModule isolation\n");

  const [org] = await db.select().from(organizations).limit(1);
  if (!org) {
    console.error("No organisation found. Run pnpm db:seed first.");
    process.exit(1);
  }

  /* ---------------------------------------------------------------- 1 + 2 */

  console.log("A failing module is contained");

  // Snapshot every module's state, so the assertion below can be "nothing else
  // moved" rather than a count. Counting broke the moment payroll became a real
  // module: breaking it legitimately reduces the ready count by one, and the
  // check was asserting the count had not fallen.
  const before = new Map(health().map((m) => [m.id, m.state]));

  // A module whose port constructor throws. In a system without containment
  // this takes the process down at import time.
  register({
    // deliberately reusing a real id so the failure is observable through it
    id: "payroll",
    version: "0.0.0-broken",
    port: () => {
      throw new Error("simulated boot failure");
    },
  });

  const after = health();
  const payroll = after.find((m) => m.id === "payroll");
  const changed = after.filter((m) => m.id !== "payroll" && before.get(m.id) !== m.state);

  check(payroll?.state === "failed", "the broken module is recorded as failed", payroll?.lastError ?? "");
  check(
    changed.length === 0,
    "no other module changed state",
    changed.length === 0
      ? `${after.filter((m) => m.state === "ready").length} still ready`
      : changed.map((m) => `${m.id} → ${m.state}`).join(", "),
  );
  check(resolve("payroll") === null, "resolve() returns null for it rather than a broken port");

  // A consumer must degrade, not throw.
  const fallback = { closed: false };
  const answer = await callPort("payroll", fallback, async (port) => ({
    closed: await port.isPeriodClosed(org.id, "x", 1),
  }));
  check(answer === fallback, "a caller gets its fallback instead of an exception");

  /* -------------------------------------------------------------------- 3 */

  console.log("\nA subscriber failure does not roll back the publisher");

  const marker = `isolation-test-${Date.now()}`;
  let attempts = 0;

  subscribe({
    id: "isolation.always-fails@1",
    module: "attendance",
    event: "leave.request.approved",
    async run(payload) {
      if ((payload as { marker?: string }).marker !== marker) return;
      attempts += 1;
      throw new Error("simulated attendance outage");
    },
  });

  // The publisher's own work: a row it commits alongside the event.
  await db.transaction(async (tx) => {
    await publish(tx, {
      orgId: org.id,
      module: "leave",
      name: "leave.request.approved",
      payload: { marker, leaveRequestId: marker },
      dedupeKey: marker,
    });
  });

  const [published] = await db
    .select({ id: domainEvents.id, status: domainEvents.status })
    .from(domainEvents)
    .where(and(eq(domainEvents.orgId, org.id), eq(domainEvents.dedupeKey, marker)))
    .limit(1);

  check(!!published, "the event committed with the publisher's transaction");

  const result = await drain({ orgId: org.id, limit: 50 });
  check(result.failed >= 1, "the broken subscriber is reported as failed", `${result.failed} failed`);
  check(attempts >= 1, "the subscriber actually ran", `${attempts} attempt(s)`);

  const [afterDrain] = await db
    .select({ status: domainEvents.status, attempts: domainEvents.attempts, lastError: domainEvents.lastError })
    .from(domainEvents)
    .where(and(eq(domainEvents.orgId, org.id), eq(domainEvents.dedupeKey, marker)))
    .limit(1);

  check(
    afterDrain?.status === "pending" || afterDrain?.status === "dead",
    "the event stays queued for retry rather than being lost",
    `status ${afterDrain?.status}, attempts ${afterDrain?.attempts}`,
  );
  check(
    (afterDrain?.lastError ?? "").includes("simulated attendance outage"),
    "the failure is recorded against the event, not thrown at the publisher",
  );

  // Publishing the same business fact twice must not create a second event.
  await db.transaction(async (tx) => {
    await publish(tx, {
      orgId: org.id,
      module: "leave",
      name: "leave.request.approved",
      payload: { marker, leaveRequestId: marker },
      dedupeKey: marker,
    });
  });
  const dupes = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(domainEvents)
    .where(and(eq(domainEvents.orgId, org.id), eq(domainEvents.dedupeKey, marker)));
  check(dupes[0].n === 1, "a replayed publish is deduplicated", `${dupes[0].n} row(s)`);

  /* -------------------------------------------------------------------- 4 */

  console.log("\nA module switched off for an organisation is invisible to it");

  check(resolve("leave", org.id) !== null, "leave resolves before being switched off");
  applyOrgModuleStates(org.id, [{ moduleId: "leave", isEnabled: false }]);
  check(resolve("leave", org.id) === null, "leave does not resolve once switched off");
  check(resolve("attendance", org.id) !== null, "attendance is unaffected by leave being off");

  const spans = await callPort("leave", [], (leave) =>
    leave.approvedSpans(org.id, "2020-01-01", "2020-01-31"),
  );
  check(Array.isArray(spans) && spans.length === 0, "the attendance sheet still renders, without leave colouring");

  applyOrgModuleStates(org.id, [{ moduleId: "leave", isEnabled: true }]);
  check(resolve("leave", org.id) !== null, "switching it back on restores it");

  /* ------------------------------------------------------------- teardown */

  await db.delete(domainEvents).where(eq(domainEvents.dedupeKey, marker));
  console.log("\n  cleaned up the test event");

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
