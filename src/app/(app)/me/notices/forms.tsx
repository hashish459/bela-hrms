"use client";

import { useActionState } from "react";
import { Check, Loader2 } from "lucide-react";
import { markRead, type ReadState } from "./actions";

const initial: ReadState = {};

/**
 * Acknowledging a notice.
 *
 * One form per notice, with the id as a hidden input, so the submitted value is
 * always the notice that was clicked. A single shared form whose hidden field is
 * rewritten on click submits whatever the last render left behind.
 */
export function MarkRead({ noticeId }: { noticeId: string }) {
  const [state, action, pending] = useActionState(markRead, initial);

  if (state.ok) return <span className="text-ok">Marked as read</span>;

  return (
    <form action={action} className="inline">
      <input type="hidden" name="noticeId" value={noticeId} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" aria-hidden />
        ) : (
          <Check className="size-3" aria-hidden />
        )}
        Mark as read
      </button>
      {state.error ? <span className="ml-2 text-danger">{state.error}</span> : null}
    </form>
  );
}
