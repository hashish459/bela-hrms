"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Phone, Send, UserRoundCheck } from "lucide-react";
import { applyForLeave, type ActionState } from "../actions";
import { Button, Card, Field, Select, Textarea } from "@/components/ui";
import { BsDateField } from "@/components/bs-date-field";
import { cn, formatDays } from "@/lib/utils";

const initial: ActionState = { ok: false };

const PORTIONS = [
  { value: "full", label: "Full day(s)" },
  { value: "first_half", label: "First half" },
  { value: "second_half", label: "Second half" },
] as const;

/**
 * The leave application. Same fields and the same action as ever — the type is
 * chosen from tiles that show what is left, so nobody applies for leave they do
 * not have and then learns it from an error.
 */
export function ApplyForm({
  leaveTypes,
  colleagues,
}: {
  leaveTypes: { id: string; name: string; colour: string; available: number | null }[];
  colleagues: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(applyForLeave, initial);
  const [typeId, setTypeId] = useState(leaveTypes[0]?.id ?? "");
  const [portion, setPortion] = useState("full");
  const err = (name: string) => state.fieldErrors?.[name];

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line-soft bg-gradient-to-r from-accent-soft/70 to-transparent px-5 py-4">
        <h2 className="text-base font-semibold text-ink">Apply for leave</h2>
        <p className="mt-0.5 text-xs text-ink-soft">
          Saturdays and public holidays are not deducted. Your supervisor is notified the moment you submit.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-5 p-5">
        {state.message ? (
          <p
            role="status"
            className={cn(
              "flex items-start gap-2 rounded-md px-3 py-2.5 text-sm",
              state.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger",
            )}
          >
            {state.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
            {state.message}
          </p>
        ) : null}

        <fieldset>
          <legend className="mb-2 text-xs font-medium text-ink-soft">
            Leave type <span className="text-danger">*</span>
          </legend>
          {leaveTypes.length === 0 ? (
            <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-ink-faint">
              No leave types are allocated to you yet. HR sets these up at the start of the fiscal year.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {leaveTypes.map((t) => {
                const active = t.id === typeId;
                const exhausted = t.available !== null && t.available <= 0;
                return (
                  <label
                    key={t.id}
                    className={cn(
                      "relative flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-all",
                      active ? "border-accent bg-accent-soft/50 shadow-sm ring-1 ring-accent" : "border-line hover:border-ink-faint hover:bg-sunk/50",
                      exhausted && !active ? "opacity-60" : "",
                    )}
                  >
                    <input
                      type="radio"
                      name="leaveTypeId"
                      value={t.id}
                      checked={active}
                      onChange={() => setTypeId(t.id)}
                      className="sr-only"
                    />
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: t.colour }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{t.name}</span>
                      <span className={cn("block text-[11px]", exhausted ? "text-danger" : "text-ink-faint")}>
                        {t.available === null ? "Not deducted" : `${formatDays(t.available)} day(s) left`}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {err("leaveTypeId") ? <p className="mt-1 text-xs text-danger">{err("leaveTypeId")}</p> : null}
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-xs font-medium text-ink-soft">Duration</legend>
          <input type="hidden" name="portion" value={portion} />
          <div className="inline-flex rounded-lg border border-line bg-sunk p-0.5" role="radiogroup" aria-label="Duration">
            {PORTIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={portion === p.value}
                onClick={() => setPortion(p.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  portion === p.value ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {portion !== "full" ? (
            <p className="mt-1.5 text-[11px] text-ink-faint">A half day is a single date — set From and To to the same day.</p>
          ) : null}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <BsDateField name="fromDate" label="From" required error={err("fromDate")} />
          <BsDateField name="toDate" label="To" required error={err("toDate")} />
        </div>

        <Field label="Reason" required error={err("reason")}>
          <Textarea name="reason" placeholder="A line for your approver — why you need the time off" maxLength={500} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact while away" hint="Phone or email" error={err("contactDuringLeave")}>
            <span className="relative block">
              <Phone className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint" />
              <input
                name="contactDuringLeave"
                className="w-full rounded border border-line bg-surface py-1.5 pr-2.5 pl-8 text-sm text-ink placeholder:text-ink-faint"
                placeholder="98XXXXXXXX"
              />
            </span>
          </Field>
          <Field label="Handover to" hint="Who covers your work" error={err("handoverToEmployeeId")}>
            <span className="relative block">
              <UserRoundCheck className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-ink-faint" />
              <Select name="handoverToEmployeeId" defaultValue="" className="pl-8">
                <option value="">Nobody specified</option>
                {colleagues.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </span>
          </Field>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line-soft pt-4">
          <Button type="submit" disabled={pending || leaveTypes.length === 0} className="px-4 py-2">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {pending ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
