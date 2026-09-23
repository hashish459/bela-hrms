"use client";

import { useActionState, useState } from "react";
import { HandCoins, Loader2, Undo2 } from "lucide-react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { SideDrawer } from "@/components/side-drawer";
import { useConfirmSubmit, useToastedAction } from "@/components/feedback";
import { formatDays } from "@/lib/utils";
import { encashAction, reverseEncashmentAction, type AdminState } from "../admin-actions";

const initial: AdminState = {};

export function EncashButton({ balanceId, employee, type, available, min, max, encashable }: {
  balanceId: string;
  employee: string;
  type: string;
  available: number;
  min: number;
  max: number | null;
  encashable: number;
}) {
  const [open, setOpen] = useState(false);
  const blocked = encashable < Math.max(min, 0.5);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} disabled={blocked} title={blocked ? "Not enough days to encash" : undefined} className="px-2.5 py-1 text-xs">
        <HandCoins className="size-3.5" />
        Encash
      </Button>
      {open ? <EncashDrawer {...{ balanceId, employee, type, available, min, max, encashable }} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function EncashDrawer({ balanceId, employee, type, available, min, max, encashable, onClose }: {
  balanceId: string;
  employee: string;
  type: string;
  available: number;
  min: number;
  max: number | null;
  encashable: number;
  onClose: () => void;
}) {
  const save = useToastedAction(encashAction);
  const [state, action, pending] = useActionState(async (p: AdminState, fd: FormData) => {
    const r = await save(p, fd);
    if (r.ok) onClose();
    return r;
  }, initial);
  const [days, setDays] = useState(encashable);
  const ask = useConfirmSubmit({
    title: `Encash ${days} day(s) of ${type}?`,
    body: `${employee}'s available ${type} goes from ${formatDays(available)} to ${formatDays(available - days)}. Carried-forward days are used first. It can be reversed later if it was a mistake.`,
    confirmLabel: "Encash",
  });
  return (
    <SideDrawer
      title={`Encash ${type}`}
      subtitle={employee}
      onClose={onClose}
      action={action}
      onSubmit={ask}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <HandCoins className="size-4" />}
            Encash
          </Button>
        </>
      }
    >
      <input type="hidden" name="balanceId" value={balanceId} />
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md bg-sunk p-2">
          <p className="tabular text-base font-semibold text-ink">{formatDays(available)}</p>
          <p className="text-[10px] tracking-wide text-ink-faint uppercase">Available</p>
        </div>
        <div className="rounded-md bg-sunk p-2">
          <p className="tabular text-base font-semibold text-ink">{min ? formatDays(min) : "—"}</p>
          <p className="text-[10px] tracking-wide text-ink-faint uppercase">Minimum</p>
        </div>
        <div className="rounded-md bg-accent-soft p-2">
          <p className="tabular text-base font-semibold text-accent">{formatDays(encashable)}</p>
          <p className="text-[10px] tracking-wide text-accent uppercase">Most now</p>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        {state.error && !state.fieldErrors ? <p className="text-sm text-danger">{state.error}</p> : null}
        <Field label="Days to encash" required error={state.fieldErrors?.days} hint={max !== null ? `The policy allows at most ${formatDays(max)} at a time` : undefined}>
          <Input name="days" type="number" min={Math.max(min, 0.5)} max={encashable} step="0.5" value={days} onChange={(e) => setDays(Number(e.target.value))} className="tabular w-32" />
        </Field>
        <Field label="Note" error={state.fieldErrors?.reason} hint="Optional — e.g. the payroll month it is paid in">
          <Textarea name="reason" maxLength={300} className="min-h-16" />
        </Field>
      </div>
    </SideDrawer>
  );
}

export function ReverseButton({ id, reference }: { id: string; reference: string }) {
  const [open, setOpen] = useState(false);
  const save = useToastedAction(reverseEncashmentAction);
  const [state, action, pending] = useActionState(async (p: AdminState, fd: FormData) => {
    const r = await save(p, fd);
    if (r.ok) setOpen(false);
    return r;
  }, initial);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[11px] text-ink-soft hover:text-danger">
        <Undo2 className="size-3" aria-hidden />
        Reverse
      </button>
      {open ? (
        <SideDrawer
          title={`Reverse ${reference}`}
          subtitle="The days go back onto the balance they came from."
          onClose={() => setOpen(false)}
          action={action}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
                Reverse encashment
              </Button>
            </>
          }
        >
          <input type="hidden" name="id" value={id} />
          <Field label="Why" required error={state.fieldErrors?.reason}>
            <Textarea name="reason" maxLength={300} placeholder="Entered against the wrong person…" />
          </Field>
          {state.error && !state.fieldErrors ? <p className="mt-2 text-sm text-danger">{state.error}</p> : null}
        </SideDrawer>
      ) : null}
    </>
  );
}
