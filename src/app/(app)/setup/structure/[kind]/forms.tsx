"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { retireUnit, saveUnit, type ActionState } from "../actions";

const initial: ActionState = {};

export type ParentOption = { id: string; label: string };

export type KindConfig = {
  kind: string;
  /** Route segment, so the action revalidates the page it came from. */
  slug: string;
  singular: string;
  parentLabel: string | null;
  parentRequired: boolean;
  showDates: boolean;
  showGeography: boolean;
};

function Feedback({ state }: { state: ActionState }) {
  const message = state.ok ?? state.error;
  if (!message) return null;
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
      {message}
    </p>
  );
}

/**
 * One form for six kinds of unit.
 *
 * The legacy system shipped a separate Add/Edit screen per kind — Division,
 * Business Unit, Sub Business Unit, Functional Category, Project, Location —
 * and they drifted: two validated the code length, one allowed duplicates, and
 * the Project screen was the only one that could set dates. A single form
 * configured by kind cannot drift from itself.
 */
export function UnitForm({ config, parents }: { config: KindConfig; parents: ParentOption[] }) {
  const [state, action, pending] = useActionState(saveUnit, initial);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          Add {config.singular}
        </Button>
        {state.ok ? <span className="text-sm text-ok">{state.ok}</span> : null}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader
        title={`Add ${config.singular}`}
        description={
          config.parentRequired
            ? `Must sit under a ${config.parentLabel}. The service refuses any other parent, so the tree cannot be malformed.`
            : "A root of its own tree."
        }
        action={
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-ink-faint transition-colors hover:text-ink"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        }
      />
      <form action={action} className="grid gap-4 p-4 sm:grid-cols-2">
        <input type="hidden" name="kind" value={config.kind} />
        <input type="hidden" name="slug" value={config.slug} />

        <div className="sm:col-span-2">
          <Feedback state={state} />
        </div>

        <Field label="Code" required error={state.field === "code" ? state.error : undefined}>
          <Input name="code" placeholder="01" maxLength={30} required />
        </Field>

        <Field label="Name" required error={state.field === "name" ? state.error : undefined}>
          <Input name="name" placeholder={`${config.singular} name`} maxLength={160} required />
        </Field>

        <Field label="Name (Nepali)">
          <Input name="nameNepali" maxLength={160} />
        </Field>

        {config.parentLabel ? (
          <Field
            label={config.parentLabel}
            required={config.parentRequired}
            error={state.field === "parentId" ? state.error : undefined}
            hint={parents.length === 0 ? `Add a ${config.parentLabel.toLowerCase()} first.` : undefined}
          >
            <Select name="parentId" defaultValue="" required={config.parentRequired}>
              <option value="">{config.parentRequired ? "Select…" : "None"}</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {config.showDates ? (
          <>
            <Field label="Start date">
              <Input type="date" name="startDate" />
            </Field>
            <Field label="End date">
              <Input type="date" name="endDate" />
            </Field>
          </>
        ) : null}

        {config.showGeography ? (
          <>
            <Field label="Country">
              <Input name="country" defaultValue="Nepal" maxLength={80} />
            </Field>
            <Field label="Province / State">
              <Input name="state" maxLength={80} />
            </Field>
          </>
        ) : null}

        <Field label="Sort order" hint="Lower appears first.">
          <Input type="number" name="sortOrder" defaultValue={0} min={0} max={9999} />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Remarks">
            <Textarea name="remarks" rows={2} maxLength={500} />
          </Field>
        </div>

        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Deactivation, not deletion. Each row is its own form so the submitted id is
 * always the row that was clicked — a shared form with a hidden input rewritten
 * on click submits whatever the last render left behind.
 */
export function RetireButton({
  id,
  kind,
  slug,
  inUse,
}: {
  id: string;
  kind: string;
  slug: string;
  inUse: number;
}) {
  const [state, action, pending] = useActionState(retireUnit, initial);

  if (state.error) return <span className="text-xs text-danger">{state.error}</span>;
  if (state.ok) return <span className="text-xs text-ok">Deactivated</span>;

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="slug" value={slug} />
      <button
        type="submit"
        disabled={pending}
        title={inUse > 0 ? `${inUse} employee(s) still placed here` : "Deactivate"}
        className="text-xs text-ink-faint underline-offset-2 transition-colors hover:text-danger hover:underline disabled:opacity-50"
      >
        {pending ? "Working…" : "Deactivate"}
      </button>
    </form>
  );
}
