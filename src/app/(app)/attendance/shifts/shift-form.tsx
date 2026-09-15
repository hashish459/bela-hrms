"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Plus } from "lucide-react";
import { saveShift, type ActionState } from "../actions";
import { Button, Card, CardHeader, Field, Input } from "@/components/ui";

const initial: ActionState = { ok: false };

export function ShiftForm() {
  const [state, action, pending] = useActionState(saveShift.bind(null, null), initial);
  const err = (name: string) => state.fieldErrors?.[name];

  return (
    <Card>
      <CardHeader
        title="Add a shift"
        description="Thresholds are in minutes of worked time, net of the break."
      />
      <form action={action} className="flex flex-col gap-4 p-4">
        {state.message ? (
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
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" required error={err("code")}>
            <Input name="code" placeholder="GEN2" className="font-mono" />
          </Field>
          <Field label="Colour" error={err("colour")}>
            <Input type="color" name="colour" defaultValue="#0f6e63" className="h-9 p-1" />
          </Field>
          <Field label="Name" required error={err("name")} className="sm:col-span-2">
            <Input name="name" placeholder="General Shift (Second)" />
          </Field>
          <Field label="Name (Nepali)" error={err("nameNepali")} className="sm:col-span-2">
            <Input name="nameNepali" />
          </Field>

          <Field label="Starts" required error={err("startTime")}>
            <Input type="time" name="startTime" defaultValue="09:00" className="tabular" />
          </Field>
          <Field label="Ends" required error={err("endTime")}>
            <Input type="time" name="endTime" defaultValue="17:00" className="tabular" />
          </Field>

          <Field label="Unpaid break (min)" error={err("breakMinutes")}>
            <Input type="number" name="breakMinutes" defaultValue={60} min={0} max={240} className="tabular" />
          </Field>
          <Field label="OT starts after (min)" error={err("otAfterMinutes")} hint="Past the shift end">
            <Input type="number" name="otAfterMinutes" defaultValue={30} min={0} max={240} className="tabular" />
          </Field>

          <Field label="Grace in (min)" error={err("graceInMinutes")} hint="Before lateness counts">
            <Input type="number" name="graceInMinutes" defaultValue={10} min={0} max={120} className="tabular" />
          </Field>
          <Field label="Grace out (min)" error={err("graceOutMinutes")}>
            <Input type="number" name="graceOutMinutes" defaultValue={10} min={0} max={120} className="tabular" />
          </Field>

          <Field label="Full day (min worked)" required error={err("fullDayMinutes")}>
            <Input type="number" name="fullDayMinutes" defaultValue={420} min={60} max={1440} className="tabular" />
          </Field>
          <Field label="Half day (min worked)" required error={err("halfDayMinutes")}>
            <Input type="number" name="halfDayMinutes" defaultValue={210} min={30} max={1440} className="tabular" />
          </Field>
        </div>

        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">Options</legend>
          <label className="flex items-center gap-1.5 text-sm text-ink-soft">
            <input type="checkbox" name="isNightShift" className="accent-accent" />
            Crosses midnight
          </label>
          <label className="flex items-center gap-1.5 text-sm text-ink-soft">
            <input type="checkbox" name="isDefault" className="accent-accent" />
            Default shift
          </label>
          <label className="flex items-center gap-1.5 text-sm text-ink-soft">
            <input type="checkbox" name="isActive" defaultChecked className="accent-accent" />
            Active
          </label>
        </fieldset>

        <div>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {pending ? "Saving" : "Add shift"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
