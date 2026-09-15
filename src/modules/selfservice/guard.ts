import "server-only";

import { forbidden } from "next/navigation";
import { requirePermission } from "@/lib/session";
import type { Permission } from "@/modules/registry";
import type { SelfContext } from "./desk";

/**
 * The only way to obtain a `SelfContext`.
 *
 * Two independent controls, and both have to pass:
 *
 *   RBAC      — does this role get a desk at all? `requirePermission` raises a
 *               real 403 on a page and throws inside a server action.
 *   Ownership — whose desk is it? Read from the session, below.
 *
 * Neither substitutes for the other. Permission alone would let any employee
 * open any other employee's desk, which is precisely what the legacy module
 * allowed; ownership alone would ignore a role that has been denied self
 * service entirely.
 *
 * There is no parameter for the employee id, anywhere, on purpose. The legacy
 * controller accepted one and never checked it.
 */
export async function requireSelf(
  permission: Permission = "self.desk.view",
): Promise<SelfContext> {
  const viewer = await requirePermission(permission);

  // A login with no linked employee — an administrator, an integration account —
  // has no desk. A 403 rather than an empty page: five blank panels look like
  // missing data and send people to support.
  if (!viewer.employeeId) forbidden();

  return { orgId: viewer.orgId, employeeId: viewer.employeeId, viewer };
}
