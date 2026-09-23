"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, UserRoundPlus, X } from "lucide-react";
import {
  Badge,
  Button,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  TableShell,
  Td,
  Th,
} from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { enrolEmployee, removeEnrolment, type DeviceFormState } from "../actions";

/**
 * Who this reader can recognise.
 *
 * This is the table that decides whether a punch becomes attendance or becomes
 * an unmatched row nobody notices. The reader stores a finger template against
 * a number; only this mapping says whose finger it was.
 */

export type EnrolmentRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  photoFileId: string | null;
  designation: string | null;
  enrollNumber: string;
  enrolledAt: string;
  punchCount: number;
};

export type EmployeeOption = { id: string; label: string };

const EMPTY: DeviceFormState = { ok: false };

function AddForm({
  deviceId,
  options,
  suggestedNumber,
  onClose,
}: {
  deviceId: string;
  options: EmployeeOption[];
  suggestedNumber: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(enrolEmployee.bind(null, deviceId), EMPTY);
  const closed = useRef(false);

  useEffect(() => {
    if (state.ok && !closed.current) {
      closed.current = true;
      router.refresh();
      onClose();
    }
  }, [state.ok, router, onClose]);

  const err = state.fieldErrors ?? {};
  const sent = state.values ?? {};

  return (
    <form action={action} className="flex flex-col gap-3 border-t border-line-soft bg-sunk/40 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <UserRoundPlus className="size-4 text-accent" />
          Enrol an employee
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-ink-faint hover:bg-sunk hover:text-ink"
        >
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Employee" required error={err.employeeId}>
          <Select name="employeeId" defaultValue={sent.employeeId ?? ""} required>
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Number on the device"
          required
          error={err.enrollNumber}
          hint="The id the reader stores their template against"
        >
          <Input
            name="enrollNumber"
            defaultValue={sent.enrollNumber ?? suggestedNumber}
            maxLength={32}
            required
          />
        </Field>
      </div>

      {state.message && !state.ok ? <p className="text-sm text-danger">{state.message}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Enrol
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function EnrolmentPanel({
  deviceId,
  rows,
  options,
  suggestedNumber,
  canManage,
}: {
  deviceId: string;
  rows: EnrolmentRow[];
  options: EmployeeOption[];
  suggestedNumber: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  function remove(id: string) {
    setNotice(null);
    startBusy(async () => {
      const result = await removeEnrolment(id);
      setNotice({ tone: result.ok ? "ok" : "danger", text: result.message ?? "" });
      if (result.ok) {
        setConfirming(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <CardHeader
        title="Enrolments"
        description={`${rows.length} ${rows.length === 1 ? "person" : "people"} this reader can recognise`}
        action={
          canManage && !adding ? (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              Enrol
            </Button>
          ) : undefined
        }
      />

      {adding ? (
        <AddForm
          deviceId={deviceId}
          options={options}
          suggestedNumber={suggestedNumber}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {notice ? (
        <p
          className={
            notice.tone === "ok"
              ? "border-b border-line-soft bg-ok-soft px-4 py-2 text-sm text-ok"
              : "border-b border-line-soft bg-danger-soft px-4 py-2 text-sm text-danger"
          }
        >
          {notice.text}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="Nobody is enrolled"
          hint="Until somebody is enrolled, every punch this reader sends will land unmatched."
        />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <Th className="w-20">Number</Th>
              <Th>Employee</Th>
              <Th>Role</Th>
              <Th className="text-right">Punches</Th>
              {canManage ? <Th className="text-right">Actions</Th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line-soft last:border-0">
                <Td className="font-mono text-sm text-ink">#{r.enrollNumber}</Td>
                <Td>
                  <Link
                    href={`/hr/employees/${r.employeeId}`}
                    className="flex items-center gap-2 hover:text-accent"
                  >
                    <Avatar
                      photoId={r.photoFileId}
                      firstName={r.employeeName.split(" ")[0] ?? "?"}
                      lastName={r.employeeName.split(" ").slice(-1)[0] ?? ""}
                      seed={r.employeeId}
                      size="xs"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{r.employeeName}</span>
                      <span className="block font-mono text-[11px] text-ink-faint">
                        {r.employeeCode}
                      </span>
                    </span>
                  </Link>
                </Td>
                <Td className="text-ink-soft">{r.designation ?? "—"}</Td>
                <Td className="tabular text-right text-ink-soft">
                  {r.punchCount > 0 ? r.punchCount : <Badge tone="neutral">none yet</Badge>}
                </Td>
                {canManage ? (
                  <Td className="text-right">
                    {confirming === r.id ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-xs text-ink-soft">Remove?</span>
                        <Button variant="danger" onClick={() => remove(r.id)} disabled={busy}>
                          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                          Yes
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>
                          No
                        </Button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirming(r.id)}
                        disabled={busy}
                        title="Remove this enrolment"
                        className="rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-danger disabled:opacity-40"
                      >
                        <Trash2 className="size-4" />
                        <span className="sr-only">Remove enrolment for {r.employeeName}</span>
                      </button>
                    )}
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
    </>
  );
}
