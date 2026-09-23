"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, LogOut } from "lucide-react";
import { Button, Field, Select, Textarea } from "@/components/ui";
import { BsDateField } from "@/components/bs-date-field";
import { SideDrawer } from "@/components/side-drawer";
import { initiateSeparationAction, type SeparationState } from "./actions";

const KINDS = [
  ["resignation", "Resignation"],
  ["termination", "Termination"],
  ["retirement", "Retirement"],
  ["contract_end", "End of contract"],
  ["death", "Death in service"],
  ["absconding", "Absconding"],
] as const;

const initial: SeparationState = {};

export function InitiateSeparation({
  people,
  today,
  preselect,
}: {
  people: { id: string; label: string; noticeDays: number | null }[];
  today: string;
  preselect: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!!preselect);
  const [state, action, pending] = useActionState(initiateSeparationAction, initial);
  const [employeeId, setEmployeeId] = useState(preselect ?? "");
  const person = people.find((p) => p.id === employeeId);
  const err = (k: string) => state.fieldErrors?.[k];

  const close = () => {
    setOpen(false);
    if (preselect) router.replace("/hr/separations");
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <LogOut className="size-4" />
        Record a separation
      </Button>
      {open ? (
        <SideDrawer
          title="Record a separation"
          subtitle="Opens a case with the no-dues checklist. The employee stays on strength until you complete it."
          onClose={close}
          action={action}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !employeeId}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Open case
              </Button>
            </>
          }
        >
          {state.error ? (
            <p className="mb-3 flex items-center gap-1.5 rounded bg-danger-soft px-3 py-2 text-xs text-danger">
              <AlertCircle className="size-3.5" />
              {state.error}
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
            <Field label="Kind" required className="sm:col-span-2">
              <Select name="kind" defaultValue="resignation">
                {KINDS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <BsDateField name="noticeDate" label="Notice given on" required defaultValue={today} error={err("noticeDate")} />
            <BsDateField
              name="lastWorkingDate"
              label="Last working day"
              required
              error={err("lastWorkingDate")}
              hint={person?.noticeDays ? `Their notice period is ${person.noticeDays} days` : undefined}
            />
            <Field label="Reason" className="sm:col-span-2" error={err("reason")}>
              <Textarea name="reason" maxLength={1000} placeholder="As given in the letter, or the grounds for the decision." />
            </Field>
          </div>
        </SideDrawer>
      ) : null}
    </>
  );
}
