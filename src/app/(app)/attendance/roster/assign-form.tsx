"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CalendarCog, CheckCircle2, Loader2 } from "lucide-react";
import { assignShift, type ActionState } from "../actions";
import { Button, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { BsDateField } from "@/components/bs-date-field";

const initial: ActionState = { ok: false };

export function AssignForm({
  today,
  shifts,
  employees,
}: {
  today: string;
  shifts: { id: string; code: string; name: string }[];
  employees: { id: string; label: string; current: string | null; department: string | null }[];
}) {
  const [state, action, pending] = useActionState(assignShift, initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const err = (name: string) => state.fieldErrors?.[name];

  const visible = employees.filter((e) =>
    filter
      ? e.label.toLowerCase().includes(filter.toLowerCase()) ||
        (e.department ?? "").toLowerCase().includes(filter.toLowerCase())
      : true,
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader
        title="Assign a shift"
        description="Takes effect from the date given; earlier days keep the shift they were worked on."
      />
      <form action={action} className="flex flex-col gap-4 p-4">
        {state.message ? (
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
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Shift" required error={err("shiftId")}>
            <Select name="shiftId" defaultValue={shifts[0]?.id ?? ""}>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <BsDateField
            name="effectiveFrom"
            label="Effective from"
            required
            defaultValue={today}
            error={err("effectiveFrom")}
          />
        </div>

        <Field
          label={`Employees (${selected.size} selected)`}
          required
          error={err("employeeIds")}
        >
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or department"
          />
        </Field>

        <div className="max-h-56 overflow-y-auto rounded border border-line">
          <ul className="divide-y divide-line-soft">
            {visible.map((e) => (
              <li key={e.id}>
                <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-sunk">
                  <input
                    type="checkbox"
                    name="employeeIds"
                    value={e.id}
                    checked={selected.has(e.id)}
                    onChange={() => toggle(e.id)}
                    className="accent-accent"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{e.label}</span>
                  <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                    {e.current ?? "—"}
                  </span>
                </label>
              </li>
            ))}
            {visible.length === 0 ? (
              <li className="px-2.5 py-3 text-center text-xs text-ink-faint">Nobody matches</li>
            ) : null}
          </ul>
        </div>

        <Field label="Note" error={err("note")}>
          <Input name="note" placeholder="Rotation for Shrawan" maxLength={200} />
        </Field>

        <div>
          <Button type="submit" disabled={pending || selected.size === 0}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CalendarCog className="size-4" />
            )}
            {pending ? "Assigning" : `Assign ${selected.size || ""}`.trim()}
          </Button>
        </div>
      </form>
    </Card>
  );
}
