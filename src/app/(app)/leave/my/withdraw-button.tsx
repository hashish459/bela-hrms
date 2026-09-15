"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { withdrawLeave, type ActionState } from "../actions";
import { Button } from "@/components/ui";

const initial: ActionState = { ok: false };

export function WithdrawButton({ requestId, reference }: { requestId: string; reference: string }) {
  const [state, action, pending] = useActionState(withdrawLeave, initial);
  const [confirming, setConfirming] = useState(false);

  if (state.ok) {
    return <span className="text-[11px] text-ink-faint">Withdrawn</span>;
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded px-1.5 py-1 text-xs text-ink-faint hover:bg-sunk hover:text-danger"
      >
        Withdraw
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center justify-end gap-1">
      <input type="hidden" name="requestId" value={requestId} />
      <span className="sr-only">Withdraw {reference}</span>
      <Button type="submit" variant="danger" disabled={pending} className="px-2 py-1 text-xs">
        {pending ? <Loader2 className="size-3 animate-spin" /> : null}
        Confirm
      </Button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded px-1.5 py-1 text-xs text-ink-faint hover:bg-sunk"
      >
        Keep
      </button>
      {state.message && !state.ok ? (
        <span className="text-[11px] text-danger">{state.message}</span>
      ) : null}
    </form>
  );
}
