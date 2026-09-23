"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Loader2, Save } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { SideDrawer } from "@/components/side-drawer";
import { useToastedAction } from "@/components/feedback";
import { cn } from "@/lib/utils";
import { saveLeaveTypeAction, type AdminState } from "../admin-actions";

export type TypeValues = Record<string, string | number | boolean | null>;

const initial: AdminState = {};

const TABS = [
  { key: "basics", label: "Basics", fields: ["code", "name", "nameNepali", "colour", "leaveGroupId", "nature", "paidPercent", "leaveOrder"] },
  { key: "balance", label: "Entitlement", fields: ["daysPerYear", "deductsBalance", "allowHalfDay", "allocationRule", "isAllocatedInFull"] },
  { key: "rules", label: "Rules", fields: ["appliesTo", "maritalStatus", "minNoticeDays", "maxConsecutiveDays", "requiresAttachmentAfterDays", "applyWindow", "qualifyFrom", "minDaysToQualify", "timesAllowedInService", "maxDaysToApply", "excludesHolidays", "excludesWeeklyOffs"] },
  { key: "approval", label: "Approval", fields: ["approvalLevels", "level1LimitDays", "level2LimitDays", "level3LimitDays", "level4LimitDays", "notifiesHr"] },
  { key: "yearend", label: "Year end & pay", fields: ["lapseType", "allowCarryForward", "maxCarryForwardDays", "maxAccumulationDays", "isEncashable", "minDaysToEncash", "maxDaysToEncash", "isExcessDeductedFromPay", "isDeductedFromServiceTime"] },
] as const;

export const NEW_TYPE: TypeValues = {
  code: "",
  name: "",
  nameNepali: "",
  colour: "#0f6e63",
  leaveGroupId: "",
  nature: "paid",
  paidPercent: 100,
  leaveOrder: 50,
  daysPerYear: 12,
  deductsBalance: true,
  allowHalfDay: true,
  allocationRule: "advance",
  isAllocatedInFull: true,
  appliesTo: "all",
  maritalStatus: "",
  minNoticeDays: 0,
  maxConsecutiveDays: "",
  requiresAttachmentAfterDays: "",
  applyWindow: "any",
  qualifyFrom: "date_of_join",
  minDaysToQualify: "",
  timesAllowedInService: "",
  maxDaysToApply: "",
  excludesHolidays: true,
  excludesWeeklyOffs: true,
  approvalLevels: 1,
  level1LimitDays: "",
  level2LimitDays: "",
  level3LimitDays: "",
  level4LimitDays: "",
  notifiesHr: false,
  lapseType: "yearly",
  allowCarryForward: false,
  maxCarryForwardDays: "",
  maxAccumulationDays: "",
  isEncashable: false,
  minDaysToEncash: "",
  maxDaysToEncash: "",
  isExcessDeductedFromPay: false,
  isDeductedFromServiceTime: false,
};

const SWATCHES = ["#0f6e63", "#2f6f9f", "#7c3aed", "#c2410c", "#b45309", "#be185d", "#15803d", "#4b5563", "#dc2626", "#0369a1"];

function Toggle({ name, label, hint, defaultChecked, onChange }: { name: string; label: string; hint?: string; defaultChecked: boolean; onChange?: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line-soft p-3 transition-colors hover:bg-sunk/50">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} onChange={(e) => onChange?.(e.target.checked)} className="peer sr-only" />
      <span
        className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full bg-line transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4"
        aria-hidden
      />
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint ? <span className="block text-xs text-ink-faint">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * Create or edit a leave type. Five tabs, one form: hidden tabs stay mounted
 * so every field posts, and a failed save jumps to the first tab with an error.
 */
export function TypeEditor({
  id,
  values,
  groups,
  onClose,
}: {
  id: string | null;
  values: TypeValues;
  groups: { id: string; name: string }[];
  onClose: () => void;
}) {
  const save = useToastedAction(saveLeaveTypeAction);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("basics");
  // close on success; on failure, show the tab that holds the first problem
  const [state, action, pending] = useActionState(async (prev: AdminState, fd: FormData) => {
    const r = await save(prev, fd);
    if (r.ok) onClose();
    else {
      const first = Object.keys(r.fieldErrors ?? {})[0];
      const owner = TABS.find((t) => (t.fields as readonly string[]).includes(first));
      if (owner) setTab(owner.key);
    }
    return r;
  }, initial);
  const [deducts, setDeducts] = useState(Boolean(values.deductsBalance));
  const [encashable, setEncashable] = useState(Boolean(values.isEncashable));
  const [carry, setCarry] = useState(Boolean(values.allowCarryForward));
  const [levels, setLevels] = useState(Number(values.approvalLevels) || 1);
  const [colour, setColour] = useState(String(values.colour ?? "#0f6e63"));
  const [lapse, setLapse] = useState(String(values.lapseType ?? "yearly"));
  const err = (f: string) => state.fieldErrors?.[f];

  const tabErrors = (key: string) => {
    const t = TABS.find((x) => x.key === key)!;
    return (t.fields as readonly string[]).some((f) => state.fieldErrors?.[f]);
  };
  const v = (k: string) => (values[k] === null || values[k] === undefined ? "" : String(values[k]));

  return (
    <SideDrawer
      title={id ? `Edit ${values.name}` : "New leave type"}
      subtitle={id ? `Code ${values.code}` : "Everything the approval engine, attendance and payroll need to know about it."}
      onClose={onClose}
      action={action}
      width="max-w-2xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {id ? "Save changes" : "Create leave type"}
          </Button>
        </>
      }
    >
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <input type="hidden" name="unit" value={v("unit") || "day"} />

      <div className="-mx-5 -mt-4 mb-4 flex gap-1 overflow-x-auto border-b border-line px-5" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
              tab === t.key ? "border-accent font-medium text-accent" : "border-transparent text-ink-soft hover:text-ink",
            )}
          >
            {t.label}
            {tabErrors(t.key) ? <span className="size-1.5 rounded-full bg-danger" aria-label="has errors" /> : null}
          </button>
        ))}
      </div>

      {state.error ? (
        <p className="mb-4 flex items-center gap-1.5 rounded bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          <AlertCircle className="size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}

      {/* ------------------------------------------------------------ basics */}
      <div className={tab === "basics" ? "grid gap-4 sm:grid-cols-2" : "hidden"}>
        <Field label="Name" required error={err("name")} className="sm:col-span-2">
          <Input name="name" defaultValue={v("name")} maxLength={80} placeholder="Home Leave" />
        </Field>
        <Field label="Code" required error={err("code")} hint="Short and permanent — shown on reports">
          <Input name="code" defaultValue={v("code")} maxLength={16} className="font-mono uppercase" placeholder="HOME" />
        </Field>
        <Field label="Name in Nepali" error={err("nameNepali")}>
          <Input name="nameNepali" defaultValue={v("nameNepali")} maxLength={80} placeholder="घर बिदा" />
        </Field>
        <div className="flex flex-col gap-1 sm:col-span-2" role="group" aria-labelledby="colour-label">
          <span id="colour-label" className="text-xs font-medium text-ink-soft">Colour</span>
          <span className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColour(c)}
                className={cn("size-7 rounded-full ring-offset-2 ring-offset-surface transition", colour === c ? "ring-2 ring-ink" : "hover:scale-110")}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                aria-pressed={colour === c}
              />
            ))}
            <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-line bg-surface" aria-label="Custom colour" />
            <input type="hidden" name="colour" value={colour} />
          </span>
          <span className={cn("text-xs", err("colour") ? "text-danger" : "text-ink-faint")}>{err("colour") ?? "Used on calendars and charts"}</span>
        </div>
        <Field label="What a day of it is" required error={err("nature")} hint="Drives the attendance status and payroll rule">
          <Select name="nature" defaultValue={v("nature")}>
            <option value="paid">Paid leave</option>
            <option value="unpaid">Unpaid leave</option>
            <option value="official_work">Official work / field duty</option>
            <option value="substitute">Substitute (comp-off)</option>
            <option value="transit">Transit</option>
            <option value="holiday">Holiday</option>
            <option value="absent">Absent</option>
          </Select>
        </Field>
        <Field label="Paid at (%)" required error={err("paidPercent")} hint="What payroll pays for a day of it">
          <Input name="paidPercent" type="number" min={0} max={100} step="1" defaultValue={v("paidPercent")} className="tabular" />
        </Field>
        <Field label="Group" error={err("leaveGroupId")}>
          <Select name="leaveGroupId" defaultValue={v("leaveGroupId")}>
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Order" error={err("leaveOrder")} hint="Lower comes first in lists and deduction">
          <Input name="leaveOrder" type="number" min={0} max={999} defaultValue={v("leaveOrder")} className="tabular" />
        </Field>
      </div>

      {/* ----------------------------------------------------------- balance */}
      <div className={tab === "balance" ? "grid gap-4 sm:grid-cols-2" : "hidden"}>
        <div className="sm:col-span-2">
          <Toggle name="deductsBalance" label="Tracked against a balance" hint="Off for unlimited leave such as leave without pay or field work" defaultChecked={deducts} onChange={setDeducts} />
        </div>
        <Field label="Days per year" required={deducts} error={err("daysPerYear")} hint="The default; employment types can override it on the policy screen">
          <Input name="daysPerYear" type="number" min={0} max={366} step="0.5" defaultValue={v("daysPerYear")} readOnly={!deducts} className={cn("tabular", !deducts && "opacity-50")} />
        </Field>
        <Field label="Allocation" error={err("allocationRule")}>
          <Select name="allocationRule" defaultValue={v("allocationRule")}>
            <option value="advance">In advance — the whole year is available at once</option>
            <option value="matured_only">Only what has been earned so far</option>
            <option value="negative">May go negative</option>
            <option value="no_tracking">Not tracked</option>
          </Select>
        </Field>
        <Toggle name="allowHalfDay" label="Half days allowed" defaultChecked={Boolean(values.allowHalfDay)} />
        <Toggle name="isAllocatedInFull" label="Allocated in full" hint="Otherwise it accrues month by month" defaultChecked={Boolean(values.isAllocatedInFull)} />
      </div>

      {/* ------------------------------------------------------------- rules */}
      <div className={tab === "rules" ? "grid gap-4 sm:grid-cols-2" : "hidden"}>
        <Field label="Who can take it" error={err("appliesTo")}>
          <Select name="appliesTo" defaultValue={v("appliesTo")}>
            <option value="all">Everyone</option>
            <option value="female">Women only</option>
            <option value="male">Men only</option>
          </Select>
        </Field>
        <Field label="Marital status" error={err("maritalStatus")}>
          <Select name="maritalStatus" defaultValue={v("maritalStatus")}>
            <option value="">Any</option>
            <option value="married">Married</option>
            <option value="single">Single</option>
            <option value="divorced">Divorced</option>
            <option value="widowed">Widowed</option>
          </Select>
        </Field>
        <Field label="Notice (days)" error={err("minNoticeDays")} hint="How far ahead it must be applied for">
          <Input name="minNoticeDays" type="number" min={0} max={365} defaultValue={v("minNoticeDays")} className="tabular" />
        </Field>
        <Field label="Longest single request (days)" error={err("maxConsecutiveDays")}>
          <Input name="maxConsecutiveDays" type="number" min={1} max={366} defaultValue={v("maxConsecutiveDays")} className="tabular" placeholder="No limit" />
        </Field>
        <Field label="Document needed after (days)" error={err("requiresAttachmentAfterDays")} hint="e.g. a medical certificate">
          <Input name="requiresAttachmentAfterDays" type="number" min={0} max={366} defaultValue={v("requiresAttachmentAfterDays")} className="tabular" placeholder="Never" />
        </Field>
        <Field label="When it can be applied" error={err("applyWindow")}>
          <Select name="applyWindow" defaultValue={v("applyWindow")}>
            <option value="any">Before or after the day</option>
            <option value="pre">Only in advance</option>
            <option value="post">Only afterwards (e.g. sick)</option>
          </Select>
        </Field>
        <Field label="Service counted from" error={err("qualifyFrom")}>
          <Select name="qualifyFrom" defaultValue={v("qualifyFrom")}>
            <option value="date_of_join">Date of joining</option>
            <option value="date_of_permanent">Date made permanent</option>
            <option value="contract_start">Contract start</option>
            <option value="probation_start">Probation start</option>
          </Select>
        </Field>
        <Field label="Service needed first (days)" error={err("minDaysToQualify")}>
          <Input name="minDaysToQualify" type="number" min={0} max={3650} defaultValue={v("minDaysToQualify")} className="tabular" placeholder="None" />
        </Field>
        <Field label="Times allowed in service" error={err("timesAllowedInService")} hint="e.g. maternity twice">
          <Input name="timesAllowedInService" type="number" min={1} max={99} defaultValue={v("timesAllowedInService")} className="tabular" placeholder="Unlimited" />
        </Field>
        <Field label="Longest in service (days)" error={err("maxDaysToApply")}>
          <Input name="maxDaysToApply" type="number" min={1} max={3650} defaultValue={v("maxDaysToApply")} className="tabular" placeholder="No limit" />
        </Field>
        <Toggle name="excludesHolidays" label="Public holidays are not charged" defaultChecked={Boolean(values.excludesHolidays)} />
        <Toggle name="excludesWeeklyOffs" label="Saturdays are not charged" defaultChecked={Boolean(values.excludesWeeklyOffs)} />
      </div>

      {/* ---------------------------------------------------------- approval */}
      <div className={tab === "approval" ? "grid gap-4 sm:grid-cols-2" : "hidden"}>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <span id="levels-label" className="text-xs font-medium text-ink-soft">
            Approval levels<span className="ml-0.5 text-danger">*</span>
          </span>
          <span className="flex gap-1.5" role="radiogroup" aria-labelledby="levels-label">
            {[1, 2, 3, 4].map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={levels === l}
                aria-label={`${l} level${l === 1 ? "" : "s"}`}
                onClick={() => setLevels(l)}
                className={cn(
                  "tabular min-w-12 rounded-md border px-3 py-1.5 text-sm transition-colors",
                  levels === l ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line text-ink-soft hover:bg-sunk",
                )}
              >
                {l}
              </button>
            ))}
            <input type="hidden" name="approvalLevels" value={levels} />
          </span>
          {err("approvalLevels") ? (
            <span className="text-xs text-danger">{err("approvalLevels")}</span>
          ) : (
            <span className="text-xs text-ink-faint">Supervisor first, then up the reporting line</span>
          )}
        </div>
        {[1, 2, 3, 4].map((l) => (
          <Field
            key={l}
            label={`Level ${l} may approve up to (days)`}
            error={err(`level${l}LimitDays`)}
            hint={l === levels ? "The last level has the final say" : "Longer requests go to the next level"}
            className={l > levels ? "opacity-40" : undefined}
          >
            <Input name={`level${l}LimitDays`} type="number" min={1} max={366} defaultValue={v(`level${l}LimitDays`)} disabled={l > levels} className="tabular" placeholder="No ceiling" />
          </Field>
        ))}
        <div className="sm:col-span-2">
          <Toggle name="notifiesHr" label="Tell HR about every request" hint="Whoever approves it" defaultChecked={Boolean(values.notifiesHr)} />
        </div>
      </div>

      {/* ---------------------------------------------------------- year end */}
      <div className={tab === "yearend" ? "grid gap-4 sm:grid-cols-2" : "hidden"}>
        <Field label="Unused days" required error={err("lapseType")} className="sm:col-span-2">
          <Select name="lapseType" value={lapse} onChange={(e) => setLapse(e.target.value)}>
            <option value="yearly">Lapse at the end of the fiscal year</option>
            <option value="none">Never lapse — carried year to year</option>
            <option value="monthly">Lapse at the end of each month</option>
            <option value="service_period">Per event (maternity, study) — not carried</option>
          </Select>
        </Field>
        {lapse === "yearly" || lapse === "none" ? (
          <>
            <Toggle name="allowCarryForward" label={lapse === "none" ? "Cap what carries each year" : "Some days carry forward"} defaultChecked={carry} onChange={setCarry} />
            <Field label="Carry forward up to (days)" error={err("maxCarryForwardDays") ?? err("allowCarryForward")}>
              <Input name="maxCarryForwardDays" type="number" min={0} max={999} step="0.5" defaultValue={v("maxCarryForwardDays")} disabled={!carry} className="tabular" placeholder="All" />
            </Field>
          </>
        ) : (
          <input type="hidden" name="allowCarryForward" value="false" />
        )}
        <Field label="Most that can be held (days)" error={err("maxAccumulationDays")} hint="Beyond this, days must be encashed or lapse">
          <Input name="maxAccumulationDays" type="number" min={0} max={999} step="0.5" defaultValue={v("maxAccumulationDays")} className="tabular" placeholder="No ceiling" />
        </Field>
        <div />
        <div className="sm:col-span-2">
          <Toggle name="isEncashable" label="Can be encashed" hint="Unused days paid out, recorded under Leave › Encashment" defaultChecked={encashable} onChange={setEncashable} />
        </div>
        <Field label="Encash at least (days)" error={err("minDaysToEncash")}>
          <Input name="minDaysToEncash" type="number" min={0} max={366} step="0.5" defaultValue={v("minDaysToEncash")} disabled={!encashable} className="tabular" placeholder="Any" />
        </Field>
        <Field label="Encash at most (days)" error={err("maxDaysToEncash")}>
          <Input name="maxDaysToEncash" type="number" min={0} max={366} step="0.5" defaultValue={v("maxDaysToEncash")} disabled={!encashable} className="tabular" placeholder="All available" />
        </Field>
        <Toggle name="isExcessDeductedFromPay" label="Recover excess days from pay" hint="Days taken beyond the balance at year end" defaultChecked={Boolean(values.isExcessDeductedFromPay)} />
        <Toggle name="isDeductedFromServiceTime" label="Does not count as service" hint="e.g. long unpaid leave" defaultChecked={Boolean(values.isDeductedFromServiceTime)} />
      </div>
    </SideDrawer>
  );
}
