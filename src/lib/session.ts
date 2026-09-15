import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { fiscalYears, organizations, roleGrants, roles, userAccounts, userRoles } from "@/db/schema/core";
import { employees } from "@/db/schema/hr";
import { auth } from "@/lib/auth";
import { ALL_PERMISSIONS, isKnownPermission, type Permission } from "@/modules/registry";

/** Names the role a system administrator is viewing the product as. */
export const ACTING_ROLE_COOKIE = "bela-hrms.acting-role";

export type Viewer = {
  userId: string;
  name: string;
  email: string;
  orgId: string;
  orgName: string;
  orgCode: string;
  employeeId: string | null;
  employeeCode: string | null;
  roleNames: string[];
  permissions: ReadonlySet<Permission>;
  /**
   * Holds every permission regardless of roles, and may act as any role. Set on
   * the account, so no edit made inside the product can remove it.
   */
  isSystemAdmin: boolean;
  /**
   * The role a system administrator is currently viewing the product as, or null
   * when they are themselves. While set, `permissions` are that role's grants —
   * this is what makes the switch honest rather than cosmetic.
   */
  actingAs: { id: string; name: string } | null;
  fiscalYear: { id: string; code: string; startDate: string; endDate: string } | null;
};

/**
 * Loads the viewer once per request. `cache` dedupes across the layout, the page
 * and any server action in the same render, so the permission query runs once
 * rather than once per component that asks "can this person see X?".
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result?.user) return null;

  const [account] = await db
    .select({
      orgId: userAccounts.orgId,
      employeeId: userAccounts.employeeId,
      isActive: userAccounts.isActive,
      isSystemAdmin: userAccounts.isSystemAdmin,
      orgName: organizations.name,
      orgCode: organizations.code,
    })
    .from(userAccounts)
    .innerJoin(organizations, eq(organizations.id, userAccounts.orgId))
    .where(eq(userAccounts.userId, result.user.id))
    .limit(1);

  // A login with no application account, or a disabled one, is not a viewer.
  if (!account || !account.isActive) return null;

  const grantRows = await db
    .select({ permission: roleGrants.permission, roleName: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(roleGrants, eq(roleGrants.roleId, roles.id))
    .where(and(eq(userRoles.userId, result.user.id), eq(roles.orgId, account.orgId)));

  const permissions = new Set<Permission>();
  const roleNames = new Set<string>();
  for (const row of grantRows) {
    roleNames.add(row.roleName);
    // Ignore grants for permissions this build no longer defines rather than
    // letting a stale row break the whole check.
    if (row.permission && isKnownPermission(row.permission)) permissions.add(row.permission);
  }

  // The break-glass rule. A system administrator's authority comes from the
  // account, not from a role, so revoking every role leaves it intact — the
  // system can always be administered by somebody.
  if (account.isSystemAdmin) {
    for (const p of ALL_PERMISSIONS) permissions.add(p.key);
  }

  /*
   * Acting as another role.
   *
   * Only a system administrator may do it, and it can only ever *narrow*: the
   * assumed permissions are that role's grants and nothing else, so this is not
   * a path to privilege. It exists to answer "what does a supervisor actually
   * see", which is otherwise guesswork until somebody complains.
   *
   * The switch is a cookie rather than a column because it is a view of the
   * session, not a fact about the person. Signing out ends it; so does clearing
   * it; and it never touches the roles the account really holds.
   */
  let actingAs: { id: string; name: string } | null = null;
  if (account.isSystemAdmin) {
    const requestedRoleId = (await cookies()).get(ACTING_ROLE_COOKIE)?.value ?? null;
    if (requestedRoleId) {
      const [assumed] = await db
        .select({ id: roles.id, name: roles.name })
        .from(roles)
        .where(and(eq(roles.id, requestedRoleId), eq(roles.orgId, account.orgId)))
        .limit(1);

      // A cookie naming a role that has since been deleted, or one from another
      // organisation, is ignored rather than trusted.
      if (assumed) {
        const assumedGrants = await db
          .select({ permission: roleGrants.permission })
          .from(roleGrants)
          .where(eq(roleGrants.roleId, assumed.id));

        permissions.clear();
        for (const row of assumedGrants) {
          if (row.permission && isKnownPermission(row.permission)) permissions.add(row.permission);
        }
        actingAs = assumed;
      }
    }
  }

  let employeeCode: string | null = null;
  if (account.employeeId) {
    const [emp] = await db
      .select({ code: employees.employeeCode })
      .from(employees)
      .where(eq(employees.id, account.employeeId))
      .limit(1);
    employeeCode = emp?.code ?? null;
  }

  const [fy] = await db
    .select({
      id: fiscalYears.id,
      code: fiscalYears.code,
      startDate: fiscalYears.startDate,
      endDate: fiscalYears.endDate,
    })
    .from(fiscalYears)
    .where(and(eq(fiscalYears.orgId, account.orgId), eq(fiscalYears.isCurrent, true)))
    .limit(1);

  return {
    userId: result.user.id,
    name: result.user.name,
    email: result.user.email,
    orgId: account.orgId,
    orgName: account.orgName,
    orgCode: account.orgCode,
    employeeId: account.employeeId,
    employeeCode,
    /*
     * The account's own identity, never the assumed one.
     *
     * This used to return the acting role, which made the header label a
     * system administrator "Employee" while they were looking through an
     * employee's eyes — and, worse, kept saying it afterwards because the
     * account genuinely holds only that role. Who you *are* is a fact about the
     * account; what you are *viewing as* is `actingAs`, and the two are shown
     * separately because they are different things.
     */
    roleNames: account.isSystemAdmin
      ? ["Administrator"]
      : [...roleNames].sort(),
    permissions,
    isSystemAdmin: account.isSystemAdmin,
    actingAs,
    fiscalYear: fy ?? null,
  };
});

/** For pages: redirects to the login screen when there is no viewer. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

export class ForbiddenError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "ForbiddenError";
  }
}

/**
 * The guard for pages and server actions.
 *
 * On a page it raises Next's `forbidden()` interrupt, which renders
 * `forbidden.tsx` with a real 403 rather than dressing an authorization failure
 * up as a server error. In a server action there is no boundary to catch that,
 * so it throws instead — a mutation must abort outright rather than half-apply
 * and then bounce the user somewhere friendly.
 */
export async function requirePermission(permission: Permission): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.permissions.has(permission)) return viewer;

  const isAction = (await headers()).get("next-action") !== null;
  if (isAction) throw new ForbiddenError(permission);
  forbidden();
}

export function can(viewer: Viewer | null, permission: Permission): boolean {
  return !!viewer?.permissions.has(permission);
}
