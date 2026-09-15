"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Lock, LockOpen, Plus } from "lucide-react";
import {
  createFiscalYear,
  setCurrentFiscalYear,
  setPeriodLock,
  type ActionState,
} from "../actions";
import { Badge, Button, Card, CardHeader, Field, Input } from "@/components/ui";
import { BS_MONTHS } from "@/lib/bs";
import { cn } from "@/lib/utils";

const initial: ActionState = { ok: false };

function Notice({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p
      className={`flex items-start gap-1.5 rounded px-3 py-2 text-sm ${
        state.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"
      }`}
    >
      {state.ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
      ) : (
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
      )}
      {state.message}
    </p>
  );
}

export function NewFiscalYearForm({ suggestedYear }: { suggestedYear: number }) {
  const [state, action, pending] = useActionState(createFiscalYear, initial);

  return (
    <Card>
      <CardHeader
        title="Add a fiscal year"
        description="Dates are derived from the calendar — Shrawan 1 to the day before the next Shrawan 1."
      />
      <form action={action} className="flex flex-col gap-4 p-4">
        <Notice state={state} />

        <Field
          label="Opening BS year"
          required
          error={state.fieldErrors?.startYear}
          hint={`${suggestedYear} creates ${suggestedYear}/${String(suggestedYear + 1).slice(-2)}`}
        >
          <Input
            name="startYear"
            type="number"
            min={2000}
            max={2099}
            defaultValue={suggestedYear}
            className="tabular w-40"
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="makeCurrent" className="accent-accent" />
          Make it the current year
          <span className="text-xs text-ink-faint">(the previous one is cleared in the same transaction)</span>
        </label>

        <div>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {pending ? "Creating" : "Create fiscal year"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function MakeCurrentButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(setCurrentFiscalYear, initial);
  if (state.ok) return <span className="text-[11px] text-ok">Now current</span>;
  return (
    <form action={action}>
      <input type="hidden" name="fiscalYearId" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-line px-2 py-1 text-xs text-ink-soft hover:bg-sunk hover:text-ink disabled:opacity-50"
      >
        {pending ? "Setting…" : "Make current"}
      </button>
      {state.message && !state.ok ? (
        <span className="ml-2 text-[11px] text-danger">{state.message}</span>
      ) : null}
    </form>
  );
}

const MODULES = ["attendance", "leave", "payroll"] as const;

/** One cell of the period board — its own form, so the submitted values are never stale. */
function LockCell({
  fiscalYearId,
  module,
  bsMonth,
  monthName,
  isLocked,
}: {
  fiscalYearId: string;
  module: string;
  bsMonth: number;
  monthName: string;
  isLocked: boolean;
}) {
  const [state, action, pending] = useActionState(setPeriodLock, initial);

  return (
    <form action={action} className="contents">
      <input type="hidden" name="fiscalYearId" value={fiscalYearId} />
      <input type="hidden" name="module" value={module} />
      <input type="hidden" name="bsMonth" value={bsMonth} />
      <input type="hidden" name="action" value={isLocked ? "unlock" : "lock"} />
      <button
        type="submit"
        disabled={pending}
        title={`${isLocked ? "Unlock" : "Lock"} ${monthName} for ${module}${
          state.message && !state.ok ? ` — ${state.message}` : ""
        }`}
        className={cn(
          "grid h-7 w-10 place-items-center rounded border text-[11px]",
          isLocked
            ? "border-danger/40 bg-danger-soft text-danger"
            : "border-line text-ink-faint hover:bg-sunk hover:text-ink",
          pending ? "opacity-50" : "",
        )}
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" aria-hidden />
        ) : isLocked ? (
          <Lock className="size-3" aria-hidden />
        ) : (
          <LockOpen className="size-3" aria-hidden />
        )}
        <span className="sr-only">
          {isLocked ? "Locked" : "Open"} — {monthName} {module}
        </span>
      </button>
    </form>
  );
}

/**
 * The period board: one row per module, one cell per Bikram Sambat month, in
 * fiscal order (Shrawan first). Clicking a cell locks or unlocks that period.
 */
export function PeriodLockBoard({
  fiscalYearId,
  code,
  locked,
}: {
  fiscalYearId: string;
  code: string;
  /** "module:bsMonth" for each locked period. */
  locked: Set<string>;
}) {
  // fiscal order: Shrawan(4) … Chaitra(12), Baisakh(1) … Ashadh(3)
  const months = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

  return (
    <Card>
      <CardHeader
        title={`Period locks — ${code}`}
        description="Locking attendance stamps every day in the month, so corrections are refused against a closed period."
      />
      <div className="flex flex-col gap-3 p-4">
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left text-[11px] tracking-wide text-ink-faint uppercase">
                  Module
                </th>
                {months.map((m) => (
                  <th
                    key={m}
                    className="px-0 py-1 text-center text-[10px] font-medium text-ink-faint"
                    title={BS_MONTHS[m - 1]}
                  >
                    <span className="block w-10 truncate">{BS_MONTHS[m - 1].slice(0, 3)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((mod) => (
                <tr key={mod}>
                  <td className="px-2 py-1 text-xs text-ink capitalize">{mod}</td>
                  {months.map((m) => (
                    <td key={m} className="p-0.5 text-center">
                      <LockCell
                        fiscalYearId={fiscalYearId}
                        module={mod}
                        bsMonth={m}
                        monthName={BS_MONTHS[m - 1]}
                        isLocked={locked.has(`${mod}:${m}`)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="flex flex-wrap items-center gap-3 text-[11px] text-ink-faint">
          <span className="flex items-center gap-1">
            <LockOpen className="size-3" aria-hidden /> open
          </span>
          <span className="flex items-center gap-1 text-danger">
            <Lock className="size-3" aria-hidden /> locked
          </span>
          <Badge tone="neutral">Shrawan is month 1 of the fiscal year</Badge>
        </p>
      </div>
    </Card>
  );
}
