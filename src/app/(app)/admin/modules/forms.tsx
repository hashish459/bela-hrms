"use client";

import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui";
import { replayParkedEvents, toggleModule, type ActionState } from "./actions";

const initial: ActionState = {};

/**
 * One form per row. A shared form with a hidden input rewritten on click submits
 * whatever the last render left in it — the bug that made an earlier version of
 * the period-lock board write to the wrong cell.
 */
export function ModuleSwitch({ moduleId, enabled }: { moduleId: string; enabled: boolean }) {
  const [state, action, pending] = useActionState(toggleModule, initial);

  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="moduleId" value={moduleId} />
      <input type="hidden" name="enable" value={enabled ? "false" : "true"} />
      {state.error ? (
        <span className="max-w-[26ch] text-right text-[11px] text-danger">{state.error}</span>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={enabled ? `Switch off ${moduleId}` : `Switch on ${moduleId}`}
        className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
          enabled ? "justify-end border-accent bg-accent" : "justify-start border-line bg-sunk"
        }`}
      >
        <span className="mx-0.5 block size-3.5 rounded-full bg-surface" />
      </button>
    </form>
  );
}

export function ReplayDeadButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={pending}
      onClick={() => start(() => void replayParkedEvents())}
    >
      {pending ? "Requeueing…" : "Requeue parked events"}
    </Button>
  );
}
