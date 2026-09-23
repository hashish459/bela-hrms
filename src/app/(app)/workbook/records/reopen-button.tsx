"use client";

import { useActionState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { reopenWorkBookAction, type WorkBookState } from "../actions";
import { useConfirmSubmit, useToastedAction } from "@/components/feedback";

const initial: WorkBookState = {};

/** Sends a submitted day back to its author as a draft. */
export function ReopenButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(useToastedAction(reopenWorkBookAction), initial);
  const ask = useConfirmSubmit({ title: "Reopen this day?", body: "It goes back to its author as a draft so they can correct it and submit again.", confirmLabel: "Reopen day", tone: "warning" });
  if (state.ok) return <span className="text-[11px] text-ok">{state.ok}</span>;
  return (
    <form action={action} onSubmit={ask} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[11px] text-ink-soft hover:border-warn hover:text-warn disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
        Reopen
      </button>
      {state.error ? <span className="text-[11px] text-danger">{state.error}</span> : null}
    </form>
  );
}
