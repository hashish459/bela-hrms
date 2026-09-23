"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { Button, Field, Textarea } from "@/components/ui";
import { SideDrawer } from "@/components/side-drawer";
import { SectionFields } from "@/components/section-fields";
import { SECTION_BY_KEY, type SectionKey } from "@/modules/people/profile-fields";
import { requestChangeAction, withdrawChangeAction, type ChangeState } from "./actions";

type Value = string | number | boolean | null;
const initial: ChangeState = {};

/**
 * "Request a change" for one section of the employee's own record. The form is
 * the section definition, prefilled with what is on file; what is sent is a
 * proposal for HR, not a write.
 */
export function ChangeRequest({
  section,
  action = "update",
  targetId,
  values,
  label,
  variant = "link",
  pending: alreadyPending,
}: {
  section: SectionKey;
  action?: "update" | "add" | "remove";
  targetId?: string;
  values?: Record<string, Value>;
  label?: string;
  variant?: "link" | "button" | "icon";
  /** A request for this is already with HR. */
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const def = SECTION_BY_KEY.get(section)!;

  if (alreadyPending) {
    return <span className="text-[11px] text-warn">Change requested — with HR</span>;
  }

  const trigger =
    variant === "button" ? (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {action === "add" ? <Plus className="size-4" /> : <Pencil className="size-4" />}
        {label ?? "Request a change"}
      </Button>
    ) : variant === "icon" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded p-1 text-ink-faint hover:bg-sunk hover:text-ink"
        aria-label={label ?? (action === "remove" ? "Ask to remove" : "Ask to correct")}
        title={label ?? (action === "remove" ? "Ask to remove" : "Ask to correct")}
      >
        {action === "remove" ? <Trash2 className="size-3.5" /> : <Pencil className="size-3.5" />}
      </button>
    ) : (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-accent hover:underline">
        {label ?? "Request a change"}
      </button>
    );

  return (
    <>
      {done ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-ok" role="status">
          <CheckCircle2 className="size-3.5" />
          Sent to HR
        </span>
      ) : (
        trigger
      )}
      {open ? (
        <Drawer
          section={section}
          action={action}
          targetId={targetId}
          values={values}
          title={
            action === "add"
              ? `Add ${def.label.toLowerCase()}`
              : action === "remove"
                ? `Remove ${def.label.toLowerCase()}`
                : `Correct ${def.label.toLowerCase()}`
          }
          onClose={() => setOpen(false)}
          onSent={(m) => {
            setOpen(false);
            setDone(m);
          }}
        />
      ) : null}
    </>
  );
}

function Drawer({
  section,
  action,
  targetId,
  values,
  title,
  onClose,
  onSent,
}: {
  section: SectionKey;
  action: "update" | "add" | "remove";
  targetId?: string;
  values?: Record<string, Value>;
  title: string;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const def = SECTION_BY_KEY.get(section)!;
  const [state, formAction, pending] = useActionState(requestChangeAction, initial);

  useEffect(() => {
    if (state.at && state.ok) onSent(state.ok);
  }, [state.at, state.ok, onSent]);

  return (
    <SideDrawer
      title={title}
      subtitle="HR reviews every change before it reaches your record. You will get a notification either way."
      onClose={onClose}
      action={formAction}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending} variant={action === "remove" ? "danger" : "primary"}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send to HR
          </Button>
        </>
      }
    >
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="action" value={action} />
      {targetId ? <input type="hidden" name="targetId" value={targetId} /> : null}
      {state.error ? (
        <p className="mb-3 flex items-center gap-1.5 rounded bg-danger-soft px-3 py-2 text-xs text-danger">
          <AlertCircle className="size-3.5" />
          {state.error}
        </p>
      ) : null}
      {action === "remove" ? (
        <p className="mb-4 rounded bg-sunk px-3 py-2 text-sm text-ink-soft">
          Ask HR to take <b>{String(values?.[def.fields[0].name] ?? "this entry")}</b> off your record.
        </p>
      ) : (
        <>
          <p className="mb-4 text-xs text-ink-faint">{def.description}</p>
          <SectionFields fields={def.fields} values={values} errors={state.fieldErrors} />
        </>
      )}
      <div className="mt-4">
        <Field
          label={action === "remove" ? "Why?" : "Note for HR"}
          required={action === "remove"}
          error={state.fieldErrors?.note}
          hint={section === "bank" ? "Attach nothing here — bring a cheque or bank letter to HR; they check it before applying." : undefined}
        >
          <Textarea name="note" maxLength={500} placeholder="What changed, and since when." />
        </Field>
      </div>
    </SideDrawer>
  );
}

export function WithdrawChange({ id }: { id: string }) {
  const [state, action, pending] = useActionState(withdrawChangeAction, initial);
  if (state.ok) return <span className="text-[11px] text-ink-faint">Withdrawn</span>;
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className="text-[11px] text-ink-soft hover:text-danger hover:underline">
        Withdraw
      </button>
      {state.error ? <span className="ml-2 text-[11px] text-danger">{state.error}</span> : null}
    </form>
  );
}
