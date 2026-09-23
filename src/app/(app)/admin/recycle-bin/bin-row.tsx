"use client";

import { useActionState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { binAction, type BinState } from "./actions";
import { useConfirmSubmit } from "@/components/feedback";

const initial: BinState = {};

export function BinRowActions({ type, id, label }: { type: string; id: string; label: string }) {
  const [state, action, pending] = useActionState(binAction, initial);
  const ask = useConfirmSubmit((submitter) =>
    submitter?.value === "purge"
      ? { title: `Permanently delete “${label}”?`, body: "It is removed for good, with everything that belongs to it. This cannot be undone.", confirmLabel: "Delete permanently", tone: "danger" }
      : null,
  );
  if (state.ok) return <span className="text-[11px] text-ok">{state.ok}</span>;
  return (
    <form action={action} onSubmit={ask} className="flex flex-col items-end gap-1">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="label" value={label} />
      <div className="flex gap-1.5">
        <button
          type="submit"
          name="op"
          value="restore"
          disabled={pending}
          className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-ink-soft hover:bg-sunk hover:text-ink disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
          Restore
        </button>
        <button
          type="submit"
          name="op"
          value="purge"
          disabled={pending}
          className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-ink-soft hover:border-danger/40 hover:bg-danger-soft hover:text-danger disabled:opacity-50"
        >
          <Trash2 className="size-3" />
          Purge
        </button>
      </div>
      {state.error ? <span className="max-w-72 text-right text-[11px] text-danger">{state.error}</span> : null}
    </form>
  );
}
