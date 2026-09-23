"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, CardHeader, EmptyState } from "@/components/ui";
import { SideDrawer } from "@/components/side-drawer";
import { SectionFields } from "@/components/section-fields";
import { SECTION_BY_KEY, displayValue, type SectionKey } from "@/modules/people/profile-fields";
import { removeRowAction, saveRowAction, type RowState } from "../record-actions";
import { useConfirmSubmit } from "@/components/feedback";

type Value = string | number | boolean | null;
export type RecordRow = { id: string; values: Record<string, Value> };

const initial: RowState = {};

/**
 * One list on a personnel file — family, qualifications or previous employment —
 * with add, edit and remove for somebody who holds `hr.employee.update`. The
 * columns shown are the first few fields of the section definition; everything
 * else is in the drawer.
 */
export function RecordRows({
  section,
  employeeId,
  rows,
  canEdit,
  columns,
  title,
  description,
}: {
  section: Extract<SectionKey, "family" | "qualification" | "experience">;
  employeeId: string;
  rows: RecordRow[];
  canEdit: boolean;
  /** Field names to show as columns. */
  columns: string[];
  title: string;
  description?: string;
}) {
  const def = SECTION_BY_KEY.get(section)!;
  const [editing, setEditing] = useState<RecordRow | "new" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [removeState, removeAction, removing] = useActionState(removeRowAction, initial);
  const askRemove = useConfirmSubmit({ title: "Remove this entry?", body: "It goes to the recycle bin, where an administrator can restore it.", confirmLabel: "Remove", tone: "danger" });

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(t);
  }, [flash]);

  const fieldOf = (name: string) => def.fields.find((f) => f.name === name);
  const message = flash ?? removeState.ok ?? null;

  return (
    <>
      <CardHeader
        title={title}
        description={description}
        action={
          canEdit ? (
            <Button variant="secondary" onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              Add
            </Button>
          ) : undefined
        }
      />

      {message || removeState.error ? (
        <p
          className={`mx-4 mt-3 flex items-center gap-1.5 rounded px-3 py-2 text-xs ${
            removeState.error && !flash ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok"
          }`}
          role="status"
        >
          {removeState.error && !flash ? <AlertCircle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
          {flash ?? removeState.error ?? message}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title="Nothing recorded" hint={canEdit ? "Use Add to put the first entry on file." : undefined} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-ink-faint uppercase">
                {columns.map((c) => (
                  <th key={c} className="border-b border-line bg-sunk px-3 py-2 font-medium">
                    {fieldOf(c)?.label ?? c}
                  </th>
                ))}
                {canEdit ? <th className="w-20 border-b border-line bg-sunk px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-sunk/60">
                  {columns.map((c, i) => (
                    <td key={c} className={`border-b border-line-soft px-3 py-2 ${i === 0 ? "font-medium text-ink" : "text-ink-soft"}`}>
                      {displayValue(fieldOf(c), r.values[c])}
                    </td>
                  ))}
                  {canEdit ? (
                    <td className="border-b border-line-soft px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditing(r)}
                          className="rounded p-1 text-ink-faint hover:bg-sunk hover:text-ink"
                          aria-label={`Edit ${String(r.values[columns[0]] ?? "entry")}`}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <form
                          action={removeAction}
                          onSubmit={askRemove}
                        >
                          <input type="hidden" name="section" value={section} />
                          <input type="hidden" name="rowId" value={r.id} />
                          <button
                            type="submit"
                            disabled={removing}
                            className="rounded p-1 text-ink-faint hover:bg-danger-soft hover:text-danger"
                            aria-label={`Remove ${String(r.values[columns[0]] ?? "entry")}`}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </form>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <RowDrawer
          section={section}
          employeeId={employeeId}
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(m) => {
            setEditing(null);
            setFlash(m);
          }}
        />
      ) : null}
    </>
  );
}

function RowDrawer({
  section,
  employeeId,
  row,
  onClose,
  onSaved,
}: {
  section: Extract<SectionKey, "family" | "qualification" | "experience">;
  employeeId: string;
  row: RecordRow | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const def = SECTION_BY_KEY.get(section)!;
  const [state, action, pending] = useActionState(saveRowAction, initial);

  useEffect(() => {
    if (state.at && state.ok) onSaved(state.ok);
  }, [state.at, state.ok, onSaved]);

  return (
    <SideDrawer
      title={row ? `Edit ${def.label.toLowerCase()}` : `Add ${def.label.toLowerCase()}`}
      subtitle={def.description}
      onClose={onClose}
      action={action}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {row ? "Save" : "Add"}
          </Button>
        </>
      }
    >
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="employeeId" value={employeeId} />
      {row ? <input type="hidden" name="rowId" value={row.id} /> : null}
      {state.error ? (
        <p className="mb-3 flex items-center gap-1.5 rounded bg-danger-soft px-3 py-2 text-xs text-danger">
          <AlertCircle className="size-3.5" />
          {state.error}
        </p>
      ) : null}
      <SectionFields fields={def.fields} values={row?.values} errors={state.fieldErrors} />
    </SideDrawer>
  );
}
