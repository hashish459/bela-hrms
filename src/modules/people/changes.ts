import "server-only";

import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, profileChangeRequests } from "@/db/schema/hr";
import { employeeExperience, employeeFamily, employeeQualifications } from "@/db/schema/selfservice";
import { departments } from "@/db/schema/org";
import { publish } from "@/kernel/events";
import { cacheTags, invalidate } from "@/kernel/cache";
import { SECTION_BY_KEY, type ProposedValues, type SectionKey } from "./profile-fields";
import { RecordError, removeRow, saveRow, type RowSection } from "./records";

/**
 * Self-service corrections: an employee proposes, HR disposes.
 *
 * The employee id always comes from the caller's session (see the self-service
 * guard), never from the form. For a row section the target row is checked to
 * belong to that same employee before it is snapshotted, so nobody can ask to
 * "correct" somebody else's nominee.
 */

export type ChangeAction = "update" | "add" | "remove";

const ROW_TABLE = {
  family: employeeFamily,
  qualification: employeeQualifications,
  experience: employeeExperience,
} as const;

function isRowSection(key: SectionKey): key is RowSection {
  return key === "family" || key === "qualification" || key === "experience";
}

/** What is on file now for a section, keyed like the section's fields. */
async function snapshot(employeeId: string, section: SectionKey, targetId: string | null): Promise<ProposedValues | null> {
  const def = SECTION_BY_KEY.get(section)!;
  if (isRowSection(section)) {
    if (!targetId) return null;
    const table = ROW_TABLE[section] as typeof employeeExperience;
    const [row] = await db
      .select()
      .from(table)
      .where(and(eq(table.id, targetId), eq(table.employeeId, employeeId), isNull(table.deletedAt)))
      .limit(1);
    if (!row) throw new RecordError("That entry is not on your record.");
    return Object.fromEntries(def.fields.map((f) => [f.name, ((row as Record<string, unknown>)[f.name] ?? null) as ProposedValues[string]]));
  }
  const [emp] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!emp) return null;
  return Object.fromEntries(def.fields.map((f) => [f.name, ((emp as Record<string, unknown>)[f.name] ?? null) as ProposedValues[string]]));
}

export async function submitChange(input: {
  orgId: string;
  employeeId: string;
  section: SectionKey;
  action: ChangeAction;
  targetId: string | null;
  proposed: ProposedValues;
  note: string | null;
}) {
  if (!SECTION_BY_KEY.has(input.section)) throw new RecordError("Unknown section.");
  if (!isRowSection(input.section) && input.action !== "update") throw new RecordError("That section can only be updated.");
  if (isRowSection(input.section) && input.action !== "add" && !input.targetId) throw new RecordError("Say which entry to change.");

  const current = await snapshot(input.employeeId, input.section, input.action === "add" ? null : input.targetId);

  if (current && input.action !== "remove") {
    const same = Object.entries(input.proposed).every(([k, v]) => String(v ?? "") === String(current[k] ?? ""));
    if (same) throw new RecordError("That is what is already on file — nothing to change.");
  }

  // one open request per section and row: a second one would race the first
  const [{ open }] = await db
    .select({ open: count() })
    .from(profileChangeRequests)
    .where(
      and(
        eq(profileChangeRequests.employeeId, input.employeeId),
        eq(profileChangeRequests.section, input.section),
        eq(profileChangeRequests.status, "pending"),
        input.targetId ? eq(profileChangeRequests.targetId, input.targetId) : sql`true`,
        input.action === "add" ? eq(profileChangeRequests.action, "add") : sql`true`,
      ),
    );
  if (Number(open) > 0 && input.action !== "add") {
    throw new RecordError("You already have a request open for this. Withdraw it or wait for HR.");
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(profileChangeRequests)
      .values({
        orgId: input.orgId,
        employeeId: input.employeeId,
        section: input.section,
        action: input.action,
        targetId: input.targetId,
        proposed: input.action === "remove" ? (current ?? {}) : input.proposed,
        current,
        note: input.note,
      })
      .returning({ id: profileChangeRequests.id });

    await publish(tx, {
      orgId: input.orgId,
      module: "people",
      name: "people.profile_change.submitted",
      payload: {
        requestId: row.id,
        employeeId: input.employeeId,
        section: SECTION_BY_KEY.get(input.section)!.label.toLowerCase(),
        action: input.action,
      },
      dedupeKey: `profile_change.submitted:${row.id}`,
    });
    return row.id;
  });
}

export async function withdrawChange(orgId: string, employeeId: string, id: string) {
  const rows = await db
    .update(profileChangeRequests)
    .set({ status: "withdrawn", decidedAt: new Date() })
    .where(
      and(
        eq(profileChangeRequests.id, id),
        eq(profileChangeRequests.orgId, orgId),
        eq(profileChangeRequests.employeeId, employeeId),
        eq(profileChangeRequests.status, "pending"),
      ),
    )
    .returning({ id: profileChangeRequests.id });
  if (!rows.length) throw new RecordError("Only a pending request can be withdrawn.");
}

/**
 * Approves (and applies) or rejects a request. Applying writes the proposed
 * values — only the section's own fields, which `validateSection` already
 * restricted them to — onto the record in the same transaction as the decision.
 */
export async function decideChange(
  orgId: string,
  id: string,
  decision: "approved" | "rejected",
  note: string | null,
  actor: { userId: string; label: string },
) {
  const [req] = await db
    .select()
    .from(profileChangeRequests)
    .where(and(eq(profileChangeRequests.id, id), eq(profileChangeRequests.orgId, orgId)))
    .limit(1);
  if (!req) throw new RecordError("That request no longer exists.");
  if (req.status !== "pending") throw new RecordError("That request has already been decided.");
  if (decision === "rejected" && !note) throw new RecordError("Say why, so the employee knows what to fix.");

  const section = req.section as SectionKey;
  const def = SECTION_BY_KEY.get(section);
  if (!def) throw new RecordError("Unknown section.");

  // Claim, apply and record in one transaction: two reviewers deciding at
  // once get one winner, and a failed apply leaves the request pending.
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(profileChangeRequests)
      .set({ status: decision, decidedAt: new Date(), decidedByUserId: actor.userId, decidedByLabel: actor.label, decisionNote: note })
      .where(and(eq(profileChangeRequests.id, id), eq(profileChangeRequests.status, "pending")))
      .returning({ id: profileChangeRequests.id });
    if (!claimed.length) throw new RecordError("That request has already been decided.");

    if (decision === "approved") {
      if (isRowSection(section)) {
        if (req.action === "remove") await removeRow(orgId, section, req.targetId!, actor.label, tx);
        else await saveRow(orgId, req.employeeId, section, req.action === "add" ? null : req.targetId, req.proposed, tx);
      } else {
        const patch: Record<string, unknown> = {};
        for (const f of def.fields) if (f.name in req.proposed) patch[f.name] = req.proposed[f.name];
        await tx
          .update(employees)
          .set({ ...patch, updatedAt: new Date() })
          .where(and(eq(employees.id, req.employeeId), eq(employees.orgId, orgId)));
      }
    }

    await publish(tx, {
      orgId,
      module: "people",
      name: "people.profile_change.decided",
      payload: {
        requestId: id,
        employeeId: req.employeeId,
        section: def.label.toLowerCase(),
        outcome: decision,
        comment: note,
        decidedByUserId: actor.userId,
      },
      dedupeKey: `profile_change.decided:${id}`,
    });
  });
  if (decision === "approved") invalidate(cacheTags.people(orgId));

  return { employeeId: req.employeeId, section: def.label, action: req.action };
}

export async function changeQueue(orgId: string, status: string = "pending", limit = 100) {
  return db
    .select({
      r: profileChangeRequests,
      employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      employeeCode: employees.employeeCode,
      photoFileId: employees.photoFileId,
      department: departments.name,
    })
    .from(profileChangeRequests)
    .innerJoin(employees, eq(employees.id, profileChangeRequests.employeeId))
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(
      and(
        eq(profileChangeRequests.orgId, orgId),
        isNull(employees.deletedAt),
        status === "all" ? sql`true` : eq(profileChangeRequests.status, status as "pending"),
      ),
    )
    .orderBy(status === "pending" ? profileChangeRequests.createdAt : desc(profileChangeRequests.createdAt))
    .limit(limit);
}

export async function pendingChangeCount(orgId: string) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(profileChangeRequests)
    .where(and(eq(profileChangeRequests.orgId, orgId), eq(profileChangeRequests.status, "pending")));
  return Number(n);
}

export async function myChanges(orgId: string, employeeId: string, limit = 50) {
  return db
    .select()
    .from(profileChangeRequests)
    .where(and(eq(profileChangeRequests.orgId, orgId), eq(profileChangeRequests.employeeId, employeeId)))
    .orderBy(desc(profileChangeRequests.createdAt))
    .limit(limit);
}
