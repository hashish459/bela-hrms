"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { user } from "@/db/schema/auth";
import { auditLog, roleGrants, roles, userAccounts, userRoles } from "@/db/schema/core";
import { employees } from "@/db/schema/hr";
import { auth } from "@/lib/auth";
import { requirePermission } from "@/lib/session";
import { ALL_PERMISSIONS, isKnownPermission } from "@/modules/registry";

export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[issue.path.join(".") || "form"] ??= issue.message;
  return out;
}

/* ------------------------------------------------------------------ users */

const createUserSchema = z.object({
  name: z.string().trim().min(2, "Give the person a name").max(120),
  email: z.email("Enter a valid work email address"),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .max(72, "Too long")
    .regex(/[A-Za-z]/, "Include a letter")
    .regex(/[0-9]/, "Include a digit"),
  employeeId: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  roleIds: z.array(z.uuid()).min(1, "Give the account at least one role"),
});

/**
 * Creates a login.
 *
 * Accounts are made by an administrator, never self-registered — this is an
 * internal system and every login has to map to somebody the organisation knows.
 * The password goes through Better Auth so it is hashed the way sign-in expects;
 * the tenant link, the employee link and the roles are ours.
 */
export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requirePermission("admin.user.manage");

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    employeeId: formData.get("employeeId") ?? "",
    roleIds: formData.getAll("roleIds").map(String).filter(Boolean),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }
  const data = parsed.data;

  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, data.email))
    .limit(1);
  if (existing.length) {
    return {
      ok: false,
      message: "That email address already has a login.",
      fieldErrors: { email: "Already in use" },
    };
  }

  // roles must belong to this organisation — never trust an id from the form
  const validRoles = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.orgId, viewer.orgId));
  const allowed = new Set(validRoles.map((r) => r.id));
  const roleIds = data.roleIds.filter((id) => allowed.has(id));
  if (roleIds.length === 0) {
    return { ok: false, message: "Those roles do not belong to this organisation." };
  }

  if (data.employeeId) {
    const emp = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, data.employeeId), eq(employees.orgId, viewer.orgId)))
      .limit(1);
    if (!emp.length) return { ok: false, message: "That employee is not in this organisation." };

    const taken = await db
      .select({ userId: userAccounts.userId })
      .from(userAccounts)
      .where(eq(userAccounts.employeeId, data.employeeId))
      .limit(1);
    if (taken.length) {
      return {
        ok: false,
        message: "That employee already has a login.",
        fieldErrors: { employeeId: "Already linked" },
      };
    }
  }

  const created = await auth.api.signUpEmail({
    body: { email: data.email, password: data.password, name: data.name },
  });

  await db.transaction(async (tx) => {
    await tx.insert(userAccounts).values({
      userId: created.user.id,
      orgId: viewer.orgId,
      employeeId: data.employeeId,
      isActive: true,
      mustChangePassword: true,
    });
    await tx
      .insert(userRoles)
      .values(roleIds.map((roleId) => ({ userId: created.user.id, roleId })));
  });

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "create",
    entityType: "user",
    entityId: created.user.id,
    summary: `Created login ${data.email} with ${roleIds.length} role(s)`,
  });

  revalidatePath("/admin/users");
  return { ok: true, message: `${data.email} created. They should change the password on first sign-in.` };
}

export async function setUserActive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requirePermission("admin.user.manage");
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { ok: false, message: "Unknown user." };

  if (userId === viewer.userId) {
    return { ok: false, message: "You cannot disable your own login." };
  }

  const [account] = await db
    .select()
    .from(userAccounts)
    .where(and(eq(userAccounts.userId, userId), eq(userAccounts.orgId, viewer.orgId)))
    .limit(1);
  if (!account) return { ok: false, message: "That login is not in this organisation." };

  await db
    .update(userAccounts)
    .set({ isActive: !account.isActive })
    .where(eq(userAccounts.userId, userId));

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "user",
    entityId: userId,
    summary: `${account.isActive ? "Disabled" : "Enabled"} a login`,
    changes: { isActive: { from: account.isActive, to: !account.isActive } },
  });

  revalidatePath("/admin/users");
  return {
    ok: true,
    message: account.isActive
      ? "Login disabled. Existing sessions stop working on their next request."
      : "Login enabled.",
  };
}

const assignRolesSchema = z.object({
  userId: z.string().min(1),
  roleIds: z.array(z.uuid()),
});

export async function setUserRoles(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requirePermission("admin.user.manage");

  const parsed = assignRolesSchema.safeParse({
    userId: formData.get("userId"),
    roleIds: formData.getAll("roleIds").map(String).filter(Boolean),
  });
  if (!parsed.success) return { ok: false, message: "Those roles could not be read." };
  const { userId, roleIds } = parsed.data;

  const [account] = await db
    .select()
    .from(userAccounts)
    .where(and(eq(userAccounts.userId, userId), eq(userAccounts.orgId, viewer.orgId)))
    .limit(1);
  if (!account) return { ok: false, message: "That login is not in this organisation." };

  const orgRoles = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.orgId, viewer.orgId));
  const allowed = new Set(orgRoles.map((r) => r.id));
  const clean = roleIds.filter((id) => allowed.has(id));

  // Losing every role would leave somebody signed in with no navigation and no
  // way back — refuse it rather than produce an account nobody can use.
  if (clean.length === 0) {
    return { ok: false, message: "A login needs at least one role." };
  }

  await db.transaction(async (tx) => {
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    await tx.insert(userRoles).values(clean.map((roleId) => ({ userId, roleId })));
  });

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "user",
    entityId: userId,
    summary: `Set roles for a login (${clean.length} assigned)`,
  });

  revalidatePath("/admin/users");
  return { ok: true, message: "Roles updated. They apply on the next request." };
}

/* ------------------------------------------------------------------ roles */

const roleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Code is required")
    .max(40)
    .regex(/^[a-z0-9_]+$/, "Lower case letters, digits and underscore only"),
  name: z.string().trim().min(2, "Name is required").max(80),
  description: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === "" ? null : v))
    .nullable(),
});

export async function createRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requirePermission("admin.role.manage");

  const parsed = roleSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please correct the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }

  const clash = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.orgId, viewer.orgId), eq(roles.code, parsed.data.code)))
    .limit(1);
  if (clash.length) {
    return {
      ok: false,
      message: "That role code is already in use.",
      fieldErrors: { code: "Already used" },
    };
  }

  const [role] = await db
    .insert(roles)
    .values({ ...parsed.data, orgId: viewer.orgId, isSystem: false })
    .returning({ id: roles.id });

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "create",
    entityType: "role",
    entityId: role.id,
    summary: `Created role ${parsed.data.name}`,
  });

  revalidatePath("/admin/roles");
  return { ok: true, message: `Role ${parsed.data.name} created with no permissions yet.` };
}

/**
 * Replaces a role's grants with exactly what was submitted.
 *
 * Unknown permission strings are dropped rather than stored: the catalogue lives
 * in code, and a grant for something the build does not define would sit in the
 * table forever doing nothing.
 */
export async function setRoleGrants(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requirePermission("admin.role.manage");

  const roleId = String(formData.get("roleId") ?? "");
  if (!z.uuid().safeParse(roleId).success) return { ok: false, message: "Unknown role." };

  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.orgId, viewer.orgId)))
    .limit(1);
  if (!role) return { ok: false, message: "That role is not in this organisation." };

  const submitted = formData.getAll("permissions").map(String).filter(isKnownPermission);
  const before = await db
    .select({ permission: roleGrants.permission })
    .from(roleGrants)
    .where(eq(roleGrants.roleId, roleId));
  const beforeSet = new Set(before.map((b) => b.permission));

  // Do not let an administrator remove their own ability to manage roles — that
  // is a one-way door out of the permission system.
  const selfRole = await db
    .select({ n: count() })
    .from(userRoles)
    .where(and(eq(userRoles.userId, viewer.userId), eq(userRoles.roleId, roleId)));
  const isOwnRole = Number(selfRole[0]?.n ?? 0) > 0;
  if (isOwnRole && !submitted.includes("admin.role.manage")) {
    const otherHolders = await db
      .select({ n: count() })
      .from(roleGrants)
      .innerJoin(roles, eq(roles.id, roleGrants.roleId))
      .where(
        and(
          eq(roles.orgId, viewer.orgId),
          eq(roleGrants.permission, "admin.role.manage"),
          ne(roleGrants.roleId, roleId),
        ),
      );
    if (Number(otherHolders[0]?.n ?? 0) === 0) {
      return {
        ok: false,
        message:
          "This is the only role that can manage roles, and it is yours. Grant it elsewhere first.",
      };
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(roleGrants).where(eq(roleGrants.roleId, roleId));
    if (submitted.length) {
      await tx.insert(roleGrants).values(submitted.map((permission) => ({ roleId, permission })));
    }
  });

  const added = submitted.filter((p) => !beforeSet.has(p));
  const removed = [...beforeSet].filter((p) => !submitted.includes(p));

  await db.insert(auditLog).values({
    orgId: viewer.orgId,
    actorUserId: viewer.userId,
    actorLabel: viewer.name,
    action: "update",
    entityType: "role",
    entityId: roleId,
    summary: `Updated ${role.name}: ${submitted.length} of ${ALL_PERMISSIONS.length} permissions`,
    changes: {
      granted: { from: null, to: added.join(", ") || "—" },
      revoked: { from: null, to: removed.join(", ") || "—" },
    },
  });

  revalidatePath("/admin/roles");
  return {
    ok: true,
    message: `${role.name} saved — ${added.length} granted, ${removed.length} revoked.`,
  };
}
