"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, roles } from "@/db/schema/core";
import { ACTING_ROLE_COOKIE, requireViewer } from "@/lib/session";

/**
 * Role switching for the system administrator.
 *
 * Guarded on `viewer.isSystemAdmin` — the account flag — and deliberately *not*
 * on a permission. A permission check here would reintroduce the failure this
 * whole feature exists to prevent: while acting as an employee you hold an
 * employee's permissions, so a permission-guarded switch-back would strand you
 * in the role you had just assumed.
 *
 * The switch can only narrow. The assumed permissions are the target role's
 * grants and nothing else, and the actor already held every permission, so there
 * is no configuration in which switching gains access to anything.
 */

export type ActState = { ok?: string; error?: string };

export type SwitchableRole = { id: string; code: string; name: string };

/** The roles a system administrator may view the product as. */
export async function switchableRoles(): Promise<SwitchableRole[]> {
  const viewer = await requireViewer();
  if (!viewer.isSystemAdmin) return [];

  return db
    .select({ id: roles.id, code: roles.code, name: roles.name })
    .from(roles)
    .where(eq(roles.orgId, viewer.orgId))
    .orderBy(asc(roles.name));
}

export async function actAsRole(_prev: ActState, formData: FormData): Promise<ActState> {
  const viewer = await requireViewer();
  if (!viewer.isSystemAdmin) {
    return { error: "Only the system administrator can view the product as another role." };
  }

  const roleId = String(formData.get("roleId") ?? "").trim();
  const jar = await cookies();

  // An empty selection is "be myself again", which must always be available.
  if (!roleId) {
    jar.delete(ACTING_ROLE_COOKIE);
    await record(viewer.orgId, viewer.userId, viewer.name, "Returned to their own role");
    revalidatePath("/", "layout");
    return { ok: "Back to your own access." };
  }

  const [role] = await db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.orgId, viewer.orgId)))
    .limit(1);

  if (!role) return { error: "That role no longer exists." };

  jar.set(ACTING_ROLE_COOKIE, role.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Session-scoped on purpose: closing the browser ends the impersonation, so
    // nobody comes back tomorrow wondering why half the menu is missing.
  });

  await record(viewer.orgId, viewer.userId, viewer.name, `Started viewing as ${role.name}`);
  revalidatePath("/", "layout");
  return { ok: `Viewing as ${role.name}.` };
}

/**
 * Every switch is written to the audit trail, in both directions.
 *
 * Impersonation without a trail is how "the administrator did it" becomes
 * unfalsifiable. The rows say who assumed which role and when they stopped.
 */
async function record(
  orgId: string,
  userId: string,
  name: string,
  summary: string,
): Promise<void> {
  await db.insert(auditLog).values({
    orgId,
    actorUserId: userId,
    actorLabel: name,
    action: "update",
    entityType: "acting_role",
    entityId: null,
    summary,
  });
}
