import "server-only";

import { subscribe, type DomainEventName } from "@/kernel/events";
import { register } from "@/kernel/registry";
import type { NotificationsPort } from "@/kernel/ports";
import { CATALOGUE } from "./catalogue";
import { bsSpan, dayCount, employeeNames, notify, userName } from "./service";

/**
 * The notifications module: listens, and tells people.
 *
 * It subscribes to the domain events other modules already publish and turns
 * each into a catalogue notification. Nothing calls it on the way to doing
 * its own job — leave approves a request and commits; this module hears about
 * it afterwards. A notifications fault therefore delays a notification and
 * never rolls back the approval that caused it, and the event stays queued
 * until it is delivered.
 *
 * Everything a message needs travels in the event payload (the reference, the
 * leave type, the dates), so this module never reads another module's tables
 * to describe what happened. Names are the exception: they are resolved from
 * the shared employee and user records at delivery time.
 */

export const notificationsPort: NotificationsPort = {
  notify: (orgId, key, input) =>
    notify(orgId, key, {
      context: input.context,
      subjectEmployeeId: input.subjectEmployeeId,
      approverEmployeeId: input.approverEmployeeId,
      actorUserId: input.actorUserId,
      dedupeKey: input.dedupeKey,
    }),
};

register({
  id: "notifications",
  version: "1.0.0",
  optional: ["leave", "attendance", "org"],
  port: () => notificationsPort,
});

type Payload = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Turns a leave or attendance event into the template context and routing. */
async function describe(name: string, p: Payload) {
  const subject = str(p.employeeId);
  const approver = str(p.approverEmployeeId);
  const names = await employeeNames([subject, approver]);
  const actor = await userName(str(p.decidedByUserId));

  const common = {
    employee: names.get(subject ?? "") ?? "An employee",
    approver: names.get(approver ?? "") ?? null,
    actor,
    reference: str(p.reference),
    reason: str(p.reason),
    comment: str(p.comment) ?? str(p.cancelReason),
  };

  if (name.startsWith("leave.")) {
    return {
      context: {
        ...common,
        leaveType: str(p.leaveTypeName) ?? "leave",
        dates: bsSpan(p.fromDateBs ?? p.fromDate, p.toDateBs ?? p.toDate),
        days: dayCount(p.totalDays),
      },
      subject,
      approver,
      actorUserId: str(p.decidedByUserId),
      actorLabel: actor,
      id: str(p.leaveRequestId),
    };
  }
  return {
    context: { ...common, requestType: str(p.requestType), date: str(p.dateBs) ?? str(p.date) },
    subject,
    approver,
    actorUserId: str(p.decidedByUserId),
    actorLabel: actor,
    id: str(p.attendanceRequestId),
  };
}

/*
 * One subscription per catalogue entry that has a source event. The handler id
 * is versioned and stable, so a redeploy does not re-deliver completed work.
 */
for (const entry of CATALOGUE) {
  if (
    !entry.source ||
    entry.source === "org.structure.changed" ||
    entry.source.startsWith("people.") ||
    entry.source.startsWith("attendance.overtime.")
  ) {
    continue;
  }
  subscribe({
    id: `notifications.${entry.key}@1`,
    module: "notifications",
    event: entry.source as DomainEventName,
    async run(payload, orgId) {
      const d = await describe(entry.source!, payload);
      if (!d.id) return;
      // the level is part of the key: a request forwarded twice notifies twice
      const level = payload.level ? `:${payload.level}` : "";
      await notify(orgId, entry.key, {
        context: d.context,
        subjectEmployeeId: d.subject,
        approverEmployeeId: d.approver,
        // a withdrawal is the employee's own act; everything else, the approver's
        actorUserId: d.actorUserId,
        actorLabel: entry.key === "leave.withdrawn" || entry.key.endsWith(".submitted") ? d.context.employee : d.actorLabel,
        dedupeKey: `${entry.key}:${d.id}${level}`,
      });
    },
  });
}

/*
 * Employee-record events. The payload carries the words; only the employee's
 * name is looked up, as everywhere else.
 */
const PEOPLE: { key: string; event: DomainEventName; id: (p: Payload) => string | null; context: (p: Payload) => Record<string, string | null> }[] = [
  {
    key: "people.movement_applied",
    event: "people.movement.applied",
    id: (p) => str(p.movementId),
    context: (p) => ({ kind: str(p.kind), date: str(p.effectiveDateBs) ?? str(p.effectiveDate), reference: str(p.reference) }),
  },
  {
    key: "people.separation_initiated",
    event: "people.separation.initiated",
    id: (p) => str(p.separationId),
    context: (p) => ({ kind: str(p.kind), date: str(p.lastWorkingDateBs) ?? str(p.lastWorkingDate), reference: str(p.reference) }),
  },
  {
    key: "people.profile_change_submitted",
    event: "people.profile_change.submitted",
    id: (p) => str(p.requestId),
    context: (p) => ({ section: str(p.section) }),
  },
  {
    key: "people.profile_change_decided",
    event: "people.profile_change.decided",
    id: (p) => str(p.requestId),
    context: (p) => ({ section: str(p.section), outcome: str(p.outcome), comment: str(p.comment) }),
  },
];

for (const def of PEOPLE) {
  subscribe({
    id: `notifications.${def.key}@1`,
    module: "notifications",
    event: def.event,
    async run(payload, orgId) {
      const id = def.id(payload);
      if (!id) return;
      const subject = str(payload.employeeId);
      const names = await employeeNames([subject]);
      const actorUserId = str(payload.decidedByUserId);
      const actor = await userName(actorUserId);
      const employee = names.get(subject ?? "") ?? "An employee";
      await notify(orgId, def.key, {
        context: { employee, actor, ...def.context(payload) },
        subjectEmployeeId: subject,
        actorUserId,
        actorLabel: def.key === "people.profile_change_submitted" ? employee : actor,
        dedupeKey: `${def.key}:${id}`,
      });
    },
  });
}

/*
 * Overtime claims. The payload carries the figures already worded for people
 * ("2h 30m"), so the templates never do arithmetic.
 */
const OVERTIME: { key: string; event: DomainEventName }[] = [
  { key: "attendance.overtime_submitted", event: "attendance.overtime.submitted" },
  { key: "attendance.overtime_approved", event: "attendance.overtime.approved" },
  { key: "attendance.overtime_rejected", event: "attendance.overtime.rejected" },
  { key: "attendance.overtime_withdrawn", event: "attendance.overtime.withdrawn" },
];

for (const def of OVERTIME) {
  subscribe({
    id: `notifications.${def.key}@1`,
    module: "notifications",
    event: def.event,
    async run(payload, orgId) {
      const id = str(payload.overtimeClaimId);
      if (!id) return;
      const subject = str(payload.employeeId);
      const approver = str(payload.approverEmployeeId);
      const names = await employeeNames([subject, approver]);
      const actorUserId = str(payload.decidedByUserId);
      const actor = await userName(actorUserId);
      const employee = names.get(subject ?? "") ?? "An employee";
      const byEmployee = def.key === "attendance.overtime_submitted" || def.key === "attendance.overtime_withdrawn";
      await notify(orgId, def.key, {
        context: {
          employee,
          approver: names.get(approver ?? "") ?? null,
          actor,
          reference: str(payload.reference),
          date: str(payload.dateBs) ?? str(payload.date),
          dayKind: str(payload.dayKind),
          claimed: str(payload.claimed),
          approved: str(payload.approved),
          payable: str(payload.payable),
          rate: str(payload.rate),
          reason: str(payload.reason),
          comment: str(payload.comment),
        },
        subjectEmployeeId: subject,
        approverEmployeeId: approver,
        actorUserId,
        actorLabel: byEmployee ? employee : actor,
        dedupeKey: `${def.key}:${id}`,
      });
    },
  });
}

subscribe({
  id: "notifications.org.structure_changed@1",
  module: "notifications",
  event: "org.structure.changed",
  async run(payload, orgId) {
    const kind = str(payload.kind)?.replace(/_/g, " ") ?? "unit";
    await notify(orgId, "org.structure_changed", {
      context: { kind: kind[0].toUpperCase() + kind.slice(1), action: str(payload.action) ?? "changed" },
      // Two edits to one unit are two notifications, so the key includes the
      // time. Safe in practice: the kernel skips handlers that already
      // completed, so a replay never re-runs this one after it succeeded.
      dedupeKey: `org.structure_changed:${str(payload.unitId)}:${str(payload.action)}:${Date.now()}`,
    });
  },
});
