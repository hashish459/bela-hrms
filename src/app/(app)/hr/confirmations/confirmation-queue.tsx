"use client";

import { Fragment, useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, CalendarPlus, Loader2, UserX } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  TableShell,
  Td,
  Textarea,
  Th,
  Tr,
} from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { decideProbation, type ConfirmationState } from "./actions";

/**
 * The probation review queue.
 *
 * The decision is taken in the row, not on a separate page. A reviewer works
 * through a list of people whose probation has come up; sending them to a
 * detail screen and back for each one is how a queue of fifteen becomes a job
 * nobody finishes.
 */

export type ProbationRow = {
  id: string;
  code: string;
  name: string;
  photoFileId: string | null;
  designation: string | null;
  department: string | null;
  supervisorName: string | null;
  dateOfJoinBs: string;
  probationEndDate: string | null;
  probationEndBs: string | null;
  state: "overdue" | "due" | "upcoming" | "unscheduled";
  stateLabel: string;
  tenureMonths: number;
};

const TONE = {
  overdue: "danger",
  due: "warn",
  upcoming: "info",
  unscheduled: "neutral",
} as const;

const EMPTY: ConfirmationState = { ok: false };

type Outcome = "confirmed" | "extended" | "terminated";

const OUTCOMES: { value: Outcome; label: string; hint: string; icon: typeof BadgeCheck }[] = [
  {
    value: "confirmed",
    label: "Confirm",
    hint: "Moves the employee to permanent from the effective date.",
    icon: BadgeCheck,
  },
  {
    value: "extended",
    label: "Extend probation",
    hint: "Keeps them on probation until a new end date.",
    icon: CalendarPlus,
  },
  {
    value: "terminated",
    label: "Do not confirm",
    hint: "Ends the engagement on the effective date.",
    icon: UserX,
  },
];

function DecisionPanel({
  row,
  today,
  onDone,
  onCancel,
}: {
  row: ProbationRow;
  today: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(decideProbation.bind(null, row.id), EMPTY);
  // Seeded from the rejected submission, so a failed "Extend" does not snap
  // back to "Confirm" and hide the field the error is about.
  const [outcome, setOutcome] = useState<Outcome>(
    (state.values?.outcome as Outcome | undefined) ?? "confirmed",
  );

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onDone();
    }
  }, [state.ok, router, onDone]);

  const err = state.fieldErrors ?? {};
  const sent = state.values ?? {};
  const selected = OUTCOMES.find((o) => o.value === outcome)!;

  return (
    <form action={action} className="flex flex-col gap-3 py-2">
      <input type="hidden" name="outcome" value={outcome} />

      <div className="flex flex-wrap gap-1.5">
        {OUTCOMES.map((o) => {
          const Icon = o.icon;
          const active = o.value === outcome;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setOutcome(o.value)}
              aria-pressed={active}
              className={
                "inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-sm font-medium transition-colors " +
                (active
                  ? o.value === "terminated"
                    ? "border-transparent bg-danger-soft text-danger"
                    : "border-transparent bg-accent text-on-accent"
                  : "border-line bg-surface text-ink-soft hover:bg-sunk hover:text-ink")
              }
            >
              <Icon className="size-4" />
              {o.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-ink-faint">{selected.hint}</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Effective from" required error={err.effectiveDate}>
          <Input type="date" name="effectiveDate" defaultValue={sent.effectiveDate ?? today} required />
        </Field>

        {outcome === "extended" ? (
          <Field
            label="New probation ends"
            required
            error={err.newProbationEndDate}
            hint={row.probationEndBs ? `Currently ${row.probationEndBs}` : "None set"}
          >
            <Input
              type="date"
              name="newProbationEndDate"
              defaultValue={sent.newProbationEndDate ?? ""}
              required
            />
          </Field>
        ) : null}

        <Field
          label={outcome === "confirmed" ? "Remarks" : "Reason"}
          required={outcome !== "confirmed"}
          error={err.remarks}
          className={outcome === "extended" ? "sm:col-span-2" : "sm:col-span-2 lg:col-span-3"}
        >
          <Textarea
            name="remarks"
            rows={2}
            defaultValue={sent.remarks ?? ""}
            placeholder={
              outcome === "confirmed"
                ? "Optional — performance during probation, supervisor's recommendation"
                : "Recorded against the employee's file"
            }
            className="min-h-16"
          />
        </Field>
      </div>

      {state.message && !state.ok ? <p className="text-sm text-danger">{state.message}</p> : null}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant={outcome === "terminated" ? "danger" : "primary"}
          disabled={pending}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Record decision
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ConfirmationQueue({
  rows,
  today,
  canDecide,
}: {
  rows: ProbationRow[];
  today: string;
  canDecide: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nobody is on probation"
        hint="Reviews appear here as probation end dates approach."
      />
    );
  }

  return (
    <TableShell>
      <thead>
        <tr>
          <Th>Employee</Th>
          <Th>Role</Th>
          <Th>Joined (BS)</Th>
          <Th>Probation ends (BS)</Th>
          <Th>Review</Th>
          <Th className="text-right">Decision</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Fragment key={r.id}>
            <Tr>
              <Td>
                <Link
                  href={`/hr/employees/${r.id}`}
                  className="flex items-center gap-2 hover:text-accent"
                >
                  <Avatar
                    photoId={r.photoFileId}
                    firstName={r.name.split(" ")[0] ?? "?"}
                    lastName={r.name.split(" ").slice(-1)[0] ?? ""}
                    seed={r.id}
                    size="sm"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{r.name}</span>
                    <span className="block font-mono text-[11px] text-ink-faint">{r.code}</span>
                  </span>
                </Link>
              </Td>

              <Td>
                <span className="block text-sm text-ink-soft">{r.designation ?? "—"}</span>
                <span className="block text-[11px] text-ink-faint">{r.department ?? "—"}</span>
              </Td>

              <Td className="tabular text-ink-soft">
                <span className="block">{r.dateOfJoinBs}</span>
                <span className="block text-[11px] text-ink-faint">
                  {r.tenureMonths} month{r.tenureMonths === 1 ? "" : "s"} served
                </span>
              </Td>

              <Td className="tabular text-ink-soft">{r.probationEndBs ?? "—"}</Td>

              <Td>
                <Badge tone={TONE[r.state]}>{r.stateLabel}</Badge>
                {r.supervisorName ? (
                  <span className="mt-0.5 block text-[11px] text-ink-faint">
                    Supervisor: {r.supervisorName}
                  </span>
                ) : (
                  <span className="mt-0.5 block text-[11px] text-warn">No supervisor assigned</span>
                )}
              </Td>

              <Td className="text-right">
                {canDecide ? (
                  <Button
                    variant={open === r.id ? "ghost" : "secondary"}
                    onClick={() => setOpen(open === r.id ? null : r.id)}
                  >
                    {open === r.id ? "Close" : "Review"}
                  </Button>
                ) : (
                  <span className="text-xs text-ink-faint">View only</span>
                )}
              </Td>
            </Tr>

            {open === r.id ? (
              <tr className="bg-sunk/60">
                <Td colSpan={6}>
                  <DecisionPanel
                    row={r}
                    today={today}
                    onDone={() => setOpen(null)}
                    onCancel={() => setOpen(null)}
                  />
                </Td>
              </tr>
            ) : null}
          </Fragment>
        ))}
      </tbody>
    </TableShell>
  );
}
