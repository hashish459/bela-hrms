"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Plus, Save } from "lucide-react";
import { createRole, setRoleGrants, type ActionState } from "../actions";
import { Badge, Button, Card, CardHeader, Field, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

const initial: ActionState = { ok: false };

function Notice({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p
      className={`flex items-start gap-1.5 rounded px-3 py-2 text-sm ${
        state.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"
      }`}
    >
      {state.ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      ) : (
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
      )}
      {state.message}
    </p>
  );
}

export function NewRoleForm() {
  const [state, action, pending] = useActionState(createRole, initial);
  const err = (n: string) => state.fieldErrors?.[n];

  return (
    <Card>
      <CardHeader
        title="Add a role"
        description="A new role starts with no permissions. Grant them below once it exists."
      />
      <form action={action} className="flex flex-col gap-4 p-4">
        <Notice state={state} />
        <Field label="Code" required error={err("code")} hint="Lower case, e.g. plant_supervisor">
          <Input name="code" placeholder="plant_supervisor" className="font-mono" />
        </Field>
        <Field label="Name" required error={err("name")}>
          <Input name="name" placeholder="Plant Supervisor" />
        </Field>
        <Field label="Description" error={err("description")}>
          <Input name="description" placeholder="Shift supervisors at the Balaju plant" />
        </Field>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {pending ? "Creating" : "Create role"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export type PermissionRow = { key: string; label: string };
export type ModuleGroup = { id: string; label: string; permissions: PermissionRow[] };

/**
 * Editable permission matrix for one role.
 *
 * Submitting replaces the role's grants with exactly what is ticked, so an
 * unticked box is a revoke — that is why the form posts the whole set rather
 * than a diff.
 */
export function RolePermissionEditor({
  roleId,
  roleName,
  isSystem,
  modules,
  granted,
  canEdit,
}: {
  roleId: string;
  roleName: string;
  isSystem: boolean;
  modules: ModuleGroup[];
  granted: string[];
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(setRoleGrants, initial);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(granted));

  const total = modules.reduce((a, m) => a + m.permissions.length, 0);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleModule(m: ModuleGroup, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of m.permissions) {
        if (on) next.add(p.key);
        else next.delete(p.key);
      }
      return next;
    });
  }

  return (
    <Card>
      <CardHeader
        title={roleName}
        description={`${selected.size} of ${total} permissions`}
        action={
          isSystem ? <Badge tone="neutral">System role</Badge> : <Badge tone="accent">Custom</Badge>
        }
      />
      <form action={action} className="flex flex-col gap-3 p-4">
        <input type="hidden" name="roleId" value={roleId} />
        <Notice state={state} />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((m) => {
            const on = m.permissions.filter((p) => selected.has(p.key)).length;
            const all = on === m.permissions.length;
            return (
              <div key={m.id} className="rounded border border-line-soft">
                <div className="flex items-center justify-between gap-2 border-b border-line-soft bg-sunk px-2.5 py-1.5">
                  <span className="text-xs font-medium text-ink">{m.label}</span>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        toggleModule(m, !all);
                      }}
                      className="text-[11px] text-ink-faint hover:text-accent"
                    >
                      {all ? "none" : "all"}
                    </button>
                  ) : (
                    <span className="tabular text-[11px] text-ink-faint">
                      {on}/{m.permissions.length}
                    </span>
                  )}
                </div>
                <ul className="flex flex-col p-1.5">
                  {m.permissions.map((p) => {
                    const checked = selected.has(p.key);
                    return (
                      <li key={p.key}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-xs",
                            canEdit ? "hover:bg-sunk" : "cursor-default",
                          )}
                        >
                          <input
                            type="checkbox"
                            name="permissions"
                            value={p.key}
                            checked={checked}
                            disabled={!canEdit}
                            onChange={() => toggle(p.key)}
                            className="mt-0.5 accent-accent"
                          />
                          <span className="min-w-0">
                            <span className={checked ? "text-ink" : "text-ink-soft"}>{p.label}</span>
                            <span className="block font-mono text-[10px] text-ink-faint">
                              {p.key}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {pending ? "Saving" : "Save permissions"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={(e) => {
                e.preventDefault();
                setSelected(new Set(granted));
              }}
            >
              Reset
            </Button>
            <span className="text-[11px] text-ink-faint">
              Unticked boxes are revoked — the whole set is saved.
            </span>
          </div>
        ) : (
          <p className="text-[11px] text-ink-faint">
            You can see this matrix but not change it. That needs{" "}
            <code className="font-mono">admin.role.manage</code>.
          </p>
        )}
      </form>
    </Card>
  );
}
