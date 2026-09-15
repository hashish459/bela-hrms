"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { createHoliday, toggleHoliday, type ActionState } from "../actions";
import { Button, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { BsDateField } from "@/components/bs-date-field";

const initial: ActionState = { ok: false };

/**
 * The add form, behind a button.
 *
 * Kept as a disclosure rather than a modal: the calendar and the list beside it
 * are the reference somebody checks *while* entering a date ("is Dashain already
 * in?"), and a modal covers exactly the thing they need to read.
 *
 * Collapses itself on success, so adding three holidays in a row does not
 * require finding the close control between each one.
 */
export function AddHolidayPanel() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          Add holiday
        </Button>
        <span className="text-[11px] text-ink-faint">
          Excluded from leave and attendance day counting as soon as it is saved.
        </span>
      </div>
    );
  }

  return <NewHolidayForm onDone={() => setOpen(false)} />;
}

export function NewHolidayForm({ onDone }: { onDone?: () => void } = {}) {
  const [state, action, pending] = useActionState(createHoliday, initial);
  const err = (n: string) => state.fieldErrors?.[n];

  return (
    <Card>
      <CardHeader
        title="Add a holiday"
        description="Excluded from leave and attendance day counting as soon as it is saved."
        action={
          onDone ? (
            <button
              type="button"
              onClick={onDone}
              className="rounded p-1 text-ink-faint transition-colors hover:text-ink"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          ) : undefined
        }
      />
      <form action={action} className="grid gap-4 p-4 sm:grid-cols-2">
        {state.message ? (
          <p
            className={`flex items-start gap-1.5 rounded px-3 py-2 text-sm sm:col-span-2 ${
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
        ) : null}

        {/* the action stores the BS key exactly as typed, so ask for both */}
        <BsDateField name="date" bsName="dateBs" label="Date" required error={err("dateBs")} />

        <Field label="Holiday" required error={err("name")}>
          <Input name="name" placeholder="Vijaya Dashami" maxLength={120} />
        </Field>

        <Field label="Name (Nepali)" error={err("nameNepali")}>
          <Input name="nameNepali" placeholder="विजया दशमी" maxLength={120} />
        </Field>

        <Field
          label="Applies to"
          hint="Some holidays are observed by one gender — Teej, for instance."
          error={err("appliesToGender")}
        >
          <Select name="appliesToGender" defaultValue="">
            <option value="">Everyone</option>
            <option value="female">Women only</option>
            <option value="male">Men only</option>
          </Select>
        </Field>

        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {pending ? "Saving" : "Add holiday"}
          </Button>
          {onDone ? (
            <Button type="button" variant="ghost" onClick={onDone}>
              Done
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

export function ToggleHolidayButton({ id, active }: { id: string; active: boolean }) {
  const [state, action, pending] = useActionState(toggleHoliday, initial);
  if (state.ok) return <span className="text-[11px] text-ok">Updated</span>;
  return (
    <form action={action}>
      <input type="hidden" name="holidayId" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-line px-2 py-1 text-xs text-ink-soft hover:bg-sunk hover:text-ink disabled:opacity-50"
      >
        {pending ? "…" : active ? "Disable" : "Enable"}
      </button>
    </form>
  );
}
