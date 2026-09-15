"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Send } from "lucide-react";
import { applyForLeave, type ActionState } from "../actions";
import { Button, Card, CardHeader, Field, Select, Textarea } from "@/components/ui";
import { BsDateField } from "@/components/bs-date-field";
import { formatDays } from "@/lib/utils";

const initial: ActionState = { ok: false };

export function ApplyForm({
  leaveTypes,
  colleagues,
}: {
  leaveTypes: { id: string; name: string; available: number | null }[];
  colleagues: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(applyForLeave, initial);
  const [typeId, setTypeId] = useState(leaveTypes[0]?.id ?? "");
  const [portion, setPortion] = useState("full");

  const selected = leaveTypes.find((t) => t.id === typeId);
  const err = (name: string) => state.fieldErrors?.[name];

  return (
    <Card>
      <CardHeader
        title="Apply for leave"
        description="Saturdays and public holidays are not deducted."
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
          <Field
            label="Leave type"
            required
            error={err("leaveTypeId")}
            hint={
              selected?.available !== null && selected?.available !== undefined
                ? `${formatDays(selected.available)} day(s) available`
                : "Not deducted from a balance"
            }
          >
            <Select
              name="leaveTypeId"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              required
            >
              {leaveTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.available !== null ? ` — ${formatDays(t.available)} left` : ""}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Duration" error={err("portion")}>
            <Select name="portion" value={portion} onChange={(e) => setPortion(e.target.value)}>
              <option value="full">Full day(s)</option>
              <option value="first_half">First half only</option>
              <option value="second_half">Second half only</option>
            </Select>
          </Field>

          <BsDateField name="fromDate" label="From" required error={err("fromDate")} />
          <BsDateField name="toDate" label="To" required error={err("toDate")} />
        </div>

        <Field label="Reason" required error={err("reason")}>
          <Textarea name="reason" placeholder="Why you need the time off" maxLength={500} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact while away" hint="Phone or email" error={err("contactDuringLeave")}>
            <input
              name="contactDuringLeave"
              className="w-full rounded border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint"
              placeholder="98XXXXXXXX"
            />
          </Field>
          <Field label="Handover to" hint="Who covers your work" error={err("handoverToEmployeeId")}>
            <Select name="handoverToEmployeeId" defaultValue="">
              <option value="">Nobody specified</option>
              {colleagues.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <Button type="submit" disabled={pending || leaveTypes.length === 0}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {pending ? "Submitting" : "Submit request"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
