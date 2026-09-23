"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Power,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button, EmptyState, Field, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  deleteAction,
  saveMasterAction,
  setActiveAction,
  type MasterState,
} from "./masters/actions";

/**
 * The master-data editor: one component behind every organisation screen —
 * branches, departments, designations, grades, employment types, and the six
 * structure kinds.
 *
 * The table's cells are rendered on the server and handed in as nodes, so each
 * screen keeps full control of how a row reads; this component owns only the
 * behaviour every screen shares — search, the active/inactive filter, the
 * slide-over form, and the row actions with their guards.
 *
 * Rules live on the server. The client disables what it knows will be refused
 * (deleting something in use) so the button tells the truth, but the service
 * re-checks everything inside its transaction.
 */

export type FieldValue = string | number | boolean | null;

export type FieldDef = {
  name: string;
  label: string;
  kind: "text" | "textarea" | "number" | "select" | "checkbox" | "date";
  required?: boolean;
  hint?: string;
  placeholder?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: string;
  /** Takes the full width of the two-column form. */
  wide?: boolean;
  mono?: boolean;
  options?: { value: string; label: string }[];
  /** Label of the empty choice in a select. */
  emptyLabel?: string;
  /** For a parent select: hide the row being edited and everything beneath it. */
  excludeTree?: boolean;
};

export type EditorRow = {
  id: string;
  code: string;
  isActive: boolean;
  /** Pre-rendered cells, one per column. */
  cells: ReactNode[];
  /** Initial form values when editing. */
  values: Record<string, FieldValue>;
  /** Lower-cased text the search box matches against. */
  search: string;
  /** Ids that may not become this row's parent: itself and its descendants. */
  tree?: string[];
  /** Why it cannot be deleted, when it cannot. */
  deleteBlocked?: string | null;
  /** Why it cannot be deactivated, when that is already known. */
  deactivateBlocked?: string | null;
};

type Props = {
  /** The record type the actions dispatch on, e.g. "branch" or "division". */
  kind: string;
  noun: string;
  /** Spelled out — "branches", "categories" — rather than guessed with an "s". */
  plural: string;
  /** Revalidated after a write so the server re-renders the table. */
  path: string;
  columns: { header: string; align?: "right" }[];
  rows: EditorRow[];
  fields: FieldDef[];
  canManage: boolean;
  /** Shown at the top of the form. */
  formNote?: string;
  /** Values a new record starts with. */
  defaults?: Record<string, FieldValue>;
};

const initial: MasterState = {};

function Banner({ state }: { state: MasterState }) {
  if (!state.error) return null;
  return (
    <p className="flex items-start gap-1.5 rounded bg-danger-soft px-3 py-2 text-sm text-danger">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {state.error}
    </p>
  );
}

/** A short-lived confirmation in the corner, so a save is visibly done. */
function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDone, 2600);
    return () => window.clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-[60] flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink shadow-lg"
    >
      <CheckCircle2 className="size-4 text-ok" aria-hidden />
      {message}
    </div>
  );
}

export function MasterEditor({ kind, noun, plural, path, columns, rows, fields, canManage, formNote, defaults }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "all">("active");
  const [editing, setEditing] = useState<EditorRow | "new" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);
  // remounts the form, so every open starts from that record's values
  const [formKey, setFormKey] = useState(0);

  const counts = useMemo(
    () => ({
      active: rows.filter((r) => r.isActive).length,
      inactive: rows.filter((r) => !r.isActive).length,
      all: rows.length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (status === "all" || (status === "active") === r.isActive) && (!q || r.search.includes(q)),
    );
  }, [rows, query, status]);

  const open = (row: EditorRow | "new") => {
    setEditing(row);
    setFormKey((k) => k + 1);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by code or name"
            aria-label={`Search ${plural}`}
            className="w-64 rounded border border-line bg-surface py-1.5 pr-2.5 pl-7 text-sm text-ink placeholder:text-ink-faint"
          />
        </div>

        <div className="inline-flex rounded border border-line bg-surface p-0.5" role="tablist" aria-label="Status">
          {(["active", "inactive", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                "rounded px-2.5 py-1 text-xs capitalize transition-colors",
                status === s ? "bg-accent-soft font-medium text-accent" : "text-ink-soft hover:text-ink",
              )}
            >
              {s}
              <span className="tabular ml-1 text-ink-faint">{counts[s]}</span>
            </button>
          ))}
        </div>

        {canManage ? (
          <Button type="button" className="ml-auto" onClick={() => open("new")}>
            <Plus className="size-4" aria-hidden />
            Add {noun}
          </Button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-md border border-line bg-surface">
        {visible.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? `No ${plural} yet` : `No ${plural} match`}
            hint={
              rows.length === 0
                ? canManage
                  ? `Add the first ${noun} to start building the structure.`
                  : undefined
                : "Try another search, or switch the status filter."
            }
          />
        ) : (
          <table className="w-full min-w-[42rem] border-collapse text-sm">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.header}
                    className={cn(
                      "border-b border-line bg-sunk px-3 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-ink-faint uppercase",
                      c.align === "right" && "text-right",
                    )}
                  >
                    {c.header}
                  </th>
                ))}
                {canManage ? <th className="w-px border-b border-line bg-sunk px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} className={cn("group hover:bg-sunk/60", !row.isActive && "text-ink-faint")}>
                  {row.cells.map((cell, i) => (
                    <td
                      key={i}
                      className={cn(
                        "border-b border-line-soft px-3 py-2 align-middle",
                        columns[i]?.align === "right" && "text-right",
                        !row.isActive && "opacity-60",
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                  {canManage ? (
                    <td className="border-b border-line-soft px-2 py-1 text-right whitespace-nowrap">
                      <RowActions row={row} kind={kind} noun={noun} path={path} onEdit={() => open(row)} onDone={setToast} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing ? (
        <Drawer
          key={formKey}
          kind={kind}
          noun={noun}
          path={path}
          fields={fields}
          row={editing === "new" ? null : editing}
          rows={rows}
          defaults={defaults}
          note={formNote}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setToast(message);
          }}
        />
      ) : null}

      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}

/* ------------------------------------------------------------ row actions */

function RowActions({
  row,
  kind,
  noun,
  path,
  onEdit,
  onDone,
}: {
  row: EditorRow;
  kind: string;
  noun: string;
  path: string;
  onEdit: () => void;
  onDone: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  /*
   * Success is reported from inside the action, not from an effect on its
   * result. Deactivating or deleting a row usually removes it from the list in
   * the same render the result arrives in, so this component is gone before an
   * effect could run — and the person would get no confirmation at all. The
   * callback belongs to the parent, which is still mounted.
   */
  const [activeState, toggle, toggling] = useActionState(async (prev: MasterState, formData: FormData) => {
    const result = await setActiveAction(prev, formData);
    if (result.ok) onDone(`${row.code}: ${result.ok.toLowerCase()}`);
    return result;
  }, initial);
  const [deleteState, remove, deleting] = useActionState(async (prev: MasterState, formData: FormData) => {
    const result = await deleteAction(prev, formData);
    if (result.ok) {
      setConfirming(false);
      onDone(`${row.code}: ${result.ok.toLowerCase()}`);
    }
    return result;
  }, initial);

  const error = activeState.error ?? deleteState.error;
  const hidden = (
    <>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="code" value={row.code} />
      <input type="hidden" name="path" value={path} />
    </>
  );

  const iconButton =
    "inline-flex size-7 items-center justify-center rounded text-ink-faint transition-colors hover:bg-sunk hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";

  if (confirming) {
    return (
      <form action={remove} className="inline-flex items-center gap-1.5">
        {hidden}
        <span className="text-xs text-danger">Delete {row.code}?</span>
        <Button type="submit" variant="danger" className="px-2 py-1 text-xs" disabled={deleting}>
          {deleting ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
          Delete
        </Button>
        <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => setConfirming(false)}>
          Keep
        </Button>
      </form>
    );
  }

  return (
    <div className="inline-flex items-center gap-0.5">
      {error ? (
        <span className="mr-1 max-w-64 truncate text-xs text-danger" title={error}>
          {error}
        </span>
      ) : null}

      <button type="button" onClick={onEdit} className={iconButton} aria-label={`Edit ${row.code}`} title="Edit">
        <Pencil className="size-3.5" />
      </button>

      <form action={toggle} className="inline-flex">
        {hidden}
        <input type="hidden" name="active" value={row.isActive ? "false" : "true"} />
        <button
          type="submit"
          disabled={toggling || (row.isActive && !!row.deactivateBlocked)}
          className={iconButton}
          aria-label={`${row.isActive ? "Deactivate" : "Reactivate"} ${row.code}`}
          title={row.isActive ? (row.deactivateBlocked ?? "Deactivate") : "Reactivate"}
        >
          {toggling ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : row.isActive ? (
            <Power className="size-3.5" />
          ) : (
            <RotateCcw className="size-3.5" />
          )}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={!!row.deleteBlocked}
        className={cn(iconButton, "hover:text-danger")}
        aria-label={`Delete ${row.code}`}
        title={row.deleteBlocked ?? `Delete this ${noun} — nothing refers to it`}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- drawer */

function Drawer({
  kind,
  noun,
  path,
  fields,
  row,
  rows,
  defaults,
  note,
  onClose,
  onSaved,
}: {
  kind: string;
  noun: string;
  path: string;
  fields: FieldDef[];
  row: EditorRow | null;
  rows: EditorRow[];
  defaults?: Record<string, FieldValue>;
  note?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [state, action, pending] = useActionState(saveMasterAction, initial);
  const firstInput = useRef<HTMLInputElement>(null);
  const values = row?.values ?? defaults ?? {};
  const blocked = new Set(row?.tree ?? []);

  useEffect(() => {
    firstInput.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (state.at && state.ok) onSaved(row ? `${row.code} saved` : `${noun[0].toUpperCase()}${noun.slice(1)} added`);
  }, [state.at, state.ok, onSaved, row, noun]);

  const errorFor = (name: string) => state.fieldErrors?.[name];
  // a field error with no field on this form to sit beside still has to be seen
  const stray = Object.entries(state.fieldErrors ?? {})
    .filter(([name]) => !fields.some((f) => f.name === name))
    .map(([, message]) => message);

  return (
    <div className="fixed inset-0 z-50 print:hidden" role="dialog" aria-modal="true" aria-label={row ? `Edit ${noun}` : `Add ${noun}`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/30" />

      <form
        action={action}
        className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col border-l border-line bg-surface shadow-2xl"
      >
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="path" value={path} />
        {row ? <input type="hidden" name="id" value={row.id} /> : null}

        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">{row ? `Edit ${noun}` : `Add ${noun}`}</h2>
            {row ? <p className="font-mono text-xs text-ink-faint">{row.code}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {note ? <p className="mb-4 rounded bg-sunk px-3 py-2 text-xs text-ink-soft">{note}</p> : null}
          <div className="mb-3 flex flex-col gap-2">
            <Banner state={state} />
            {stray.map((message) => (
              <Banner key={message} state={{ error: message }} />
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f, i) => {
              const value = values[f.name];
              const common = {
                name: f.name,
                required: f.required,
                "aria-invalid": errorFor(f.name) ? true : undefined,
              };

              if (f.kind === "checkbox") {
                return (
                  <label key={f.name} className="flex items-start gap-2 sm:col-span-2">
                    <input
                      type="checkbox"
                      name={f.name}
                      defaultChecked={value === true}
                      className="mt-0.5 size-4 rounded border-line accent-[var(--color-accent)]"
                    />
                    <span>
                      <span className="text-sm text-ink">{f.label}</span>
                      {errorFor(f.name) ? (
                        <span className="block text-xs text-danger">{errorFor(f.name)}</span>
                      ) : f.hint ? (
                        <span className="block text-xs text-ink-faint">{f.hint}</span>
                      ) : null}
                    </span>
                  </label>
                );
              }

              let control: ReactNode;
              if (f.kind === "select") {
                const options = (f.options ?? []).filter((o) => !(f.excludeTree && blocked.has(o.value)));
                control = (
                  <Select {...common} defaultValue={value === null || value === undefined ? "" : String(value)}>
                    <option value="">{f.emptyLabel ?? "Select…"}</option>
                    {options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                );
              } else if (f.kind === "textarea") {
                control = (
                  <Textarea {...common} rows={3} maxLength={f.maxLength} defaultValue={value === null ? "" : String(value ?? "")} />
                );
              } else {
                control = (
                  <Input
                    {...common}
                    ref={i === 0 ? firstInput : undefined}
                    type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
                    inputMode={f.kind === "number" ? "decimal" : undefined}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    maxLength={f.maxLength}
                    placeholder={f.placeholder}
                    defaultValue={value === null || value === undefined ? "" : String(value)}
                    className={f.mono ? "font-mono" : undefined}
                  />
                );
              }

              return (
                <Field
                  key={f.name}
                  label={f.label}
                  required={f.required}
                  hint={f.hint}
                  error={errorFor(f.name)}
                  className={f.wide ? "sm:col-span-2" : undefined}
                >
                  {control}
                </Field>
              );
            })}
          </div>

          {row && rows.length > 0 && !row.isActive ? (
            <p className="mt-4 text-xs text-ink-faint">
              This {noun} is inactive. Saving keeps it inactive; reactivate it from the list.
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {row ? "Save changes" : `Add ${noun}`}
          </Button>
        </footer>
      </form>
    </div>
  );
}
