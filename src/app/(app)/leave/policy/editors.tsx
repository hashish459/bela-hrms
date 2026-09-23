"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { SideDrawer } from "@/components/side-drawer";
import { useConfirmSubmit, useToastedAction } from "@/components/feedback";
import { cn } from "@/lib/utils";
import { deleteLeaveGroupAction, saveEntitlementAction, saveLeaveGroupAction, type AdminState } from "../admin-actions";

const initial: AdminState = {};

/**
 * One cell of the entitlement matrix, edited in place: click, type, Enter.
 * A blank figure removes the override and the leave type's default applies.
 */
export function EntitlementCell({
  leaveTypeId,
  employmentTypeId,
  days,
  maxAccumulation,
  fallback,
  label,
}: {
  leaveTypeId: string;
  employmentTypeId: string;
  days: number | null;
  maxAccumulation: number | null;
  fallback: number;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const save = useToastedAction(saveEntitlementAction, { errors: true });
  const [state, action, pending] = useActionState(async (p: AdminState, fd: FormData) => {
    const r = await save(p, fd);
    if (r.ok) setOpen(false);
    return r;
  }, initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.select();
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group/cell tabular inline-flex min-w-16 items-center justify-end gap-1 rounded px-2 py-1 transition-colors hover:bg-accent-soft",
          days === null ? "text-ink-faint" : "font-medium text-ink",
        )}
        title={`Edit ${label}`}
        aria-label={`Edit ${label}: ${days === null ? `default ${fallback}` : `${days} days`}`}
      >
        {days === null ? <span className="italic">{fallback}</span> : days}
        {maxAccumulation !== null ? <span className="text-[10px] text-ink-faint">/{maxAccumulation}</span> : null}
        <Pencil className="size-3 opacity-0 transition-opacity group-hover/cell:opacity-60" aria-hidden />
      </button>
    );
  }

  return (
    <form
      action={action}
      className="inline-flex items-center justify-end gap-1"
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <input type="hidden" name="leaveTypeId" value={leaveTypeId} />
      <input type="hidden" name="employmentTypeId" value={employmentTypeId} />
      <input
        ref={input}
        name="daysAllowed"
        type="number"
        min={0}
        max={366}
        step="0.5"
        defaultValue={days ?? ""}
        placeholder={String(fallback)}
        aria-label={`${label} days`}
        aria-invalid={Boolean(state.fieldErrors?.daysAllowed)}
        className="tabular w-16 rounded border border-accent bg-surface px-1.5 py-1 text-right text-sm"
      />
      <input
        name="maxAccumulationDays"
        type="number"
        min={0}
        max={999}
        step="0.5"
        defaultValue={maxAccumulation ?? ""}
        placeholder="cap"
        title="Most that can be held (optional)"
        aria-label={`${label} accumulation ceiling`}
        className="tabular w-14 rounded border border-line bg-surface px-1.5 py-1 text-right text-xs"
      />
      <button type="submit" disabled={pending} className="grid size-7 place-items-center rounded bg-accent text-on-accent" aria-label="Save">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      </button>
      {days !== null ? (
        <button
          type="submit"
          disabled={pending}
          onClick={() => {
            if (input.current) input.current.value = "";
          }}
          className="grid size-7 place-items-center rounded text-ink-faint hover:bg-sunk hover:text-ink"
          aria-label="Back to the type's default"
          title="Back to the type's default"
        >
          <RotateCcw className="size-3.5" />
        </button>
      ) : null}
      <button type="button" onClick={() => setOpen(false)} className="grid size-7 place-items-center rounded text-ink-faint hover:bg-sunk" aria-label="Cancel">
        <X className="size-3.5" />
      </button>
    </form>
  );
}

export type GroupRow = { id: string; code: string; name: string; nameNepali: string | null; remarks: string | null; sortOrder: number; types: { name: string; colour: string }[] };

function GroupDrawer({ group, onClose }: { group: GroupRow | null; onClose: () => void }) {
  const save = useToastedAction(saveLeaveGroupAction);
  const [state, action, pending] = useActionState(async (p: AdminState, fd: FormData) => {
    const r = await save(p, fd);
    if (r.ok) onClose();
    return r;
  }, initial);
  const err = (f: string) => state.fieldErrors?.[f];
  return (
    <SideDrawer
      title={group ? `Edit ${group.name}` : "New leave group"}
      subtitle="A reporting bucket several leave types share."
      onClose={onClose}
      action={action}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save group
          </Button>
        </>
      }
    >
      {group ? <input type="hidden" name="id" value={group.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {state.error && !state.fieldErrors ? <p className="text-sm text-danger sm:col-span-2">{state.error}</p> : null}
        <Field label="Name" required error={err("name")} className="sm:col-span-2">
          <Input name="name" defaultValue={group?.name ?? ""} maxLength={80} placeholder="Statutory leave" />
        </Field>
        <Field label="Code" required error={err("code")}>
          <Input name="code" defaultValue={group?.code ?? ""} maxLength={16} className="font-mono uppercase" placeholder="STAT" />
        </Field>
        <Field label="Order" error={err("sortOrder")}>
          <Input name="sortOrder" type="number" min={0} max={999} defaultValue={group?.sortOrder ?? 0} className="tabular" />
        </Field>
        <Field label="Name in Nepali" error={err("nameNepali")} className="sm:col-span-2">
          <Input name="nameNepali" defaultValue={group?.nameNepali ?? ""} maxLength={80} />
        </Field>
        <Field label="Remarks" error={err("remarks")} className="sm:col-span-2">
          <Textarea name="remarks" defaultValue={group?.remarks ?? ""} maxLength={300} />
        </Field>
        <p className="text-xs text-ink-faint sm:col-span-2">Assign leave types to the group from each type&apos;s Basics tab.</p>
      </div>
    </SideDrawer>
  );
}

function DeleteGroup({ group }: { group: GroupRow }) {
  const [, action, pending] = useActionState(useToastedAction(deleteLeaveGroupAction, { errors: true }), initial);
  const ask = useConfirmSubmit({
    title: `Delete ${group.name}?`,
    body: group.types.length ? `Its ${group.types.length} leave type(s) stay exactly as they are, just without a group.` : "It has no leave types.",
    confirmLabel: "Delete group",
    tone: "danger",
  });
  return (
    <form action={action} onSubmit={ask}>
      <input type="hidden" name="id" value={group.id} />
      <button type="submit" disabled={pending} className="grid size-8 place-items-center rounded-md text-ink-faint hover:bg-danger-soft hover:text-danger" aria-label={`Delete ${group.name}`}>
        <Trash2 className="size-4" />
      </button>
    </form>
  );
}

export function GroupsPanel({ groups }: { groups: GroupRow[] }) {
  const [editing, setEditing] = useState<GroupRow | null | "new">(null);
  return (
    <div className="p-4">
      {groups.length === 0 ? (
        <p className="mb-3 text-sm text-ink-faint">No leave groups yet.</p>
      ) : (
        <ul className="mb-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <li key={g.id} className="flex items-start gap-2 rounded-md border border-line p-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  {g.name}
                  <span className="rounded bg-sunk px-1.5 font-mono text-[10px] text-ink-soft">{g.code}</span>
                </p>
                {g.remarks ? <p className="mt-0.5 line-clamp-2 text-xs text-ink-faint">{g.remarks}</p> : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  {g.types.length ? (
                    g.types.map((t) => (
                      <span key={t.name} className="flex items-center gap-1 rounded-full bg-sunk px-2 py-0.5 text-[11px] text-ink-soft">
                        <span className="size-1.5 rounded-full" style={{ background: t.colour }} aria-hidden />
                        {t.name}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-ink-faint">No leave types</span>
                  )}
                </div>
              </div>
              <button type="button" onClick={() => setEditing(g)} className="grid size-8 place-items-center rounded-md text-ink-faint hover:bg-sunk hover:text-ink" aria-label={`Edit ${g.name}`}>
                <Pencil className="size-4" />
              </button>
              <DeleteGroup group={g} />
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="secondary" onClick={() => setEditing("new")}>
        <Plus className="size-4" />
        New group
      </Button>
      {editing ? <GroupDrawer group={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
