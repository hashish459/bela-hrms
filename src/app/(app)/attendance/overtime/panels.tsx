"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Clock3, Loader2, Send, X } from "lucide-react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { SideDrawer } from "@/components/side-drawer";
import { cn } from "@/lib/utils";
import {
  claimOvertimeAction,
  decideOvertimeAction,
  saveRuleAction,
  withdrawOvertimeAction,
  type OvertimeState,
} from "./actions";
import { hm } from "./format";

const initial: OvertimeState = {};


function Note({ state }: { state: OvertimeState }) {
  if (!state.ok && !state.error) return null;
  return (
    <p
      role="status"
      className={cn(
        "flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs",
        state.error ? "bg-danger-soft text-danger" : "bg-ok-soft text-ok",
      )}
    >
      {state.error ? <AlertCircle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
      {state.error ?? state.ok}
    </p>
  );
}

/** Hours and minutes, as two small inputs — nobody types "135 minutes". */
function DurationInput({ max, defaultMinutes, error }: { max: number; defaultMinutes: number; error?: string }) {
  return (
    <Field label="Time to claim" required error={error} hint={`Up to ${hm(max)} on this day`}>
      <span className="flex items-center gap-2">
        <Input name="hours" type="number" min={0} max={Math.floor(max / 60)} defaultValue={Math.floor(defaultMinutes / 60)} className="tabular w-20" aria-label="Hours" />
        <span className="text-xs text-ink-faint">h</span>
        <Input name="minutes" type="number" min={0} max={59} step={5} defaultValue={defaultMinutes % 60} className="tabular w-20" aria-label="Minutes" />
        <span className="text-xs text-ink-faint">m</span>
      </span>
    </Field>
  );
}

export function ClaimButton({
  date,
  dateBs,
  kindLabel,
  computedMinutes,
  claimableMinutes,
  multiplier,
}: {
  date: string;
  dateBs: string;
  kindLabel: string;
  computedMinutes: number;
  claimableMinutes: number;
  multiplier: number;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (done) return <span className="text-[11px] text-ok">{done}</span>;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} className="px-2.5 py-1 text-xs">
        <Clock3 className="size-3.5" />
        Claim
      </Button>
      {open ? (
        <ClaimDrawer
          date={date}
          dateBs={dateBs}
          kindLabel={kindLabel}
          computedMinutes={computedMinutes}
          claimableMinutes={claimableMinutes}
          multiplier={multiplier}
          onClose={() => setOpen(false)}
          onDone={(m) => {
            setOpen(false);
            setDone(m);
          }}
        />
      ) : null}
    </>
  );
}

function ClaimDrawer({
  date,
  dateBs,
  kindLabel,
  computedMinutes,
  claimableMinutes,
  multiplier,
  onClose,
  onDone,
}: {
  date: string;
  dateBs: string;
  kindLabel: string;
  computedMinutes: number;
  claimableMinutes: number;
  multiplier: number;
  onClose: () => void;
  onDone: (m: string) => void;
}) {
  const [state, action, pending] = useActionState(claimOvertimeAction, initial);
  useEffect(() => {
    if (state.at && state.ok) onDone(state.ok);
  }, [state.at, state.ok, onDone]);

  return (
    <SideDrawer
      title="Claim overtime"
      subtitle={`${dateBs} BS · ${kindLabel}`}
      onClose={onClose}
      action={action}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send for approval
          </Button>
        </>
      }
    >
      <input type="hidden" name="date" value={date} />
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-sunk p-2">
          <p className="text-[10px] tracking-wide text-ink-faint uppercase">On record</p>
          <p className="tabular text-sm font-semibold text-ink">{hm(computedMinutes)}</p>
        </div>
        <div className="rounded-md bg-sunk p-2">
          <p className="text-[10px] tracking-wide text-ink-faint uppercase">Claimable</p>
          <p className="tabular text-sm font-semibold text-ink">{hm(claimableMinutes)}</p>
        </div>
        <div className="rounded-md bg-accent-soft p-2">
          <p className="text-[10px] tracking-wide text-accent uppercase">Rate</p>
          <p className="tabular text-sm font-semibold text-accent">{multiplier}×</p>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <Note state={state.error ? state : {}} />
        <DurationInput max={claimableMinutes} defaultMinutes={claimableMinutes} error={state.fieldErrors?.minutes} />
        <Field label="What was the overtime for?" required error={state.fieldErrors?.reason}>
          <Textarea name="reason" maxLength={500} placeholder="Month-end dispatch, a breakdown on line 2…" />
        </Field>
        <p className="text-xs text-ink-faint">
          Your supervisor approves it. The claim cannot exceed what your punches recorded for the day.
        </p>
      </div>
    </SideDrawer>
  );
}

export function WithdrawClaim({ id }: { id: string }) {
  const [state, action, pending] = useActionState(withdrawOvertimeAction, initial);
  if (state.ok) return <span className="text-[11px] text-ink-faint">Withdrawn</span>;
  return (
    <form action={action} onSubmit={(e) => !confirm("Withdraw this claim?") && e.preventDefault()}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-[11px] text-ink-soft hover:text-danger hover:underline">
        Withdraw
      </button>
      {state.error ? <span className="ml-2 text-[11px] text-danger">{state.error}</span> : null}
    </form>
  );
}

export function DecideClaim({ id, claimedMinutes }: { id: string; claimedMinutes: number }) {
  const [state, action, pending] = useActionState(decideOvertimeAction, initial);
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  if (state.ok) return <Note state={state} />;

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <Note state={state} />
      {mode === "approve" ? (
        <div className="flex flex-wrap items-end gap-2">
          <span className="flex items-center gap-1">
            <Input name="hours" type="number" min={0} defaultValue={Math.floor(claimedMinutes / 60)} className="tabular w-16" aria-label="Hours" />
            <span className="text-xs text-ink-faint">h</span>
            <Input name="minutes" type="number" min={0} max={59} step={5} defaultValue={claimedMinutes % 60} className="tabular w-16" aria-label="Minutes" />
            <span className="text-xs text-ink-faint">m</span>
          </span>
          <Input name="note" placeholder="Note (optional)" className="min-w-40 flex-1" maxLength={500} />
          <Button type="submit" name="decision" value="approved" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Approve
          </Button>
          <Button type="button" variant="ghost" onClick={() => setMode("idle")}>
            Back
          </Button>
        </div>
      ) : mode === "reject" ? (
        <div className="flex flex-wrap items-end gap-2">
          <Input name="note" placeholder="Why — the employee sees this" className="min-w-52 flex-1" required maxLength={500} />
          <Button type="submit" name="decision" value="rejected" variant="danger" disabled={pending}>
            <X className="size-4" />
            Reject
          </Button>
          <Button type="button" variant="ghost" onClick={() => setMode("idle")}>
            Back
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button type="button" onClick={() => setMode("approve")}>
            <Check className="size-4" />
            Approve…
          </Button>
          <Button type="button" variant="secondary" onClick={() => setMode("reject")}>
            Reject…
          </Button>
        </div>
      )}
    </form>
  );
}

export function RuleForm({
  dayKind,
  multiplier,
  minMinutes,
  maxMinutes,
}: {
  dayKind: string;
  multiplier: number;
  minMinutes: number;
  maxMinutes: number;
}) {
  const [state, action, pending] = useActionState(saveRuleAction, initial);
  return (
    <form key={`${multiplier}:${minMinutes}:${maxMinutes}`} action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="dayKind" value={dayKind} />
      <Field label="Rate (×)">
        <Input name="multiplier" type="number" step="0.05" min={1} max={5} defaultValue={multiplier} className="tabular w-24" />
      </Field>
      <Field label="Minimum (min)">
        <Input name="minMinutes" type="number" min={0} max={240} defaultValue={minMinutes} className="tabular w-24" />
      </Field>
      <Field label="Daily cap (min)">
        <Input name="maxMinutes" type="number" min={30} max={960} defaultValue={maxMinutes} className="tabular w-24" />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        Save
      </Button>
      <div className="w-full">
        <Note state={state} />
      </div>
    </form>
  );
}
