"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, UserPlus } from "lucide-react";
import { createUser, setUserActive, setUserRoles, type ActionState } from "../actions";
import { Button, Card, CardHeader, Field, Input, Select } from "@/components/ui";

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

export type RoleOption = { id: string; name: string; code: string };

export function NewUserForm({
  roles,
  unlinkedEmployees,
}: {
  roles: RoleOption[];
  unlinkedEmployees: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(createUser, initial);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const err = (n: string) => state.fieldErrors?.[n];

  return (
    <Card>
      <CardHeader
        title="Add a login"
        description="Accounts are created here, never self-registered. The person is asked to change the password on first sign-in."
      />
      <form action={action} className="flex flex-col gap-4 p-4">
        <Notice state={state} />

        <Field label="Full name" required error={err("name")}>
          <Input name="name" placeholder="Rita Tamang" />
        </Field>

        <Field label="Work email" required error={err("email")}>
          <Input name="email" type="email" placeholder="rita.tamang@bela.example.np" />
        </Field>

        <Field
          label="Temporary password"
          required
          error={err("password")}
          hint="At least 8 characters, with a letter and a digit."
        >
          <Input name="password" type="text" autoComplete="off" placeholder="Welcome@2083" />
        </Field>

        <Field
          label="Employee record"
          error={err("employeeId")}
          hint="Links the login to a person, so leave and attendance know who it is."
        >
          <Select name="employeeId" defaultValue="">
            <option value="">Not linked (administrator account)</option>
            {unlinkedEmployees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={`Roles (${checked.size} selected)`} required error={err("roleIds")}>
          <ul className="flex flex-col gap-0.5 rounded border border-line p-1.5">
            {roles.map((r) => (
              <li key={r.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-sunk">
                  <input
                    type="checkbox"
                    name="roleIds"
                    value={r.id}
                    checked={checked.has(r.id)}
                    onChange={() =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (next.has(r.id)) next.delete(r.id);
                        else next.add(r.id);
                        return next;
                      })
                    }
                    className="accent-accent"
                  />
                  <span className="text-ink">{r.name}</span>
                  <span className="font-mono text-[11px] text-ink-faint">{r.code}</span>
                </label>
              </li>
            ))}
          </ul>
        </Field>

        <div>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <UserPlus className="size-4" />
            )}
            {pending ? "Creating" : "Create login"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function ToggleUserButton({
  userId,
  active,
  isSelf,
}: {
  userId: string;
  active: boolean;
  isSelf: boolean;
}) {
  const [state, action, pending] = useActionState(setUserActive, initial);
  if (state.ok) return <span className="text-[11px] text-ok">Updated</span>;
  if (isSelf) return <span className="text-[11px] text-ink-faint">You</span>;

  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-line px-2 py-1 text-xs text-ink-soft hover:bg-sunk hover:text-ink disabled:opacity-50"
        title={state.message && !state.ok ? state.message : undefined}
      >
        {pending ? "…" : active ? "Disable" : "Enable"}
      </button>
    </form>
  );
}

export function RoleAssigner({
  userId,
  userName,
  roles,
  assigned,
}: {
  userId: string;
  userName: string;
  roles: RoleOption[];
  assigned: string[];
}) {
  const [state, action, pending] = useActionState(setUserRoles, initial);
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(assigned));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-line px-2 py-1 text-xs text-ink-soft hover:bg-sunk hover:text-ink"
      >
        Change roles
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col items-end gap-1.5">
      <input type="hidden" name="userId" value={userId} />
      <ul className="flex flex-col gap-0.5 rounded border border-line bg-surface p-1.5 text-left">
        {roles.map((r) => (
          <li key={r.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-xs hover:bg-sunk">
              <input
                type="checkbox"
                name="roleIds"
                value={r.id}
                checked={checked.has(r.id)}
                onChange={() =>
                  setChecked((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.id)) next.delete(r.id);
                    else next.add(r.id);
                    return next;
                  })
                }
                className="accent-accent"
              />
              <span className="text-ink">{r.name}</span>
            </label>
          </li>
        ))}
      </ul>

      {state.message && !state.ok ? (
        <span className="max-w-48 text-[11px] text-danger">{state.message}</span>
      ) : null}

      <div className="flex gap-1.5">
        <Button type="submit" disabled={pending} className="px-2 py-1 text-xs">
          {pending ? <Loader2 className="size-3 animate-spin" /> : null}
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="px-2 py-1 text-xs"
          onClick={(e) => {
            e.preventDefault();
            setChecked(new Set(assigned));
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
      <span className="sr-only">Roles for {userName}</span>
    </form>
  );
}
