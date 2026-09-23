import Link from "next/link";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { user } from "@/db/schema/auth";
import { roles, userAccounts, userRoles } from "@/db/schema/core";
import { employees } from "@/db/schema/hr";
import { can, requirePermission } from "@/lib/session";
import { Badge, Card, PageHeader, StatTile, TableShell, Td, Th, Tr } from "@/components/ui";
import { DeleteUserButton, NewUserForm, RoleAssigner, ToggleUserButton } from "./forms";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const viewer = await requirePermission("admin.user.view");
  const canManage = can(viewer, "admin.user.manage");

  const [rows, roleRows, linkable] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        isActive: userAccounts.isActive,
        mustChangePassword: userAccounts.mustChangePassword,
        lastLoginAt: userAccounts.lastLoginAt,
        employeeId: employees.id,
        employeeCode: employees.employeeCode,
        employeeName: sql<string | null>`${employees.firstName} || ' ' || ${employees.lastName}`,
        roleIds: sql<string[]>`coalesce(array_agg(${roles.id}) filter (where ${roles.id} is not null), '{}')`,
        roleNames: sql<string[]>`coalesce(array_agg(${roles.name}) filter (where ${roles.name} is not null), '{}')`,
      })
      .from(userAccounts)
      .innerJoin(user, eq(user.id, userAccounts.userId))
      .leftJoin(employees, eq(employees.id, userAccounts.employeeId))
      .leftJoin(userRoles, eq(userRoles.userId, user.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userAccounts.orgId, viewer.orgId), isNull(userAccounts.deletedAt)))
      .groupBy(
        user.id, user.name, user.email,
        userAccounts.isActive, userAccounts.mustChangePassword, userAccounts.lastLoginAt,
        employees.id, employees.employeeCode, employees.firstName, employees.lastName,
      )
      .orderBy(asc(user.name)),

    db
      .select({ id: roles.id, name: roles.name, code: roles.code })
      .from(roles)
      .where(eq(roles.orgId, viewer.orgId))
      .orderBy(asc(roles.name)),

    // employees with no login yet
    db
      .select({
        id: employees.id,
        label: sql<string>`${employees.firstName} || ' ' || ${employees.lastName} || ' (' || ${employees.employeeCode} || ')'`,
      })
      .from(employees)
      .leftJoin(userAccounts, eq(userAccounts.employeeId, employees.id))
      .where(sql`${employees.orgId} = ${viewer.orgId} and ${employees.deletedAt} is null and ${userAccounts.userId} is null`)
      .orderBy(asc(employees.employeeCode)),
  ]);

  const active = rows.filter((r) => r.isActive).length;
  const noRole = rows.filter((r) => r.roleIds.length === 0).length;

  return (
    <>
      <PageHeader
        title="Users"
        description="A login belongs to one organisation, carries one or more roles, and is usually linked to an employee record. Deleted logins wait in the recycle bin."
        action={
          can(viewer, "admin.recycle.manage") ? (
            <Link href="/admin/recycle-bin?type=user" className="text-xs text-accent hover:underline">
              Deleted logins →
            </Link>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Logins" value={rows.length} tone="accent" />
        <StatTile label="Active" value={active} tone="ok" />
        <StatTile
          label="Disabled"
          value={rows.length - active}
          tone={rows.length - active ? "warn" : "neutral"}
        />
        <StatTile
          label="Without a role"
          value={noRole}
          tone={noRole ? "danger" : "neutral"}
          sub={noRole ? "Cannot see anything" : "All assigned"}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[3fr_2fr]">
        <TableShell>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Employee</Th>
              <Th>Roles</Th>
              <Th>Last sign-in</Th>
              <Th>Status</Th>
              {canManage ? <Th /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <span className="block font-medium text-ink">{r.name}</span>
                  <span className="block text-xs text-ink-faint">{r.email}</span>
                </Td>
                <Td>
                  {r.employeeId ? (
                    <Link
                      href={`/hr/employees/${r.employeeId}`}
                      className="text-accent hover:underline"
                    >
                      {r.employeeName}
                      <span className="ml-1.5 font-mono text-[11px] text-ink-faint">
                        {r.employeeCode}
                      </span>
                    </Link>
                  ) : (
                    <span className="text-ink-faint">Not linked</span>
                  )}
                </Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    {r.roleNames.length === 0 ? (
                      <Badge tone="danger">No role</Badge>
                    ) : (
                      r.roleNames.map((n) => (
                        <Badge key={n} tone="accent">
                          {n}
                        </Badge>
                      ))
                    )}
                  </span>
                </Td>
                <Td className="tabular text-ink-soft">
                  {r.lastLoginAt
                    ? new Date(r.lastLoginAt).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Never"}
                </Td>
                <Td>
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={r.isActive ? "ok" : "neutral"}>
                      {r.isActive ? "Active" : "Disabled"}
                    </Badge>
                    {r.mustChangePassword ? <Badge tone="warn">Must reset</Badge> : null}
                  </span>
                </Td>
                {canManage ? (
                  <Td className="text-right">
                    <div className="flex items-start justify-end gap-1.5">
                      <RoleAssigner
                        userId={r.id}
                        userName={r.name}
                        roles={roleRows}
                        assigned={r.roleIds}
                      />
                      <ToggleUserButton
                        userId={r.id}
                        active={r.isActive}
                        isSelf={r.id === viewer.userId}
                      />
                      <DeleteUserButton userId={r.id} email={r.email} isSelf={r.id === viewer.userId} />
                    </div>
                  </Td>
                ) : null}
              </Tr>
            ))}
          </tbody>
        </TableShell>

        {canManage ? (
          <NewUserForm roles={roleRows} unlinkedEmployees={linkable} />
        ) : (
          <Card>
            <p className="p-4 text-xs text-ink-faint">
              You can see logins but not change them. That needs{" "}
              <code className="font-mono">admin.user.manage</code>.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
