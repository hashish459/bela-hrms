import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { roleGrants, roles, userRoles } from "@/db/schema/core";
import { can, requirePermission } from "@/lib/session";
import { ALL_PERMISSIONS, MODULES } from "@/modules/registry";
import { Badge, Card, PageHeader, StatTile } from "@/components/ui";
import { NewRoleForm, RolePermissionEditor } from "./forms";

export const metadata = { title: "Roles" };

export default async function RolesPage() {
  const viewer = await requirePermission("admin.role.view");
  const canEdit = can(viewer, "admin.role.manage");

  const [roleRows, grantRows, memberCounts] = await Promise.all([
    db.select().from(roles).where(eq(roles.orgId, viewer.orgId)).orderBy(asc(roles.name)),
    db
      .select({ roleId: roleGrants.roleId, permission: roleGrants.permission })
      .from(roleGrants)
      .innerJoin(roles, eq(roles.id, roleGrants.roleId))
      .where(eq(roles.orgId, viewer.orgId)),
    db
      .select({ roleId: userRoles.roleId, n: count() })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(roles.orgId, viewer.orgId))
      .groupBy(userRoles.roleId),
  ]);

  const members = new Map(memberCounts.map((m) => [m.roleId, Number(m.n)]));
  const grantsByRole = new Map<string, string[]>();
  for (const g of grantRows) {
    grantsByRole.set(g.roleId, [...(grantsByRole.get(g.roleId) ?? []), g.permission]);
  }

  const known = new Set(ALL_PERMISSIONS.map((p) => p.key));
  const stale = grantRows.filter((g) => !known.has(g.permission));

  const moduleGroups = MODULES.map((m) => ({
    id: m.id,
    label: m.label,
    permissions: m.permissions.map((p) => ({ key: p.key, label: p.label })),
  }));

  return (
    <>
      <PageHeader
        title="Roles"
        description="Permissions are defined in code and cannot drift; only these grants are data."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Roles" value={roleRows.length} tone="accent" />
        <StatTile label="Permissions defined" value={ALL_PERMISSIONS.length} />
        <StatTile label="Grants" value={grantRows.length} />
        <StatTile
          label="Stale grants"
          value={stale.length}
          tone={stale.length ? "warn" : "neutral"}
          sub={stale.length ? "Ignored at check time" : "None"}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {roleRows.map((r) => (
          <Card key={r.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{r.name}</p>
                <p className="font-mono text-[11px] text-ink-faint">{r.code}</p>
              </div>
              {r.isSystem ? <Badge tone="neutral">System</Badge> : null}
            </div>
            <p className="tabular mt-2 text-xs text-ink-soft">
              {(grantsByRole.get(r.id) ?? []).length} permissions · {members.get(r.id) ?? 0} member
              {(members.get(r.id) ?? 0) === 1 ? "" : "s"}
            </p>
            {r.description ? (
              <p className="mt-1 text-[11px] text-ink-faint">{r.description}</p>
            ) : null}
          </Card>
        ))}
      </div>

      {canEdit ? (
        <div className="mt-4 max-w-md">
          <NewRoleForm />
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-4">
        {roleRows.map((r) => (
          <RolePermissionEditor
            key={r.id}
            roleId={r.id}
            roleName={r.name}
            isSystem={r.isSystem}
            modules={moduleGroups}
            granted={grantsByRole.get(r.id) ?? []}
            canEdit={canEdit}
          />
        ))}
      </div>

      {stale.length > 0 ? (
        <Card className="mt-4 border-warn/40">
          <div className="p-4">
            <p className="text-sm font-semibold text-ink">
              Grants for permissions this build no longer defines
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              Ignored at check time. Saving the role removes them.
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {stale.map((g) => (
                <li key={`${g.roleId}:${g.permission}`}>
                  <Badge tone="warn">{g.permission}</Badge>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}
    </>
  );
}
