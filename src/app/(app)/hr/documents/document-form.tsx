"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2, Paperclip, X } from "lucide-react";
import { Button, Field, Input, Select, Badge } from "@/components/ui";
import { saveDocument, type DocumentFormState } from "./actions";
import { DOCUMENT_KINDS, documentKindLabel } from "./kinds";

/**
 * Filing a document.
 *
 * The same form serves the organisation-wide register and the documents card on
 * an employee's profile. The only difference is whether the employee is chosen
 * or already known, which is one prop rather than two nearly-identical forms
 * that drift apart the first time a field is added.
 */

export type EmployeeOption = { id: string; label: string };

export type EditableDocument = {
  id: string;
  employeeId: string;
  kind: string;
  title: string;
  referenceNumber: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  isVisibleToEmployee: boolean;
  hasFile: boolean;
};

const EMPTY: DocumentFormState = { ok: false };

export function DocumentForm({
  employeeOptions,
  fixedEmployeeId,
  document,
  onClose,
}: {
  /** Omitted when the employee is already fixed by the surrounding page. */
  employeeOptions?: EmployeeOption[];
  fixedEmployeeId?: string;
  document?: EditableDocument;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    saveDocument.bind(null, document?.id ?? null),
    EMPTY,
  );
  const [fileName, setFileName] = useState<string | null>(null);
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
    <form action={action} className="flex flex-col gap-4 border-t border-line-soft bg-sunk/40 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <FilePlus2 className="size-4 text-accent" />
          {document ? "Edit document" : "File a document"}
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fixedEmployeeId ? (
          <input type="hidden" name="employeeId" value={fixedEmployeeId} />
        ) : (
          <Field label="Employee" required error={err.employeeId}>
            <Select name="employeeId" defaultValue={sent.employeeId ?? document?.employeeId ?? ""} required>
              <option value="">Choose…</option>
              {employeeOptions?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Type" required error={err.kind}>
          <Select name="kind" defaultValue={sent.kind ?? document?.kind ?? "contract"}>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {documentKindLabel(k)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Title" required error={err.title} className="sm:col-span-2 lg:col-span-1">
          <Input
            name="title"
            defaultValue={sent.title ?? document?.title ?? ""}
            placeholder="Employment contract 2082/83"
            maxLength={160}
            required
          />
        </Field>

        <Field label="Reference number" error={err.referenceNumber}>
          <Input
            name="referenceNumber"
            defaultValue={sent.referenceNumber ?? document?.referenceNumber ?? ""}
            placeholder="Certificate or document number"
          />
        </Field>

        <Field label="Issued on" error={err.issuedOn}>
          <Input type="date" name="issuedOn" defaultValue={sent.issuedOn ?? document?.issuedOn ?? ""} />
        </Field>

        <Field
          label="Expires on"
          hint="Leave blank if it does not expire"
          error={err.expiresOn}
        >
          <Input type="date" name="expiresOn" defaultValue={sent.expiresOn ?? document?.expiresOn ?? ""} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={document?.hasFile ? "Replace the scan" : "Attach a scan"}
          hint="JPEG, PNG, WebP or PDF, up to 5 MB"
          error={err.file}
        >
          <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-line bg-surface px-2.5 py-2 text-sm text-ink-soft hover:border-accent hover:text-ink">
            <Paperclip className="size-4 shrink-0" />
            <span className="truncate">
              {fileName ??
                (state.values
                  ? "Choose the file again"
                  : document?.hasFile
                    ? "Keep the current file"
                    : "Choose a file")}
            </span>
            <input
              type="file"
              name="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            />
          </label>
        </Field>

        <label className="flex items-start gap-2 self-end pb-1.5 text-sm text-ink">
          <input
            type="checkbox"
            name="isVisibleToEmployee"
            defaultChecked={
              state.values
                ? state.values.isVisibleToEmployee === "on"
                : (document?.isVisibleToEmployee ?? true)
            }
            className="mt-0.5 size-4 accent-[var(--color-accent)]"
          />
          <span>
            Visible to the employee
            <span className="block text-xs text-ink-faint">
              Uncheck for anything held on file but not for their eyes.
            </span>
          </span>
        </label>
      </div>

      {state.message && !state.ok ? (
        <p className="text-sm text-danger">{state.message}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {document ? "Save changes" : "File document"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        {document ? (
          <Badge tone="warn">Editing clears an existing verification</Badge>
        ) : null}
      </div>
    </form>
  );
}
