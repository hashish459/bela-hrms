"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Loader2, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, Field, Input } from "@/components/ui";
import { deleteEmployeeAction, type RowState } from "../record-actions";

const initial: RowState = {};

/**
 * The recycle-bin delete, behind a typed confirmation. Worded to steer people
 * who actually mean "this person left" towards a separation instead.
 */
export function DeleteRecord({ employeeId, code, name }: { employeeId: string; code: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(deleteEmployeeAction, initial);

  return (
    <Card className="border-danger/30">
      <CardHeader
        title="Delete this record"
        description="For a duplicate or a record created by mistake. If the person is leaving, record a separation instead — that keeps their history on file."
        action={
          open ? undefined : (
            <Button variant="danger" onClick={() => setOpen(true)}>
              <Trash2 className="size-4" />
              Delete…
            </Button>
          )
        }
      />
      {open ? (
        <form action={action} className="flex flex-col gap-3 p-4">
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="code" value={code} />
          <p className="text-sm text-ink-soft">
            {name}&apos;s record moves to the recycle bin and disappears from every list. Their login, if they have one, is
            closed and signed out. An administrator can restore it from <b>Administration › Recycle Bin</b>.
          </p>
          {state.error ? (
            <p className="flex items-center gap-1.5 rounded bg-danger-soft px-3 py-2 text-xs text-danger">
              <AlertCircle className="size-3.5" />
              {state.error}
            </p>
          ) : null}
          <Field label={`Type ${code} to confirm`}>
            <Input name="confirm" autoComplete="off" className="max-w-xs font-mono" />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Move to recycle bin
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
