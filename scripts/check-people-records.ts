/**
 * Personnel records: photographs, documents, reporting lines and confirmations.
 *
 * Four features that all turn on the same two things being right — a date
 * comparison, and who is allowed to see a file — neither of which a page test
 * would exercise honestly. The interesting cases are the boundaries (a document
 * expiring today, probation ending today) and the refusals (a reporting loop, a
 * disguised upload), and they are all reachable here in a few seconds.
 *
 * It writes to the database and cleans up after itself.
 *
 * Run with:  pnpm check:people
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations } from "@/db/schema/core";
import { employees, probationReviews } from "@/db/schema/hr";
import { employeeDocuments, documentKind } from "@/db/schema/selfservice";
import { files } from "@/db/schema/files";
import { addDays, todayInNepal } from "@/lib/bs";
import {
  DOCUMENT_MAX_BYTES,
  dropIfUnreferenced,
  getFile,
  putFile,
  PHOTO_MAX_BYTES,
} from "@/lib/storage";
import {
  EXPIRY_WINDOW_DAYS,
  daysUntilExpiry,
  documentDigest,
  expiryState,
} from "@/modules/people/documents";
import {
  REVIEW_WINDOW_DAYS,
  STATE_RANK,
  daysToProbationEnd,
  probationState,
} from "@/modules/people/confirmation";
import { wouldCreateCycle } from "@/modules/people/reporting";
import { DOCUMENT_KINDS } from "@/app/(app)/hr/documents/kinds";

let failures = 0;

function check(condition: boolean, label: string, detail = "") {
  if (condition) console.log(`  ok   ${label}${detail ? `  — ${detail}` : ""}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

/** A real 1x1 PNG, so the sniffer sees genuine magic bytes rather than a stub. */
const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100" +
    "05fe02fea7000000049454e44ae426082",
  "hex",
);

function asFile(bytes: Buffer, name: string, type: string) {
  return new File([new Uint8Array(bytes)], name, { type });
}

async function main() {
  console.log("\nPersonnel records\n");

  const today = todayInNepal();

  const [org] = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (!org) {
    console.log("  no organisation in the database — run pnpm db:seed first\n");
    process.exit(1);
  }

  /* ------------------------------------------------------ document expiry */

  console.log("Document expiry is decided at the boundary, not near it");

  check(expiryState(null, today) === "none", "no expiry date is not an expiry problem");
  check(expiryState(today, today) === "expiring", "expiring today counts as expiring, not expired");
  check(expiryState(addDays(today, -1), today) === "expired", "yesterday is expired");
  check(
    expiryState(addDays(today, EXPIRY_WINDOW_DAYS), today) === "expiring",
    `the last day of the ${EXPIRY_WINDOW_DAYS}-day window is still inside it`,
  );
  check(
    expiryState(addDays(today, EXPIRY_WINDOW_DAYS + 1), today) === "valid",
    "one day past the window is valid",
  );
  check(daysUntilExpiry(addDays(today, -5), today) === -5, "days go negative once expired");

  /* --------------------------------------------------------- probation */

  console.log("\nProbation states, and the one that would otherwise never surface");

  check(probationState(null, today) === "unscheduled", "no end date is 'unscheduled'");
  check(probationState(today, today) === "due", "ending today is due, not overdue");
  check(probationState(addDays(today, -1), today) === "overdue", "yesterday is overdue");
  check(
    probationState(addDays(today, REVIEW_WINDOW_DAYS), today) === "due",
    `the last day of the ${REVIEW_WINDOW_DAYS}-day window is still due`,
  );
  check(
    probationState(addDays(today, REVIEW_WINDOW_DAYS + 1), today) === "upcoming",
    "beyond the window is upcoming",
  );
  check(daysToProbationEnd(null, today) === null, "no end date has no countdown");

  // The ranking is the whole reason the page is useful: somebody on probation
  // with no end date is the case the legacy system lost people in, so it must
  // not sort to the bottom.
  check(
    STATE_RANK.overdue < STATE_RANK.unscheduled &&
      STATE_RANK.unscheduled < STATE_RANK.due &&
      STATE_RANK.due < STATE_RANK.upcoming,
    "'no end date' sorts above 'due', not below everything",
  );

  /* ------------------------------------------------------- the file store */

  console.log("\nUploads are judged by their bytes, never by what the browser claims");

  const disguised = await putFile({
    orgId: org.id,
    uploadedBy: null,
    // Named and typed as a PNG, but the bytes are HTML. Trusting either would
    // mean serving a stored cross-site scripting payload from our own origin.
    file: asFile(Buffer.from("<html><script>alert(1)</script></html>"), "photo.png", "image/png"),
    maxBytes: PHOTO_MAX_BYTES,
  });
  check(!disguised.ok, "HTML renamed to .png is rejected", disguised.ok ? "" : disguised.error);

  const empty = await putFile({
    orgId: org.id,
    uploadedBy: null,
    file: asFile(Buffer.alloc(0), "nothing.png", "image/png"),
    maxBytes: PHOTO_MAX_BYTES,
  });
  check(!empty.ok, "an empty file is rejected");

  const tooBig = await putFile({
    orgId: org.id,
    uploadedBy: null,
    file: asFile(Buffer.concat([PNG_1X1, Buffer.alloc(2048)]), "big.png", "image/png"),
    maxBytes: 512,
  });
  check(!tooBig.ok, "a file over the limit is rejected", tooBig.ok ? "" : tooBig.error);

  const pdfAsPhoto = await putFile({
    orgId: org.id,
    uploadedBy: null,
    file: asFile(Buffer.from("%PDF-1.7\n trailer"), "scan.pdf", "application/pdf"),
    maxBytes: PHOTO_MAX_BYTES,
    allow: ["image/jpeg", "image/png", "image/webp"],
  });
  check(!pdfAsPhoto.ok, "a PDF is refused where only images are allowed");

  const stored = await putFile({
    orgId: org.id,
    uploadedBy: "check:people",
    file: asFile(PNG_1X1, "portrait.png", "image/png"),
    maxBytes: PHOTO_MAX_BYTES,
  });
  check(stored.ok, "a genuine PNG is stored");
  if (!stored.ok) {
    console.log(`\n${failures} check(s) failed.\n`);
    process.exit(1);
  }

  check(stored.file.contentType === "image/png", "the type comes from the bytes", stored.file.contentType);

  const again = await putFile({
    orgId: org.id,
    uploadedBy: "check:people",
    // Same bytes, different name — the same scan attached twice.
    file: asFile(PNG_1X1, "the-same-picture-again.png", "image/png"),
    maxBytes: DOCUMENT_MAX_BYTES,
  });
  check(
    again.ok && again.file.id === stored.file.id,
    "identical bytes are stored once, not twice",
    again.ok ? again.file.id : "",
  );

  const readBack = await getFile(org.id, stored.file.id);
  check(
    readBack !== null && Buffer.from(readBack.content).equals(PNG_1X1),
    "the bytes come back unchanged",
  );

  // Tenancy: the id is real, the organisation is not the owner.
  const crossTenant = await getFile("00000000-0000-0000-0000-000000000000", stored.file.id);
  check(crossTenant === null, "a file is invisible outside its own organisation");

  /* -------------------------------------- cleanup only when unreferenced */

  console.log("\nA replaced file is deleted only once nothing points at it");

  const [subject] = await db
    .select({ id: employees.id, code: employees.employeeCode })
    .from(employees)
    .where(eq(employees.orgId, org.id))
    .limit(1);

  if (!subject) {
    console.log("  no employees in the database — run pnpm db:seed first\n");
    process.exit(1);
  }

  const [doc] = await db
    .insert(employeeDocuments)
    .values({
      orgId: org.id,
      employeeId: subject.id,
      kind: "other",
      title: "check:people temporary document",
      fileId: stored.file.id,
    })
    .returning({ id: employeeDocuments.id });

  await dropIfUnreferenced(stored.file.id);
  check(
    (await getFile(org.id, stored.file.id)) !== null,
    "a file still attached to a document survives cleanup",
  );

  await db.delete(employeeDocuments).where(eq(employeeDocuments.id, doc.id));
  await dropIfUnreferenced(stored.file.id);
  check(
    (await getFile(org.id, stored.file.id)) === null,
    "the same file is deleted once the last reference goes",
  );

  /* ------------------------------------------------------ reporting lines */

  console.log("\nA reporting loop is refused before it can be created");

  const chain = await db
    .select({ id: employees.id, supervisorId: employees.supervisorId })
    .from(employees)
    .where(and(eq(employees.orgId, org.id), sql`${employees.supervisorId} IS NOT NULL`))
    .limit(1);

  if (chain.length > 0 && chain[0].supervisorId) {
    const subordinate = chain[0].id;
    const supervisor = chain[0].supervisorId;

    check(
      await wouldCreateCycle(supervisor, subordinate),
      "a supervisor cannot be made to report to their own subordinate",
    );
    check(
      !(await wouldCreateCycle(subordinate, supervisor)),
      "the existing, correct direction is not flagged",
    );
    check(await wouldCreateCycle(subordinate, subordinate), "nobody may report to themselves");

    // Two levels up: the guard has to walk the chain, not just check the parent.
    const [grandparent] = await db
      .select({ supervisorId: employees.supervisorId })
      .from(employees)
      .where(eq(employees.id, supervisor))
      .limit(1);

    if (grandparent?.supervisorId) {
      check(
        await wouldCreateCycle(grandparent.supervisorId, subordinate),
        "the walk goes all the way up, not just one level",
      );
    }
  } else {
    console.log("  skip  no reporting chain in the data to test against");
  }

  /* ------------------------------------------------- vocabulary stays in step */

  console.log("\nThe document vocabulary matches the database");

  const enumValues = [...documentKind.enumValues].sort();
  const uiValues = [...DOCUMENT_KINDS].sort();
  check(
    JSON.stringify(enumValues) === JSON.stringify(uiValues),
    "every kind offered in the UI exists in the enum, and the reverse",
    uiValues.join(", "),
  );

  /* ------------------------------------------------------------- digest */

  console.log("\nThe register tiles are counted in the database, over the whole organisation");

  const digest = await documentDigest(org.id, today);
  const [manual] = await db
    .select({
      total: sql<number>`count(*)::int`,
      expired: sql<number>`count(*) FILTER (WHERE ${employeeDocuments.expiresOn} < ${today})::int`,
    })
    .from(employeeDocuments)
    .where(eq(employeeDocuments.orgId, org.id));

  check(digest.total === manual.total, "the total matches a direct count", `${digest.total}`);
  check(digest.expired === manual.expired, "the expired count matches", `${digest.expired}`);

  /* ------------------------------------------ probation reviews are a ledger */

  console.log("\nA probation decision is recorded, not just applied");

  const reviewed = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(probationReviews)
    .where(eq(probationReviews.orgId, org.id));

  const orphaned = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(probationReviews)
    .leftJoin(employees, eq(employees.id, probationReviews.employeeId))
    .where(and(eq(probationReviews.orgId, org.id), sql`${employees.id} IS NULL`));

  check(orphaned[0].n === 0, "every recorded decision still points at an employee", `${reviewed[0].n} on file`);

  /* --------------------------------------------------------------- cleanup */

  await db
    .delete(employeeDocuments)
    .where(
      and(
        eq(employeeDocuments.orgId, org.id),
        eq(employeeDocuments.title, "check:people temporary document"),
      ),
    );
  await db.delete(files).where(and(eq(files.orgId, org.id), eq(files.uploadedBy, "check:people")));
  console.log("\n  cleaned up the test file and document");

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
