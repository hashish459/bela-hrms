"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Loader2, X } from "lucide-react";
import { Button, Textarea } from "@/components/ui";
import { decideChangeAction, type DecideState } from "./actions";

const initial: DecideState = {};

export function Decision({ id }: { id: string }) {
  const [state, action, pending] = useActionState(decideChangeAction, initial);
  const [rejecting, setRejecting] = useState(false);

  if (state.ok) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-ok" role="status">
        <CheckCircle2 className="size-3.5" />
        {state.ok}
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      {state.error ? (
        <p className="flex items-center gap-1.5 text-xs text-danger">
          <AlertCircle className="size-3.5" />
          {state.error}
        </p>
      ) : null}
      {rejecting ? (
        <Textarea name="note" placeholder="Why — the employee sees this." className="min-h-16 text-xs" autoFocus required />
      ) : (
        <input type="text" name="note" placeholder="Note (optional)" className="rounded border border-line bg-surface px-2 py-1 text-xs" maxLength={500} />
      )}
      <div className="flex gap-2">
        {rejecting ? (
          <>
            <Button type="submit" name="decision" value="rejected" variant="danger" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              Refuse
            </Button>
            <Button type="button" variant="ghost" onClick={() => setRejecting(false)}>
              Back
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" name="decision" value="approved" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Apply
            </Button>
            <Button type="button" variant="secondary" onClick={() => setRejecting(true)}>
              Refuse…
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
