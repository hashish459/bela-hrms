"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { employees, probationReviews } from "@/db/schema/hr";
import { requirePermission } from "@/lib/session";

/**
 * Recording a probation decision.
 *
 * Three outcomes, and each one writes two things: the decision, to
 * `probation_reviews`, and its consequence, to the employee row. The employee
 * row is what every other screen already reads — the attendance register, the
 * leave engine, payroll — so nothing else has to learn about this table for the
 * decision to take effect.
 *
 * Both writes happen in one transaction. A confirmation that recorded the
 * decision but left the employee on probation, or moved them to permanent with
 * no record of who decided, is worse than a failure that changed nothing.
 */

const schema = z
  .object({
    outcome: z.enum(["confirmed", "extended", "terminated"]),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date this takes effect"),
    /*
     * `.optional()` is load-bearing, not defensive noise. The field is only
     * rendered when the outcome is "extended", so on a plain confirmation the
     * key is absent from the FormData entirely rather than present and empty —
     * and a schema that only tolerates "" rejects the most common decision in
     * the product with a message pointing at a field nobody can see.
     */
    newProbationEndDate: z
      .string()
      .trim()
      .optional()
      .transform((v) => (!v ? null : v))
      .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use the date picker"),
    remarks: z
      .string()
      .trim()
      .optional()
      .transform((v) => (!v ? null : v)),
  })
  .superRefine((d, ctx) => {
    if (d.outcome === "extended") {
      if (!d.newProbationEndDate) {
        ctx.addIssue({
          code: "custom",
          path: ["newProbationEndDate"],
          message: "Say when the extended probation ends",
        });
      } else if (d.newProbationEndDate <= d.effectiveDate) {
        ctx.addIssue({
          code: "custom",
          path: ["newProbationEndDate"],
          message: "The new end date must be after the effective date",
        });
      }
    }
    // A confirmation speaks for itself. An extension or a termination is a
    // decision somebody will be asked to justify later, possibly in front of a
    // labour officer, so the reason is captured at the moment it is made.
    if (d.outcome !== "confirmed" && !d.remarks) {
      ctx.addIssue({ code: "custom", path: ["remarks"], message: "Record the reason" });
    }
  });

export type ConfirmationState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /**
   * What was submitted, echoed back so a rejected form redisplays what the
   * person typed instead of clearing it. Losing a typed reason and a date every
   * time a required field is missed is how a form teaches people to dread it.
   */
  values?: Record<string, string>;
};

export async function decideProbation(
  employeeId: string,
  _prev: ConfirmationState,
  formData: FormData,
): Promise<ConfirmationState> {
  const viewer = await requirePermission("hr.employee.update");

  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") raw[key] = value;
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return {
      ok: false,
      message: "Please correct the highlighted fields.",
      fieldErrors,
      values: raw,
    };
  }
  const data = parsed.data;

  const [employee] = await db
    .select({
      id: employees.id,
      code: employees.employeeCode,
      firstName: employees.firstName,
      lastName: employees.lastName,
      status: employees.status,
      dateOfJoin: employees.dateOfJoin,
      probationEndDate: employees.probationEndDate,
    })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.orgId, viewer.orgId)))
    .limit(1);

  if (!employee) {
    return { ok: false, message: "That employee is not in this organisation.", values: raw };
  }

  if (employee.status !== "probation") {
    // Two people opening the queue at once is the ordinary case, not an edge
    // case. Whoever arrives second must not overwrite the first decision.
    return {
      ok: false,
      message: `${employee.firstName} is no longer on probation — the record shows "${employee.status.replace(/_/g, " ")}".`,
      values: raw,
    };
  }

  if (data.effectiveDate < employee.dateOfJoin) {
    return {
      ok: false,
      message: "The decision cannot take effect before the employee joined.",
      fieldErrors: { effectiveDate: "Earlier than the date of join" },
      values: raw,
    };
  }

  const name = `${employee.firstName} ${employee.lastName}`;

  await db.transaction(async (tx) => {
    await tx.insert(probationReviews).values({
      orgId: viewer.orgId,
      employeeId,
      probationEndDate: employee.probationEndDate,
      outcome: data.outcome,
      effectiveDate: data.effectiveDate,
      newProbationEndDate: data.outcome === "extended" ? data.newProbationEndDate : null,
      remarks: data.remarks,
      decidedByUserId: viewer.userId,
      decidedByLabel: viewer.name,
    });

    if (data.outcome === "confirmed") {
      await tx
        .update(employees)
        .set({
          status: "active",
          confirmationDate: data.effectiveDate,
          updatedAt: new Date(),
        })
        .where(eq(employees.id, employeeId));
    } else if (data.outcome === "extended") {
      await tx
        .update(employees)
        .set({ probationEndDate: data.newProbationEndDate, updatedAt: new Date() })
        .where(eq(employees.id, employeeId));
    } else {
      await tx
        .update(employees)
        .set({
          status: "terminated",
          separationDate: data.effectiveDate,
          separationReason: data.remarks,
          updatedAt: new Date(),
        })
        .where(eq(employees.id, employeeId));
    }

    await tx.insert(auditLog).values({
      orgId: viewer.orgId,
      actorUserId: viewer.userId,
      actorLabel: viewer.name,
      action: "update",
      entityType: "employee",
      entityId: employeeId,
      summary:
        data.outcome === "confirmed"
          ? `Confirmed ${name} (${employee.code}) with effect from ${data.effectiveDate}`
          : data.outcome === "extended"
            ? `Extended probation for ${name} (${employee.code}) to ${data.newProbationEndDate}`
            : `Ended probation for ${name} (${employee.code}) without confirmation`,
      changes: {
        status: {
          from: employee.status,
          to: data.outcome === "confirmed" ? "active" : data.outcome === "extended" ? "probation" : "terminated",
        },
        // Only an extension moves this date. Reporting it on a confirmation
        // would record that the probation end date was cleared, which is the
        // opposite of what happened — the date stays, as the evidence of what
        // the decision was answering.
        ...(data.outcome === "extended"
          ? {
              probationEndDate: {
                from: employee.probationEndDate,
                to: data.newProbationEndDate,
              },
            }
          : {}),
      },
    });
  });

  revalidatePath("/hr/confirmations");
  revalidatePath(`/hr/employees/${employeeId}`);
  revalidatePath("/hr/employees");

  return {
    ok: true,
    message:
      data.outcome === "confirmed"
        ? `${name} is now permanent.`
        : data.outcome === "extended"
          ? `Probation extended to ${data.newProbationEndDate}.`
          : `${name} has been recorded as not confirmed.`,
  };
}
