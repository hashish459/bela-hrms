/**
 * The approval ledger: kernel-owned, not leave-owned.
 *
 * One row per (entityType, entityId, level). Any module that needs a signature
 * chain — leave, attendance regularisation, travel, expense, procurement —
 * attaches to this table by naming its entity type. None of them import each
 * other to do it, which is the point: the legacy system reimplemented "levels of
 * approval" six times, and each copy drifted.
 *
 * The whole chain is written at submission, so a screen can name the person a
 * request is waiting on rather than only saying "pending".
 */
import { relations } from "drizzle-orm";
import { index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./core";
import { employees } from "./hr";
import { user } from "./auth";

/** Shared request vocabulary. Used by leave, attendance and every later module. */
export const requestStatus = pgEnum("request_status", [
  "draft",
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const approvalDecision = pgEnum("approval_decision", [
  "pending",
  "approved",
  "rejected",
  "returned",
  "skipped",
]);

/**
 * The generic approval ledger.
 *
 * One row per (entity, level). Rows are created when a request is submitted, so
 * the whole approval chain is visible up front rather than materialising a step
 * at a time - which is what lets the UI show "awaiting: Finance Manager" instead
 * of just "pending".
 */
export const approvalSteps = pgTable(
  "approval_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** "leave_request" today; "travel_order", "expense_claim" next. */
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    level: integer("level").notNull(),
    /** Resolved at submission time from the supervisor chain or a role. */
    approverEmployeeId: uuid("approver_employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    approverLabel: text("approver_label"),
    decision: approvalDecision("decision").notNull().default("pending"),
    comment: text("comment"),
    decidedByUserId: text("decided_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("approval_steps_entity_level_key").on(t.entityType, t.entityId, t.level),
    index("approval_steps_pending_idx").on(t.orgId, t.entityType, t.decision),
    index("approval_steps_approver_idx").on(t.approverEmployeeId, t.decision),
  ],
);

export const approvalStepsRelations = relations(approvalSteps, ({ one }) => ({
  approver: one(employees, {
    fields: [approvalSteps.approverEmployeeId],
    references: [employees.id],
  }),
}));
