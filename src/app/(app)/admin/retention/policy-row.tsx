"use client";

import { useActionState } from "react";
import { Eraser, Loader2, Save, Wrench } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { optimiseAction, purgeNowAction, savePolicyAction, type RetentionState } from "./actions";

const initial: RetentionState = {};

const PRESETS = [7, 14, 30, 60, 90, 180, 365, 400, 730, 1095, 1825, 2555, 3650];

function label(days: number) {
  if (days % 365 === 0) return `${days / 365} year${days === 365 ? "" : "s"}`;
  if (days === 400) return "13 months";
  return `${days} days`;
}

function Note({ state }: { state: RetentionState }) {
  if (!state.ok && !state.error) return null;
  return (
    <p role="status" className={cn("mt-1 text-[11px]", state.error ? "text-danger" : "text-ok")}>
      {state.error ?? state.ok}
    </p>
  );
}

export function PolicyRow({
  dataset,
  minDays,
  retentionDays,
  isAutomatic,
  eligible,
  canExport,
}: {
  dataset: string;
  minDays: number;
  retentionDays: number | null;
  isAutomatic: boolean;
  eligible: number;
  canExport: boolean;
}) {
  const [state, save, saving] = useActionState(savePolicyAction, initial);
  const [purgeState, purge, purging] = useActionState(purgeNowAction, initial);
  const options = PRESETS.filter((d) => d >= minDays);
  if (retentionDays !== null && !options.includes(retentionDays)) options.push(retentionDays);
  options.sort((a, b) => a - b);

  return (
    <div className="flex flex-wrap items-start justify-end gap-3">
      {/* keyed on the saved values: React resets a submitted form to its
          defaults, and without a remount those would be the old ones */}
      <form key={`${retentionDays}:${isAutomatic}`} action={save} className="flex flex-col items-end">
        <input type="hidden" name="dataset" value={dataset} />
        <div className="flex items-center gap-2">
          <select
            name="retentionDays"
            defaultValue={retentionDays === null ? "forever" : String(retentionDays)}
            aria-label="Keep for"
            className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink"
          >
            {options.map((d) => (
              <option key={d} value={d}>
                Keep {label(d)}
              </option>
            ))}
            <option value="forever">Keep forever</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-ink-soft" title="Cleared by the daily run">
            <input type="checkbox" name="isAutomatic" defaultChecked={isAutomatic} className="size-3.5 accent-[var(--color-accent)]" />
            Auto
          </label>
          <Button type="submit" variant="secondary" disabled={saving} className="px-2 py-1 text-xs">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </Button>
        </div>
        <Note state={state} />
      </form>

      <form
        action={purge}
        onSubmit={(e) => {
          if (!confirm(`Permanently clear ${eligible.toLocaleString("en-IN")} rows? This cannot be undone.`)) e.preventDefault();
        }}
        className="flex flex-col items-end"
      >
        <input type="hidden" name="dataset" value={dataset} />
        <div className="flex items-center gap-2">
          {canExport && eligible > 0 ? (
            <a
              href={`/admin/retention/export?days=${retentionDays ?? 0}`}
              className="text-xs text-accent hover:underline"
              title="Download what would be cleared, as CSV"
            >
              Export first
            </a>
          ) : null}
          <Button type="submit" variant="danger" disabled={purging || eligible === 0 || retentionDays === null} className="px-2 py-1 text-xs">
            {purging ? <Loader2 className="size-3.5 animate-spin" /> : <Eraser className="size-3.5" />}
            Clear now{eligible ? ` (${eligible.toLocaleString("en-IN")})` : ""}
          </Button>
        </div>
        <Note state={purgeState} />
      </form>
    </div>
  );
}

export function OptimiseButton() {
  const [state, action, pending] = useActionState(optimiseAction, initial);
  return (
    <form action={action} className="flex flex-col items-end">
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
        Optimise tables
      </Button>
      <Note state={state} />
    </form>
  );
}
