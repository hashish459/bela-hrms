/**
 * Proves the organisation structure rules the legacy system did not have.
 *
 * The failure being guarded against is specific: Nimble.Ananta stored
 * `UnderGroup = 0` for a root, enforced no foreign key, and validated nothing
 * about which kind could parent which. A business unit could end up under a
 * project, and the structure report then recursed until it timed out.
 *
 * Run with:  pnpm check:org
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations } from "@/db/schema/core";
import { orgUnits } from "@/db/schema/org-structure";
import { domainEvents } from "@/db/schema/kernel";
import {
  StructureError,
  ancestryOf,
  createUnit,
  deactivateUnit,
  listUnits,
  updateUnit,
} from "@/modules/org/structure";
import "@/kernel/boot";

let failures = 0;
const created: string[] = [];

function check(condition: boolean, label: string, detail = "") {
  if (condition) console.log(`  ok   ${label}${detail ? `  — ${detail}` : ""}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

/** Runs something that should be refused, and reports the refusal message. */
async function refuses(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(false, label, "it was allowed");
  } catch (error) {
    check(
      error instanceof StructureError,
      label,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function main() {
  console.log("\nOrganisation structure\n");

  const [org] = await db.select().from(organizations).limit(1);
  if (!org) {
    console.error("No organisation found. Run pnpm db:seed first.");
    process.exit(1);
  }

  const stamp = Date.now().toString().slice(-6);

  console.log("The hierarchy holds");

  const division = await createUnit({
    orgId: org.id,
    kind: "division",
    code: `CHK-DIV-${stamp}`,
    name: "Noodles Factory (check)",
  });
  created.push(division.id);
  check(true, "a division can be created as a root");

  const unit = await createUnit({
    orgId: org.id,
    kind: "business_unit",
    code: `CHK-BU-${stamp}`,
    name: "Wai Wai (check)",
    parentId: division.id,
  });
  created.push(unit.id);
  check(true, "a business unit can sit under a division");

  const sub = await createUnit({
    orgId: org.id,
    kind: "sub_business_unit",
    code: `CHK-SBU-${stamp}`,
    name: "Wai Wai Quick (check)",
    parentId: unit.id,
  });
  created.push(sub.id);
  check(true, "a sub business unit can sit under a business unit");

  console.log("\nThe hierarchy cannot be broken");

  await refuses("a business unit cannot be a root", () =>
    createUnit({ orgId: org.id, kind: "business_unit", code: `CHK-X1-${stamp}`, name: "Orphan" }),
  );

  await refuses("a business unit cannot sit under a sub business unit", () =>
    createUnit({
      orgId: org.id,
      kind: "business_unit",
      code: `CHK-X2-${stamp}`,
      name: "Inverted",
      parentId: sub.id,
    }),
  );

  await refuses("a division cannot be given a parent", () =>
    createUnit({
      orgId: org.id,
      kind: "division",
      code: `CHK-X3-${stamp}`,
      name: "Nested division",
      parentId: division.id,
    }),
  );

  await refuses("a unit cannot be made its own parent", () =>
    updateUnit(unit.id, {
      orgId: org.id,
      kind: "business_unit",
      code: `CHK-BU-${stamp}`,
      name: "Wai Wai (check)",
      parentId: unit.id,
    }),
  );

  await refuses("a parent cannot be moved inside its own child", () =>
    updateUnit(unit.id, {
      orgId: org.id,
      kind: "business_unit",
      code: `CHK-BU-${stamp}`,
      name: "Wai Wai (check)",
      parentId: sub.id,
    }),
  );

  await refuses("a unit with active children cannot be deactivated", () =>
    deactivateUnit(org.id, unit.id),
  );

  console.log("\nReading it back");

  const ancestry = await ancestryOf(org.id, sub.id);
  check(
    ancestry.length === 3 && ancestry[0].id === sub.id && ancestry[2].id === division.id,
    "ancestry walks child to root",
    ancestry.map((a) => a.code).join(" → "),
  );

  const divisions = await listUnits(org.id, "division");
  check(
    divisions.some((d) => d.id === division.id),
    "the generic list returns the right kind",
    `${divisions.length} division(s)`,
  );

  const branches = await listUnits(org.id, "branch");
  check(
    branches.every((b) => b.kind === "branch"),
    "branches come from their own table through the same signature",
    `${branches.length} branch(es)`,
  );

  const events = await db
    .select({ name: domainEvents.name })
    .from(domainEvents)
    .where(and(eq(domainEvents.orgId, org.id), eq(domainEvents.name, "org.structure.changed")));
  check(events.length >= 3, "each change published a structure event", `${events.length} event(s)`);

  /* ------------------------------------------------------------- teardown */

  await db.delete(orgUnits).where(inArray(orgUnits.id, [sub.id, unit.id, division.id]));
  await db
    .delete(domainEvents)
    .where(and(eq(domainEvents.orgId, org.id), eq(domainEvents.name, "org.structure.changed")));
  console.log("\n  cleaned up the test units");

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  if (created.length) await db.delete(orgUnits).where(inArray(orgUnits.id, created));
  process.exit(1);
});
