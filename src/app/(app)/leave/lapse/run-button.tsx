"use client";

import { useActionState } from "react";
import { CalendarCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useConfirmSubmit, useToastedAction } from "@/components/feedback";
import { yearEndAction, type AdminState } from "../admin-actions";

const initial: AdminState = {};

export function RunYearEnd({ from, to, fromCode, toCode, rows, carry, lapse, pending }: {
  from: string;
  to: string;
  fromCode: string;
  toCode: string;
  rows: number;
  carry: number;
  lapse: number;
  pending: number;
}) {
  const [, action, busy] = useActionState(useToastedAction(yearEndAction, { errors: true }), initial);
  const ask = useConfirmSubmit({
    title: `Close ${fromCode} into ${toCode}?`,
    body: (
      <div className="flex flex-col gap-2">
        <p>
          {rows} balance{rows === 1 ? "" : "s"}: <strong className="text-ok">{carry} day(s) carried</strong> into {toCode}, <strong className="text-danger">{lapse} lapsed</strong>.
        </p>
        {pending ? <p className="text-warn">{pending} day(s) are still reserved by undecided requests in {fromCode}. They are left out of the carry — decide them first if they should count.</p> : null}
        <p>Each balance is processed once; running it again later changes nothing.</p>
      </div>
    ),
    confirmLabel: "Run year end",
    tone: "warning",
  });
  return (
    <form action={action} onSubmit={ask}>
      <input type="hidden" name="fromFiscalYearId" value={from} />
      <input type="hidden" name="toFiscalYearId" value={to} />
      <Button type="submit" disabled={busy || rows === 0}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />}
        {rows ? `Run year end (${rows})` : "Nothing left to process"}
      </Button>
    </form>
  );
}
