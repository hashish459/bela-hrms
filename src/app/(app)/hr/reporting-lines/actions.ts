"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema/core";
import { employees } from "@/db/schema/hr";
import { requirePermission } from "@/lib/session";
import { wouldCreateCycle } from "@/modules/people/reporting";

/**
 * Editing the reporting chain.
 *
 * This is the most consequential single field in the product. Leave approval
 * routing walks it — level one is the direct supervisor, level two theirs — so a
 * change here silently changes who can approve what, and a *cycle* here is not a
 * cosmetic problem: it is an approval that can never be routed and a tree that
 * cannot be rendered.
 *
 * The legacy system let a cycle be created. The employee tree screen then
 * dropped both people silently, because neither had a parent that was a root,
 * and nobody could work out where they had gone.
 *
 * The cycle rule itself lives in `modules/people/reporting.ts`: it is domain
 * logic every caller must obey, and a `"use server"` file cannot export a
 * helper for a test to assert against.
 */

export type SupervisorState = { ok: boolean; message?: string };

export async function setSupervisor(
  employeeId: string,
  supervisorId: string | null,
): Promise<SupervisorState> {
  const viewer = await requirePermission("hr.employee.update");

  if (supervisorId === employeeId) {
    return { ok: false, message: "An employee cannot report to themselves." };
  }

  const [employee] = await db
    .select({
      id: employees.id,
      code: employees.employeeCode,
      firstName: employees.firstName,
      lastName: employees.lastName,
      supervisorId: employees.supervisorId,
    })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.orgId, viewer.orgId)))
    .limit(1);
  if (!employee) return { ok: false, message: "That employee is not in this organisation." };

  let supervisorLabel: string | null = null;

  if (supervisorId) {
    const [supervisor] = await db
      .select({
        id: employees.id,
        code: employees.employeeCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(employees)
      .where(and(eq(employees.id, supervisorId), eq(employees.orgId, viewer.orgId)))
      .limit(1);
    if (!supervisor) return { ok: false, message: "That supervisor is not in this organisation." };

    if (await wouldCreateCycle(employeeId, supervisorId)) {
      return {
        ok: false,
        message: `${supervisor.firstName} already reports to ${employee.firstName}, directly or further up. That would make a loop.`,
      };
    }

    supervisorLabel = `${supervisor.firstName} ${supervisor.lastName}`;
  }

  if ((employee.supervisorId ?? null) === supervisorId) {
    return { ok: true, message: "No change." };
  }

  await db
    .update(employees)
    .set({ supervisorId, updatedAt: new Date() })
    .where(eq(employees.id, employeeId));

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "employee",
    entityId: employeeId,
    summary: supervisorLabel
      ? `${employee.firstName} ${employee.lastName} (${employee.code}) now reports to ${supervisorLabel}`
      : `${employee.firstName} ${employee.lastName} (${employee.code}) no longer has a supervisor`,
    changes: { supervisorId: { from: employee.supervisorId, to: supervisorId } },
  });

  revalidatePath("/hr/reporting-lines");
  revalidatePath(`/hr/employees/${employeeId}`);
  if (employee.supervisorId) revalidatePath(`/hr/employees/${employee.supervisorId}`);
  if (supervisorId) revalidatePath(`/hr/employees/${supervisorId}`);

  return {
    ok: true,
    message: supervisorLabel ? `Now reporting to ${supervisorLabel}.` : "Supervisor cleared.",
  };
}
