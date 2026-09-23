"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Router, X } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { saveDevice, type DeviceFormState } from "./actions";
import {
  CONNECTIONS,
  CONNECTION_LABEL,
  DEVICE_KINDS,
  DEVICE_STATUSES,
  DIRECTIONS,
  DIRECTION_HINT,
  DIRECTION_LABEL,
  KIND_LABEL,
  STATUS_LABEL,
} from "./options";

export type EditableDevice = {
  id: string;
  code: string;
  name: string;
  branchId: string | null;
  location: string | null;
  kind: string;
  connection: string;
  direction: string;
  status: string;
  vendor: string | null;
  model: string | null;
  serialNumber: string | null;
  ipAddress: string | null;
  port: number | null;
  syncIntervalMinutes: number;
  notes: string | null;
};

const EMPTY: DeviceFormState = { ok: false };

export function DeviceForm({
  device,
  branches,
  onClose,
}: {
  device?: EditableDevice;
  branches: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveDevice.bind(null, device?.id ?? null), EMPTY);
  const closed = useRef(false);

  /*
   * The connection and direction are the two fields people get wrong, and
   * getting them wrong is not obvious afterwards — a reader set to `in_only`
   * produces a month of missing punches before anybody works out why. Both are
   * mirrored into state so the form can explain the consequence as it is
   * chosen rather than in a tooltip nobody opens.
   */
  const [connection, setConnection] = useState(device?.connection ?? "tcp_ip");
  const [direction, setDirection] = useState(device?.direction ?? "alternating");

  useEffect(() => {
    if (state.ok && !closed.current) {
      closed.current = true;
      router.refresh();
      onClose();
    }
  }, [state.ok, router, onClose]);

  const err = state.fieldErrors ?? {};
  const sent = state.values ?? {};
  const networked = connection === "tcp_ip";

  return (
    <form action={action} className="flex flex-col gap-4 border-t border-line-soft bg-sunk/40 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Router className="size-4 text-accent" />
          {device ? `Edit ${device.code}` : "Add a device"}
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Code" required error={err.code} hint="Quoted in support calls">
          <Input
            name="code"
            defaultValue={sent.code ?? device?.code ?? ""}
            placeholder="GATE-01"
            maxLength={24}
            required
          />
        </Field>

        <Field label="Name" required error={err.name} className="sm:col-span-2">
          <Input
            name="name"
            defaultValue={sent.name ?? device?.name ?? ""}
            placeholder="Main gate fingerprint reader"
            maxLength={120}
            required
          />
        </Field>

        <Field label="Status" error={err.status}>
          <Select name="status" defaultValue={sent.status ?? device?.status ?? "active"}>
            {DEVICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Branch" error={err.branchId} hint="Where the reader stands">
          <Select name="branchId" defaultValue={sent.branchId ?? device?.branchId ?? ""}>
            <option value="">Not assigned</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Location" error={err.location}>
          <Input
            name="location"
            defaultValue={sent.location ?? device?.location ?? ""}
            placeholder="Reception, ground floor"
          />
        </Field>

        <Field label="Reads" error={err.kind}>
          <Select name="kind" defaultValue={sent.kind ?? device?.kind ?? "fingerprint"}>
            {DEVICE_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Counts punches as"
          error={err.direction}
          hint={DIRECTION_HINT[direction]}
          className="sm:col-span-2 lg:col-span-1"
        >
          <Select
            name="direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {DIRECTION_LABEL[d]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Connection" error={err.connection}>
          <Select
            name="connection"
            value={connection}
            onChange={(e) => setConnection(e.target.value)}
          >
            {CONNECTIONS.map((c) => (
              <option key={c} value={c}>
                {CONNECTION_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="IP address"
          error={err.ipAddress}
          hint={networked ? undefined : "Only used for a networked reader"}
        >
          <Input
            name="ipAddress"
            defaultValue={sent.ipAddress ?? device?.ipAddress ?? ""}
            placeholder="192.168.1.50"
            disabled={!networked}
          />
        </Field>

        <Field label="Port" error={err.port}>
          <Input
            name="port"
            type="number"
            min={1}
            max={65535}
            defaultValue={sent.port ?? (device?.port != null ? String(device.port) : "")}
            placeholder="4370"
            disabled={!networked}
          />
        </Field>

        <Field
          label="Expected every"
          error={err.syncIntervalMinutes}
          hint="Minutes. Health is judged against this."
        >
          <Input
            name="syncIntervalMinutes"
            type="number"
            min={1}
            max={1440}
            defaultValue={
              sent.syncIntervalMinutes ?? String(device?.syncIntervalMinutes ?? 15)
            }
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Vendor" error={err.vendor}>
          <Input name="vendor" defaultValue={sent.vendor ?? device?.vendor ?? ""} placeholder="ZKTeco" />
        </Field>
        <Field label="Model" error={err.model}>
          <Input name="model" defaultValue={sent.model ?? device?.model ?? ""} placeholder="iFace 302" />
        </Field>
        <Field label="Serial number" error={err.serialNumber} className="sm:col-span-2">
          <Input
            name="serialNumber"
            defaultValue={sent.serialNumber ?? device?.serialNumber ?? ""}
          />
        </Field>
      </div>

      <Field label="Notes" error={err.notes}>
        <Textarea
          name="notes"
          rows={2}
          defaultValue={sent.notes ?? device?.notes ?? ""}
          placeholder="Anything the next person to stand in front of it should know"
          className="min-h-16"
        />
      </Field>

      {connection === "cloud_api" ? (
        <p className="rounded border border-info/30 bg-info-soft px-3 py-2 text-xs text-info">
          A cloud device needs a push token before it can send anything. Save it first, then issue
          one from the device page.
        </p>
      ) : null}

      {state.message && !state.ok ? <p className="text-sm text-danger">{state.message}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {device ? "Save changes" : "Add device"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
