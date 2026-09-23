"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  BadgeX,
  Download,
  FileWarning,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  CardHeader,
  EmptyState,
  Input,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { Avatar } from "@/components/avatar";
import { deleteDocument, reviewDocument } from "./actions";
import { DocumentForm, type EditableDocument, type EmployeeOption } from "./document-form";
import { documentKindLabel } from "./kinds";

/**
 * The document table, on both the register and an employee's profile.
 *
 * Rendered on the client rather than the server because every row is
 * interactive — verify, reject, edit, remove — and the alternative is a server
 * table with a client island per row, each holding its own copy of the same
 * dialog state. The row count is bounded either way: the register paginates and
 * an individual profile holds a handful.
 *
 * Expiry is computed on the server and arrives as `expiryState`, so this
 * component never re-derives "expiring soon" and cannot disagree with the tiles
 * above it.
 */

export type DocumentRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  photoFileId: string | null;
  kind: string;
  title: string;
  referenceNumber: string | null;
  issuedOn: string | null;
  issuedOnBs: string | null;
  expiresOn: string | null;
  expiresOnBs: string | null;
  expiryState: "expired" | "expiring" | "valid" | "none";
  expiryLabel: string;
  status: "pending" | "verified" | "rejected";
  reviewedBy: string | null;
  reviewNote: string | null;
  isVisibleToEmployee: boolean;
  fileId: string | null;
  fileUrl: string | null;
};

const EXPIRY_TONE = {
  expired: "danger",
  expiring: "warn",
  valid: "ok",
  none: "neutral",
} as const;

const STATUS_TONE = {
  pending: "warn",
  verified: "ok",
  rejected: "danger",
} as const;

export function DocumentTable({
  rows,
  employeeOptions,
  fixedEmployeeId,
  canManage,
  title,
  description,
  showEmployee = true,
  emptyHint,
}: {
  rows: DocumentRow[];
  employeeOptions?: EmployeeOption[];
  fixedEmployeeId?: string;
  canManage: boolean;
  title: string;
  description?: string;
  showEmployee?: boolean;
  emptyHint?: string;
}) {
  const router = useRouter();
  /** `"new"`, a document id being edited, or null. */
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editingRow = rows.find((r) => r.id === editing);

  /*
   * Rejecting and removing both ask for confirmation in the table itself, as a
   * panel under the row being acted on, rather than through window.confirm or
   * window.prompt. Those block the whole tab, cannot be styled, cannot show
   * which document is about to be removed, and read as a browser warning rather
   * than as part of the product.
   */
  const [prompting, setPrompting] = useState<{ id: string; mode: "reject" | "delete" } | null>(
    null,
  );
  const [note, setNote] = useState("");

  function verify(id: string) {
    setError(null);
    startBusy(async () => {
      const result = await reviewDocument(id, "verified", "");
      if (!result.ok) setError(result.message ?? "That did not work.");
      else router.refresh();
    });
  }

  function confirmPrompt(row: DocumentRow) {
    setError(null);
    const mode = prompting?.mode;
    startBusy(async () => {
      const result =
        mode === "delete"
          ? await deleteDocument(row.id)
          : await reviewDocument(row.id, "rejected", note);
      if (!result.ok) {
        setError(result.message ?? "That did not work.");
        return;
      }
      setPrompting(null);
      setNote("");
      router.refresh();
    });
  }

  return (
    <>
      <CardHeader
        title={title}
        description={description}
        action={
          canManage && editing === null ? (
            <Button variant="secondary" onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              File a document
            </Button>
          ) : undefined
        }
      />

      {editing !== null ? (
        <DocumentForm
          key={editing}
          employeeOptions={employeeOptions}
          fixedEmployeeId={fixedEmployeeId}
          document={
            editingRow
              ? ({
                  id: editingRow.id,
                  employeeId: editingRow.employeeId,
                  kind: editingRow.kind,
                  title: editingRow.title,
                  referenceNumber: editingRow.referenceNumber,
                  issuedOn: editingRow.issuedOn,
                  expiresOn: editingRow.expiresOn,
                  isVisibleToEmployee: editingRow.isVisibleToEmployee,
                  hasFile: Boolean(editingRow.fileId ?? editingRow.fileUrl),
                } satisfies EditableDocument)
              : undefined
          }
          onClose={() => setEditing(null)}
        />
      ) : null}

      {error ? <p className="px-4 pt-3 text-sm text-danger">{error}</p> : null}

      {rows.length === 0 ? (
        <EmptyState title="No documents on file" hint={emptyHint} />
      ) : (
        <TableShell>
          <thead>
            <tr>
              {showEmployee ? <Th>Employee</Th> : null}
              <Th>Document</Th>
              <Th>Type</Th>
              <Th>Issued (BS)</Th>
              <Th>Expiry</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
              <Tr>
                {showEmployee ? (
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
                ) : null}

                <Td>
                  <span className="block text-sm text-ink">{r.title}</span>
                  {r.referenceNumber ? (
                    <span className="block font-mono text-[11px] text-ink-faint">
                      {r.referenceNumber}
                    </span>
                  ) : null}
                  {!r.isVisibleToEmployee ? (
                    <Badge tone="neutral" className="mt-1">
                      HR only
                    </Badge>
                  ) : null}
                </Td>

                <Td className="text-ink-soft">{documentKindLabel(r.kind)}</Td>
                <Td className="tabular text-ink-soft">{r.issuedOnBs ?? "—"}</Td>

                <Td>
                  {r.expiresOn ? (
                    <span className="flex flex-col gap-0.5">
                      <span className="tabular text-xs text-ink-soft">{r.expiresOnBs}</span>
                      <Badge tone={EXPIRY_TONE[r.expiryState]}>{r.expiryLabel}</Badge>
                    </span>
                  ) : (
                    <span className="text-xs text-ink-faint">No expiry</span>
                  )}
                </Td>

                <Td>
                  <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  {r.reviewNote ? (
                    <span
                      className="mt-0.5 block max-w-40 truncate text-[11px] text-ink-faint"
                      title={r.reviewNote}
                    >
                      {r.reviewNote}
                    </span>
                  ) : null}
                </Td>

                <Td className="text-right">
                  <span className="inline-flex items-center justify-end gap-0.5">
                    {r.fileId ?? r.fileUrl ? (
                      <a
                        href={r.fileId ? `/api/files/${r.fileId}` : (r.fileUrl as string)}
                        target="_blank"
                        rel="noreferrer"
                        title="Open the file"
                        className="rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-accent"
                      >
                        <Download className="size-4" />
                        <span className="sr-only">Open {r.title}</span>
                      </a>
                    ) : (
                      <span
                        title="No file attached yet"
                        className="rounded p-1.5 text-warn/70"
                      >
                        <FileWarning className="size-4" />
                      </span>
                    )}

                    {canManage ? (
                      <>
                        {r.status !== "verified" ? (
                          <button
                            type="button"
                            onClick={() => verify(r.id)}
                            disabled={busy}
                            title="Mark as verified"
                            className="rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-ok disabled:opacity-40"
                          >
                            <BadgeCheck className="size-4" />
                            <span className="sr-only">Verify {r.title}</span>
                          </button>
                        ) : null}
                        {r.status !== "rejected" ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPrompting({ id: r.id, mode: "reject" });
                              setNote("");
                            }}
                            disabled={busy}
                            title="Reject"
                            className="rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-danger disabled:opacity-40"
                          >
                            <BadgeX className="size-4" />
                            <span className="sr-only">Reject {r.title}</span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setEditing(r.id)}
                          disabled={busy}
                          title="Edit"
                          className="rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-ink disabled:opacity-40"
                        >
                          <Pencil className="size-4" />
                          <span className="sr-only">Edit {r.title}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPrompting({ id: r.id, mode: "delete" });
                            setNote("");
                          }}
                          disabled={busy}
                          title="Remove"
                          className="rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-danger disabled:opacity-40"
                        >
                          <Trash2 className="size-4" />
                          <span className="sr-only">Remove {r.title}</span>
                        </button>
                      </>
                    ) : null}

                    {busy ? <Loader2 className="size-3.5 animate-spin text-ink-faint" /> : null}
                  </span>
                </Td>
              </Tr>

              {prompting?.id === r.id ? (
                <tr className="bg-sunk/60">
                  <Td colSpan={showEmployee ? 7 : 6}>
                    <div className="flex flex-col gap-2 py-1">
                      <p className="text-sm text-ink">
                        {prompting.mode === "delete" ? (
                          <>
                            Remove <span className="font-medium">{r.title}</span> from{" "}
                            {r.employeeName}&rsquo;s record? This cannot be undone.
                          </>
                        ) : (
                          <>
                            Reject <span className="font-medium">{r.title}</span>. The reason is
                            shown to whoever filed it.
                          </>
                        )}
                      </p>

                      {prompting.mode === "reject" ? (
                        <Input
                          autoFocus
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Illegible scan, expired on arrival, wrong document…"
                          className="max-w-xl"
                        />
                      ) : null}

                      <div className="flex items-center gap-2">
                        <Button
                          variant="danger"
                          onClick={() => confirmPrompt(r)}
                          disabled={busy || (prompting.mode === "reject" && note.trim() === "")}
                        >
                          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                          {prompting.mode === "delete" ? "Remove document" : "Reject document"}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setPrompting(null)}
                          disabled={busy}
                        >
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
