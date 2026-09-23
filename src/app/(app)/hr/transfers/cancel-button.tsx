"use client";

import { useActionState } from "react";
import { Loader2, X } from "lucide-react";
import { cancelMovementAction, type MovementState } from "./actions";

const initial: MovementState = {};

export function CancelMovement({ id, reference }: { id: string; reference: string }) {
  const [state, action, pending] = useActionState(cancelMovementAction, initial);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const reason = prompt(`Cancel ${reference}? Say why (optional).`);
        if (reason === null) {
          e.preventDefault();
          return;
        }
        (e.currentTarget.elements.namedItem("reason") as HTMLInputElement).value = reason;
      }}
      className="inline-flex items-center gap-2"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="reason" value="" />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1 rounded border border-line px-2 py-0.5 text-[11px] text-ink-soft hover:bg-danger-soft hover:text-danger"
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
        Cancel
      </button>
      {state.error ? <span className="text-[11px] text-danger">{state.error}</span> : null}
    </form>
  );
}
