"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Plus } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { BsDateField } from "@/components/bs-date-field";
import { SideDrawer } from "@/components/side-drawer";
import { recordMovementAction, type MovementState } from "./actions";

type Option = { id: string; name: string };

export type MovablePerson = {
  id: string;
  label: string;
  branchId: string | null;
  departmentId: string | null;
  designationId: string | null;
  gradeId: string | null;
  supervisorId: string | null;
  basicSalary: string | null;
};

const KINDS = [
  { value: "transfer", label: "Transfer", hint: "A new branch or department." },
  { value: "promotion", label: "Promotion", hint: "A more senior designation or grade." },
  { value: "demotion", label: "Demotion", hint: "A less senior designation or grade." },
  { value: "redesignation", label: "Re-designation", hint: "Same level, a different title." },
  { value: "salary_revision", label: "Salary revision", hint: "A new basic salary on the same placement." },
  { value: "supervisor_change", label: "Change of supervisor", hint: "Who approvals route to first." },
] as const;

const initial: MovementState = {};

export function MovementForm({
  people,
  options,
  canSeeSalary,
  today,
  preselect,
}: {
  people: MovablePerson[];
  options: { branches: Option[]; departments: Option[]; designations: Option[]; grades: Option[]; supervisors: Option[] };
  canSeeSalary: boolean;
  today: string;
  preselect: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!!preselect);
  const [flash, setFlash] = useState<string | null>(null);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Record a movement
      </Button>
      {flash ? (
        <p className="flex items-center gap-1.5 rounded bg-ok-soft px-3 py-1.5 text-xs text-ok" role="status">
          <CheckCircle2 className="size-3.5" />
          {flash}
        </p>
      ) : null}
      {open ? (
        <Drawer
          people={people}
          options={options}
          canSeeSalary={canSeeSalary}
          today={today}
          preselect={preselect}
          onClose={() => {
            setOpen(false);
            if (preselect) router.replace("/hr/transfers");
          }}
          onSaved={(m) => {
            setOpen(false);
            setFlash(m);
            if (preselect) router.replace("/hr/transfers");
          }}
        />
      ) : null}
    </>
  );
}

function Drawer({
  people,
  options,
  canSeeSalary,
  today,
  preselect,
  onClose,
  onSaved,
}: {
  people: MovablePerson[];
  options: { branches: Option[]; departments: Option[]; designations: Option[]; grades: Option[]; supervisors: Option[] };
  canSeeSalary: boolean;
  today: string;
  preselect: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [state, action, pending] = useActionState(recordMovementAction, initial);
  const [employeeId, setEmployeeId] = useState(preselect ?? "");
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("transfer");
  const person = useMemo(() => people.find((p) => p.id === employeeId) ?? null, [people, employeeId]);

  useEffect(() => {
    if (state.at && state.ok) onSaved(state.ok);
  }, [state.at, state.ok, onSaved]);

  const err = (k: string) => state.fieldErrors?.[k];
  const name = (list: Option[], id: string | null) => list.find((o) => o.id === id)?.name ?? "—";

  // which "to" fields a kind is about; the rest stay available but folded away
  const focus: Record<string, string[]> = {
    transfer: ["toBranchId", "toDepartmentId", "toSupervisorId"],
    promotion: ["toDesignationId", "toGradeId", "toBasicSalary"],
    demotion: ["toDesignationId", "toGradeId", "toBasicSalary"],
    redesignation: ["toDesignationId"],
    salary_revision: ["toBasicSalary", "toGradeId"],
    supervisor_change: ["toSupervisorId"],
  };
  const shown = new Set(focus[kind]);
  const [showAll, setShowAll] = useState(false);
  const visible = (f: string) => showAll || shown.has(f);

  const pick = (field: string, label: string, list: Option[], current: string | null) =>
    visible(field) ? (
      <Field label={label} error={err(field)}>
        <Select name={field} defaultValue="">
          <option value="">Unchanged{person ? ` (${name(list, current)})` : ""}</option>
          {list
            .filter((o) => o.id !== current && o.id !== person?.id)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </Select>
      </Field>
    ) : null;

  return (
    <SideDrawer
      title="Record a movement"
      subtitle="Dated today or earlier it applies at once; a future date schedules it."
      onClose={onClose}
      action={action}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !employeeId}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            Record
          </Button>
        </>
      }
    >
      {state.error ? (
        <p className="mb-3 flex items-center gap-1.5 rounded bg-danger-soft px-3 py-2 text-xs text-danger">
          <AlertCircle className="size-3.5" />
          {state.error}
          {/* an error on a field this kind does not show would otherwise be invisible */}
          {Object.entries(state.fieldErrors ?? {})
            .filter(([k]) => k.startsWith("to") && !visible(k))
            .map(([k, m]) => ` ${k.replace(/^to|Id$/g, "")}: ${m}`)
            .join(";")}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee" required error={err("employeeId")} className="sm:col-span-2">
          <Select name="employeeId" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Kind" required className="sm:col-span-2" hint={KINDS.find((k) => k.value === kind)?.hint}>
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>

        <BsDateField name="effectiveDate" label="Effective from" required defaultValue={today} error={err("effectiveDate")} />
        <Field label="Office order / letter no." error={err("letterNumber")}>
          <Input name="letterNumber" maxLength={60} />
        </Field>

        {pick("toBranchId", "New branch", options.branches, person?.branchId ?? null)}
        {pick("toDepartmentId", "New department", options.departments, person?.departmentId ?? null)}
        {pick("toDesignationId", "New designation", options.designations, person?.designationId ?? null)}
        {pick("toGradeId", "New grade", options.grades, person?.gradeId ?? null)}
        {pick("toSupervisorId", "New supervisor", options.supervisors, person?.supervisorId ?? null)}
        {canSeeSalary && visible("toBasicSalary") ? (
          <Field
            label="New basic salary (NPR)"
            error={err("toBasicSalary")}
            hint={person?.basicSalary ? `Currently ${Number(person.basicSalary).toLocaleString("en-IN")}` : undefined}
          >
            <Input name="toBasicSalary" inputMode="decimal" className="tabular" />
          </Field>
        ) : null}

        {!showAll ? (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-left text-xs text-accent hover:underline sm:col-span-2"
          >
            Change something else at the same time…
          </button>
        ) : null}

        <Field label="Reason" error={err("reason")} className="sm:col-span-2">
          <Textarea name="reason" maxLength={500} placeholder="Why, in a line — it goes into the service history." />
        </Field>
      </div>
    </SideDrawer>
  );
}
