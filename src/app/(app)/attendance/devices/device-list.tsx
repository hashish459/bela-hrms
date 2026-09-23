"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  CardHeader,
  EmptyState,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { deleteDevice, runSync, type SyncState } from "./actions";
import { DeviceForm, type EditableDevice } from "./device-form";
import { CONNECTION_LABEL, DIRECTION_LABEL, KIND_LABEL, STATUS_LABEL } from "./options";

export type DeviceRow = EditableDevice & {
  branchName: string | null;
  health: "healthy" | "stale" | "silent" | "never" | "disabled";
  healthLabel: string;
  healthTone: "ok" | "warn" | "danger" | "neutral";
  lastSeenLabel: string;
  enrolments: number;
  punchesToday: number;
  pendingPunches: number;
  unmatchedPunches: number;
  hasToken: boolean;
  lastError: string | null;
};

export function DeviceList({
  rows,
  branches,
  canManage,
}: {
  rows: DeviceRow[];
  branches: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [detail, setDetail] = useState<SyncState["detail"] | null>(null);

  const editingRow = rows.find((r) => r.id === editing);

  function sync(deviceId?: string) {
    setNotice(null);
    setDetail(null);
    startBusy(async () => {
      const result = await runSync(deviceId);
      setNotice({ tone: result.ok ? "ok" : "danger", text: result.message ?? "" });
      setDetail(result.detail ?? null);
      if (result.ok) router.refresh();
    });
  }

  function remove(row: DeviceRow) {
    setNotice(null);
    startBusy(async () => {
      const result = await deleteDevice(row.id);
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
        title="Readers"
        description="Every device that can record attendance, and whether it is still reporting."
        action={
          canManage ? (
            <span className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => sync()} disabled={busy}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Process punches
              </Button>
              {editing === null ? (
                <Button onClick={() => setEditing("new")}>
                  <Plus className="size-4" />
                  Add device
                </Button>
              ) : null}
            </span>
          ) : undefined
        }
      />

      {editing !== null ? (
        <DeviceForm
          key={editing}
          device={editingRow}
          branches={branches}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {notice ? (
        <div
          className={
            notice.tone === "ok"
              ? "border-b border-line-soft bg-ok-soft px-4 py-2 text-sm text-ok"
              : "border-b border-line-soft bg-danger-soft px-4 py-2 text-sm text-danger"
          }
        >
          <p>{notice.text}</p>
          {detail?.reasons.length ? (
            <ul className="mt-1 list-inside list-disc text-xs opacity-90">
              {detail.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No devices registered"
          hint="Add a reader to start collecting punches. A device can also be a web kiosk or the mobile app."
        />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <Th>Device</Th>
              <Th>Where</Th>
              <Th>Reads</Th>
              <Th>Connection</Th>
              <Th>Health</Th>
              <Th className="text-right">Enrolled</Th>
              <Th className="text-right">Today</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <Tr>
                  <Td>
                    <Link
                      href={`/attendance/devices/${r.id}`}
                      className="block text-sm font-medium text-ink hover:text-accent"
                    >
                      {r.name}
                    </Link>
                    <span className="font-mono text-[11px] text-ink-faint">{r.code}</span>
                    {r.status !== "active" ? (
                      <Badge tone="neutral" className="ml-1.5">
                        {STATUS_LABEL[r.status]}
                      </Badge>
                    ) : null}
                  </Td>

                  <Td className="text-ink-soft">
                    <span className="block text-sm">{r.branchName ?? "—"}</span>
                    {r.location ? (
                      <span className="block text-[11px] text-ink-faint">{r.location}</span>
                    ) : null}
                  </Td>

                  <Td>
                    <span className="block text-sm text-ink-soft">{KIND_LABEL[r.kind]}</span>
                    <span className="block text-[11px] text-ink-faint">
                      {DIRECTION_LABEL[r.direction]}
                    </span>
                  </Td>

                  <Td>
                    <span className="block text-sm text-ink-soft">
                      {CONNECTION_LABEL[r.connection]}
                    </span>
                    {r.ipAddress ? (
                      <span className="block font-mono text-[11px] text-ink-faint">
                        {r.ipAddress}
                        {r.port ? `:${r.port}` : ""}
                      </span>
                    ) : r.connection === "cloud_api" ? (
                      <span className="block text-[11px]">
                        {r.hasToken ? (
                          <span className="text-ink-faint">token issued</span>
                        ) : (
                          <span className="text-warn">no token yet</span>
                        )}
                      </span>
                    ) : null}
                  </Td>

                  <Td>
                    <Badge tone={r.healthTone}>{r.healthLabel}</Badge>
                    <span className="mt-0.5 block text-[11px] text-ink-faint">
                      {r.lastSeenLabel}
                    </span>
                    {r.lastError ? (
                      <span className="mt-0.5 block max-w-44 truncate text-[11px] text-danger" title={r.lastError}>
                        {r.lastError}
                      </span>
                    ) : null}
                  </Td>

                  <Td className="tabular text-right text-ink-soft">{r.enrolments}</Td>

                  <Td className="tabular text-right">
                    <span className="text-ink">{r.punchesToday}</span>
                    {r.unmatchedPunches > 0 ? (
                      <span className="mt-0.5 block">
                        <Badge tone="warn">{r.unmatchedPunches} unmatched</Badge>
                      </span>
                    ) : r.pendingPunches > 0 ? (
                      <span className="mt-0.5 block text-[11px] text-ink-faint">
                        {r.pendingPunches} to process
                      </span>
                    ) : null}
                  </Td>

                  <Td className="text-right">
                    <span className="inline-flex items-center justify-end gap-0.5">
                      {canManage ? (
                        <>
                          <button
                            type="button"
                            onClick={() => sync(r.id)}
                            disabled={busy}
                            title="Process this device's punches"
                            className="rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-accent disabled:opacity-40"
                          >
                            <RefreshCw className="size-4" />
                            <span className="sr-only">Process punches for {r.code}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(r.id)}
                            disabled={busy}
                            title="Edit"
                            className="rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-ink disabled:opacity-40"
                          >
                            <Pencil className="size-4" />
                            <span className="sr-only">Edit {r.code}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirming(r.id)}
                            disabled={busy}
                            title="Remove"
                            className="rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-danger disabled:opacity-40"
                          >
                            <Trash2 className="size-4" />
                            <span className="sr-only">Remove {r.code}</span>
                          </button>
                        </>
                      ) : null}
                    </span>
                  </Td>
                </Tr>

                {confirming === r.id ? (
                  <tr className="bg-sunk/60">
                    <Td colSpan={8}>
                      <div className="flex flex-col gap-2 py-1">
                        <p className="text-sm text-ink">
                          Remove <span className="font-medium">{r.name}</span>?
                        </p>
                        <p className="text-xs text-ink-soft">
                          Its enrolments and its whole punch log go with it — that is the raw
                          evidence behind attendance days already written. The days themselves stay,
                          but nobody will be able to show where their times came from.
                        </p>
                        <div className="flex items-center gap-2">
                          <Button variant="danger" onClick={() => remove(r)} disabled={busy}>
                            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                            Remove device and punch log
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </Td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </TableShell>
      )}
    </>
  );
}
