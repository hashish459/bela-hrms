"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Send } from "lucide-react";
import { raiseAttendanceRequest, type ActionState } from "../actions";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { BsDateField } from "@/components/bs-date-field";
import { REQUEST_TYPE_LABEL } from "@/lib/attendance/calc";

const initial: ActionState = { ok: false };

/** Types that do not change the clock, so the time fields are hidden for them. */
const NO_TIME_TYPES = new Set(["late_excuse", "on_duty"]);

export function RequestForm({
  today,
  earliest,
  flagged,
  defaultTimes,
}: {
  today: string;
  earliest: string;
  flagged: {
    date: string;
    dateBs: string;
    status: string;
    checkIn: string | null;
    checkOut: string | null;
  }[];
  defaultTimes: { checkIn: string; checkOut: string };
}) {
  const [state, action, pending] = useActionState(raiseAttendanceRequest, initial);
  const [requestType, setRequestType] = useState("missing_punch");
  const [date, setDate] = useState("");

  const err = (name: string) => state.fieldErrors?.[name];
  const showTimes = !NO_TIME_TYPES.has(requestType);
  const picked = flagged.find((f) => f.date === date);

  return (
    <Card>
      <CardHeader
        title="Raise a correction"
        description="Approved corrections recalculate the day — lateness, overtime and payable status."
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
          <Field label="What needs correcting" required error={err("requestType")}>
            <Select
              name="requestType"
              value={requestType}
              onChange={(e) => setRequestType(e.target.value)}
            >
              {Object.entries(REQUEST_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <div onChange={(e) => setDate((e.target as HTMLInputElement).value || date)}>
            <BsDateField
              name="date"
              label="Date"
              required
              error={err("date")}
              hint={`Between ${earliest} and ${today}`}
            />
          </div>
        </div>

        {picked ? (
          <p className="tabular rounded bg-sunk px-2.5 py-1.5 text-xs text-ink-soft">
            Currently recorded on {picked.dateBs}: {picked.checkIn?.slice(0, 5) ?? "no in"} –{" "}
            {picked.checkOut?.slice(0, 5) ?? "no out"} ({picked.status.replace(/_/g, " ")})
          </p>
        ) : null}

        {showTimes ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Check-in should be" error={err("requestedCheckIn")}>
              <Input
                type="time"
                name="requestedCheckIn"
                defaultValue={defaultTimes.checkIn}
                className="tabular"
              />
            </Field>
            <Field label="Check-out should be" error={err("requestedCheckOut")}>
              <Input
                type="time"
                name="requestedCheckOut"
                defaultValue={defaultTimes.checkOut}
                className="tabular"
              />
            </Field>
          </div>
        ) : (
          <>
            <input type="hidden" name="requestedCheckIn" value="" />
            <input type="hidden" name="requestedCheckOut" value="" />
          </>
        )}

        <Field label="Reason" required error={err("reason")}>
          <Textarea
            name="reason"
            maxLength={500}
            placeholder="What happened, and why the recorded times are wrong"
          />
        </Field>

        <div>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {pending ? "Submitting" : "Submit request"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
