"use client";

import { useActionState } from "react";
import { AlertCircle, Check, CheckCircle2, Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { BsDateField } from "@/components/bs-date-field";
import { cn } from "@/lib/utils";
import {
  addClearanceAction,
  cancelSeparationAction,
  completeSeparationAction,
  setClearanceAction,
  updateSeparationAction,
  type SeparationState,
} from "../actions";

const initial: SeparationState = {};

function Note({ state }: { state: SeparationState }) {
  if (!state.error && !state.ok) return null;
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs",
        state.error ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok",
      )}
      role="status"
    >
      {state.error ? <AlertCircle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
      {state.error ?? state.ok}
    </p>
  );
}

export type ClearanceLine = {
  id: string;
  owner: string;
  item: string;
  status: "pending" | "cleared" | "waived";
  note: string | null;
  clearedByLabel: string | null;
};

export function Checklist({ caseId, lines, open }: { caseId: string; lines: ClearanceLine[]; open: boolean }) {
  const [state, action, pending] = useActionState(setClearanceAction, initial);
  const [addState, addAction, adding] = useActionState(addClearanceAction, initial);

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-3">
        <Note state={state} />
      </div>
      <ul className="divide-y divide-line-soft">
        {lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full",
                l.status === "cleared" ? "bg-ok text-on-accent" : l.status === "waived" ? "bg-sunk text-ink-faint" : "border border-line",
              )}
              aria-hidden
            >
              {l.status === "cleared" ? <Check className="size-3" /> : l.status === "waived" ? <Minus className="size-3" /> : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm", l.status === "pending" ? "text-ink" : "text-ink-soft")}>{l.item}</p>
              <p className="text-[11px] text-ink-faint">
                {l.owner}
                {l.clearedByLabel ? ` · ${l.status} by ${l.clearedByLabel}` : ""}
                {l.note ? ` · ${l.note}` : ""}
              </p>
            </div>
            {open ? (
              <form action={action} className="flex items-center gap-1">
                <input type="hidden" name="clearanceId" value={l.id} />
                <input type="hidden" name="caseId" value={caseId} />
                {l.status === "pending" ? (
                  <>
                    <Button type="submit" name="status" value="cleared" variant="secondary" disabled={pending} className="px-2 py-0.5 text-xs">
                      <Check className="size-3.5" />
                      Clear
                    </Button>
                    <Button
                      type="submit"
                      name="status"
                      value="waived"
                      variant="ghost"
                      disabled={pending}
                      className="px-2 py-0.5 text-xs"
                      onClick={(e) => {
                        const note = prompt("Why is this line waived?");
                        if (!note) {
                          e.preventDefault();
                          return;
                        }
                        const form = e.currentTarget.form!;
                        let input = form.elements.namedItem("note") as HTMLInputElement | null;
                        if (!input) {
                          input = document.createElement("input");
                          input.type = "hidden";
                          input.name = "note";
                          form.appendChild(input);
                        }
                        input.value = note;
                      }}
                    >
                      Waive
                    </Button>
                  </>
                ) : (
                  <Button type="submit" name="status" value="pending" variant="ghost" disabled={pending} className="px-2 py-0.5 text-xs">
                    <RotateCcw className="size-3.5" />
                    Reopen
                  </Button>
                )}
              </form>
            ) : (
              <Badge tone={l.status === "cleared" ? "ok" : "neutral"}>{l.status}</Badge>
            )}
          </li>
        ))}
      </ul>
      {open ? (
        <form action={addAction} className="flex flex-wrap items-end gap-2 border-t border-line-soft px-4 py-3">
          <input type="hidden" name="caseId" value={caseId} />
          <Field label="Owner" className="w-36">
            <Input name="owner" placeholder="IT" maxLength={60} />
          </Field>
          <Field label="Item" className="min-w-48 flex-1">
            <Input name="item" placeholder="Return the site vehicle and fuel card" maxLength={300} />
          </Field>
          <Button type="submit" variant="secondary" disabled={adding}>
            <Plus className="size-4" />
            Add line
          </Button>
          <div className="w-full">
            <Note state={addState} />
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function CaseForm({
  id,
  open,
  values,
}: {
  id: string;
  open: boolean;
  values: {
    lastWorkingDate: string;
    exitInterview: string | null;
    eligibleForRehire: boolean;
    settlementStatus: "pending" | "processed" | "not_applicable";
    settlementNote: string | null;
  };
}) {
  const [state, action, pending] = useActionState(updateSeparationAction, initial);
  return (
    <form action={action} className="grid gap-4 p-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={id} />
      {open ? (
        <BsDateField name="lastWorkingDate" label="Last working day" defaultValue={values.lastWorkingDate} />
      ) : null}
      <Field label="Eligible for rehire">
        <Select name="eligibleForRehire" defaultValue={values.eligibleForRehire ? "yes" : "no"}>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      </Field>
      <Field label="Final settlement">
        <Select name="settlementStatus" defaultValue={values.settlementStatus}>
          <option value="pending">Pending</option>
          <option value="processed">Processed</option>
          <option value="not_applicable">Not applicable</option>
        </Select>
      </Field>
      <Field label="Settlement note" className={open ? undefined : "sm:col-span-2"}>
        <Input name="settlementNote" defaultValue={values.settlementNote ?? ""} placeholder="Voucher no., amount, date paid" />
      </Field>
      <Field label="Exit interview" className="sm:col-span-2" hint="Why they are going and what would have kept them. Seen only by HR.">
        <Textarea name="exitInterview" defaultValue={values.exitInterview ?? ""} className="min-h-28" />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Save case notes
        </Button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function CloseCase({ id, pendingLines, servingNotice }: { id: string; pendingLines: number; servingNotice: boolean }) {
  const [state, action, pending] = useActionState(completeSeparationAction, initial);
  const [cState, cancel, cancelling] = useActionState(cancelSeparationAction, initial);
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-ink-soft">
        Completing writes the separation onto the employee record, takes them off strength, clears them as anybody&apos;s
        supervisor and switches off their login.
      </p>
      {servingNotice ? (
        <p className="text-xs text-info">Still serving notice — the case can be completed from the last working day.</p>
      ) : null}
      {pendingLines > 0 ? (
        <p className="text-xs text-warn">
          {pendingLines} checklist {pendingLines === 1 ? "line is" : "lines are"} still pending.
        </p>
      ) : null}
      <Note state={state} />
      <Note state={cState} />
      <div className="flex flex-wrap gap-2">
        <form
          action={action}
          onSubmit={(e) => {
            if (!confirm("Complete this separation? The employee record will be closed.")) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={id} />
          <Button type="submit" disabled={pending || pendingLines > 0 || servingNotice}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Complete separation
          </Button>
        </form>
        <form
          action={cancel}
          onSubmit={(e) => {
            if (!confirm("Cancel this case? The employee stays on strength.")) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="ghost" disabled={cancelling}>
            Cancel case
          </Button>
        </form>
      </div>
    </div>
  );
}
