"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { History, Loader2, Sparkles, Wand2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { SideDrawer } from "@/components/side-drawer";
import { useConfirmSubmit, useToastedAction } from "@/components/feedback";
import { cn, formatDays } from "@/lib/utils";
import {
  adjustBalanceAction,
  allocateAction,
  balanceDetailAction,
  previewAllocationAction,
  type AdminState,
  type AllocationPreview,
  type BalanceView,
} from "../admin-actions";

const initial: AdminState = {};

const KIND: Record<string, { label: string; tone: string }> = {
  allocation: { label: "Allocated", tone: "bg-accent-soft text-accent" },
  adjustment: { label: "Adjusted", tone: "bg-info-soft text-info" },
  carry_forward: { label: "Carried in", tone: "bg-ok-soft text-ok" },
  lapse: { label: "Year closed", tone: "bg-sunk text-ink-soft" },
  encashment: { label: "Encashed", tone: "bg-warn-soft text-warn" },
  encashment_reversal: { label: "Encashment reversed", tone: "bg-danger-soft text-danger" },
};

const AD = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function when(iso: string) {
  const d = new Date(new Date(iso).getTime() + (5 * 60 + 45) * 60_000).toISOString();
  return `${Number(d.slice(8, 10))} ${AD[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}, ${d.slice(11, 16)}`;
}

/* ---------------------------------------------------------------- allocate */

export function AllocateButton({ years, defaultYear, missing }: { years: { id: string; code: string; closed: boolean }[]; defaultYear: string; missing: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} variant={missing ? "primary" : "secondary"}>
        <Wand2 className="size-4" />
        Allocate balances
        {missing ? <span className="tabular rounded-full bg-white/20 px-1.5 text-[11px]">{missing}</span> : null}
      </Button>
      {open ? <AllocateDrawer years={years} defaultYear={defaultYear} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AllocateDrawer({ years, defaultYear, onClose }: { years: { id: string; code: string; closed: boolean }[]; defaultYear: string; onClose: () => void }) {
  const [fy, setFy] = useState(defaultYear);
  const [prorate, setProrate] = useState(true);
  const [preview, setPreview] = useState<AllocationPreview | null>(null);
  const [loading, start] = useTransition();
  const run = useToastedAction(allocateAction, { errors: true });
  const [, action, pending] = useActionState(async (p: AdminState, fd: FormData) => {
    const r = await run(p, fd);
    if (r.ok) onClose();
    return r;
  }, initial);

  useEffect(() => {
    start(async () => setPreview(await previewAllocationAction(fy, prorate)));
  }, [fy, prorate]);

  const ask = useConfirmSubmit({
    title: `Allocate ${preview?.count ?? 0} balances for ${preview?.fyCode ?? ""}?`,
    body: `${formatDays(preview?.days ?? 0)} days in total. Balances people already hold are not touched, and running it again later only fills what is still missing.`,
    confirmLabel: "Allocate",
  });

  return (
    <SideDrawer
      title="Allocate leave balances"
      subtitle="Gives every employee on strength their entitlement for the year — by their employment type, gender and marital status."
      onClose={onClose}
      action={action}
      onSubmit={ask}
      width="max-w-xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || loading || !preview?.count}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Allocate {preview?.count ? preview.count : ""}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Fiscal year" required>
          <Select name="fiscalYearId" value={fy} onChange={(e) => setFy(e.target.value)}>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.code}
                {y.closed ? " (closed)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-start gap-3 rounded-md border border-line-soft p-3">
          <input type="checkbox" name="prorate" checked={prorate} onChange={(e) => setProrate(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
          <span>
            <span className="block text-sm font-medium text-ink">Prorate for people who joined during the year</span>
            <span className="block text-xs text-ink-faint">Someone who joined half way through gets half, rounded to the half day. Per-event leave (maternity, study) is never prorated.</span>
          </span>
        </label>

        {loading && !preview ? (
          <p className="flex items-center gap-2 text-sm text-ink-faint">
            <Loader2 className="size-4 animate-spin" /> Working out who needs what…
          </p>
        ) : preview?.error ? (
          <p className="text-sm text-danger">{preview.error}</p>
        ) : preview ? (
          <div className={cn("flex flex-col gap-3 transition-opacity", loading && "opacity-50")}>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-accent-soft p-2.5">
                <p className="tabular text-xl font-semibold text-accent">{preview.count}</p>
                <p className="text-[11px] text-accent">to allocate</p>
              </div>
              <div className="rounded-md bg-sunk p-2.5">
                <p className="tabular text-xl font-semibold text-ink">{formatDays(preview.days)}</p>
                <p className="text-[11px] text-ink-faint">days</p>
              </div>
              <div className="rounded-md bg-sunk p-2.5">
                <p className="tabular text-xl font-semibold text-ink">{preview.already}</p>
                <p className="text-[11px] text-ink-faint">already held</p>
              </div>
            </div>
            {preview.skippedStaff ? <p className="text-xs text-ink-faint">{preview.skippedStaff} employee(s) are on an employment type that does not accrue leave.</p> : null}
            {preview.count === 0 ? (
              <p className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">Everybody already holds their {preview.fyCode} balances.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto rounded-md border border-line">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-sunk text-[10px] tracking-wide text-ink-faint uppercase">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium">Employee</th>
                      <th className="px-3 py-1.5 text-left font-medium">Leave</th>
                      <th className="px-3 py-1.5 text-right font-medium">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((r, i) => (
                      <tr key={i} className="border-t border-line-soft">
                        <td className="px-3 py-1.5 text-ink">
                          {r.employee} <span className="font-mono text-[10px] text-ink-faint">{r.code}</span>
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="flex items-center gap-1.5 text-ink-soft">
                            <span className="size-2 rounded-full" style={{ background: r.colour }} aria-hidden />
                            {r.type}
                          </span>
                        </td>
                        <td className="tabular px-3 py-1.5 text-right text-ink">
                          {formatDays(r.days)}
                          {r.prorated ? <span className="ml-1 text-[10px] text-info">prorated</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.count > preview.sample.length ? <p className="border-t border-line-soft px-3 py-1.5 text-[11px] text-ink-faint">…and {preview.count - preview.sample.length} more</p> : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </SideDrawer>
  );
}

/* -------------------------------------------------------------- one balance */

export function BalanceCell({ balanceId, available, total, label }: { balanceId: string; available: number; total: number; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded px-1.5 py-0.5 text-right transition-colors hover:bg-accent-soft focus-visible:bg-accent-soft"
        aria-label={`${label}: ${formatDays(available)} of ${formatDays(total)} available — open`}
      >
        <span className={cn("tabular block text-sm", available <= 0 ? "text-danger" : "text-ink")}>{formatDays(available)}</span>
        <span className="block text-[11px] text-ink-faint">of {formatDays(total)}</span>
      </button>
      {open ? <BalanceDrawer balanceId={balanceId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function BalanceDrawer({ balanceId, onClose }: { balanceId: string; onClose: () => void }) {
  const [view, setView] = useState<BalanceView | null>(null);
  const [loading, start] = useTransition();
  const [field, setField] = useState<"entitled" | "carried_forward">("entitled");
  const [version, setVersion] = useState(0);
  const save = useToastedAction(adjustBalanceAction);
  const [state, action, pending] = useActionState(async (p: AdminState, fd: FormData) => {
    const r = await save(p, fd);
    if (r.ok) setVersion((v) => v + 1);
    return r;
  }, initial);

  useEffect(() => {
    start(async () => setView(await balanceDetailAction(balanceId)));
  }, [balanceId, version]);

  const available = view ? view.entitled + view.carried - view.used - view.pending : 0;
  const current = view ? (field === "entitled" ? view.entitled : view.carried) : 0;

  return (
    <SideDrawer
      title={view ? `${view.typeName} · ${view.employeeName}` : "Balance"}
      subtitle={view ? `${view.employeeCode} · fiscal year ${view.fyCode}` : undefined}
      onClose={onClose}
      action={action}
      width="max-w-xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" disabled={pending || !view}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save adjustment
          </Button>
        </>
      }
    >
      {!view ? (
        <p className="flex items-center gap-2 text-sm text-ink-faint">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      ) : (
        <div className={cn("flex flex-col gap-5", loading && "opacity-60")}>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {(
              [
                ["Entitled", view.entitled, ""],
                ["Carried", view.carried, ""],
                ["Used", view.used, ""],
                ["Pending", view.pending, view.pending ? "text-warn" : ""],
                ["Encashed", view.encashed, ""],
                ["Available", available, available <= 0 ? "text-danger" : "text-accent"],
              ] as const
            ).map(([k, v, tone]) => (
              <div key={k} className={cn("rounded-md p-2 text-center", k === "Available" ? "bg-accent-soft" : "bg-sunk")}>
                <p className={cn("tabular text-base font-semibold text-ink", tone)}>{formatDays(v)}</p>
                <p className="text-[10px] tracking-wide text-ink-faint uppercase">{k}</p>
              </div>
            ))}
          </div>

          <section className="rounded-md border border-line p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink">Adjust</h3>
            <input type="hidden" name="balanceId" value={view.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Figure" required>
                <Select name="field" value={field} onChange={(e) => setField(e.target.value as typeof field)}>
                  <option value="entitled">Entitlement</option>
                  <option value="carried_forward">Carried forward</option>
                </Select>
              </Field>
              <Field label="New value (days)" required error={state.fieldErrors?.value} hint={`Now ${formatDays(current)}`}>
                <Input key={`${field}:${version}`} name="value" type="number" min={0} max={999} step="0.5" defaultValue={current} className="tabular" />
              </Field>
              <Field label="Reason" required error={state.fieldErrors?.reason} className="sm:col-span-2" hint="Kept on the balance's history and the audit log">
                <Textarea key={version} name="reason" maxLength={300} className="min-h-16" placeholder="Correction after joining-date change, board-approved extra days…" />
              </Field>
            </div>
            {state.error && !state.fieldErrors ? <p className="mt-2 text-sm text-danger">{state.error}</p> : null}
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
              <History className="size-4 text-ink-faint" aria-hidden />
              History
            </h3>
            {view.history.length === 0 ? (
              <p className="text-xs text-ink-faint">Nothing on record — this balance predates the ledger or has never been changed by hand.</p>
            ) : (
              <ol className="relative flex flex-col gap-3 border-l border-line pl-4">
                {view.history.map((h) => {
                  const k = KIND[h.kind] ?? { label: h.kind, tone: "bg-sunk text-ink-soft" };
                  return (
                    <li key={h.id} className="relative">
                      <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-surface bg-line" aria-hidden />
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className={cn("rounded-full px-2 py-0.5 font-medium", k.tone)}>{k.label}</span>
                        <span className={cn("tabular font-semibold", h.days > 0 ? "text-ok" : h.days < 0 ? "text-danger" : "text-ink-soft")}>
                          {h.days > 0 ? "+" : ""}
                          {formatDays(h.days)}
                        </span>
                        <span className="tabular text-ink-faint">
                          {formatDays(h.before)} → {formatDays(h.after)}
                        </span>
                        {h.reference ? <span className="font-mono text-[10px] text-ink-faint">{h.reference}</span> : null}
                        {h.reversed ? <span className="text-[10px] text-danger">reversed</span> : null}
                      </div>
                      {h.reason ? <p className="mt-0.5 text-xs text-ink-soft">{h.reason}</p> : null}
                      <p className="text-[10px] text-ink-faint">
                        {h.byLabel ?? "system"} · {when(h.at)}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      )}
    </SideDrawer>
  );
}
