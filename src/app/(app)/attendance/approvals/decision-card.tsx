"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, Check, CheckCircle2, Loader2, X } from "lucide-react";
import { decideAttendance, type ActionState } from "../actions";
import { Badge, Button, Card, Textarea } from "@/components/ui";
import { formatDuration, shortTime } from "@/lib/attendance/calc";

const initial: ActionState = { ok: false };

type Request = {
  requestId: string;
  reference: string;
  date: string;
  dateBs: string;
  typeLabel: string;
  requestedCheckIn: string | null;
  requestedCheckOut: string | null;
  previousCheckIn: string | null;
  previousCheckOut: string | null;
  reason: string;
  level: number;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string | null;
  designation: string | null;
  shiftName: string | null;
  shiftWindow: string | null;
  currentStatus: string | null;
  currentWorked: number | null;
};

export function AttendanceDecisionCard({ request: r }: { request: Request }) {
  const [state, action, pending] = useActionState(decideAttendance, initial);
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");

  if (state.ok) {
    return (
      <Card className="border-ok/40">
        <div className="flex items-center gap-2 p-4 text-sm text-ok">
          <CheckCircle2 className="size-4 shrink-0" />
          {state.message}
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-line-soft px-4 py-3">
        <div className="min-w-0">
          <Link
            href={`/hr/employees/${r.employeeId}`}
            className="text-sm font-semibold text-ink hover:text-accent"
          >
            {r.employeeName}
          </Link>
          <p className="mt-0.5 truncate text-xs text-ink-faint">
            <span className="font-mono">{r.employeeCode}</span>
            {r.designation ? ` · ${r.designation}` : ""}
            {r.department ? ` · ${r.department}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="font-mono text-[11px] text-ink-faint">{r.reference}</span>
          <div className="mt-1">
            <Badge tone="warn">Level {r.level}</Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-3">
        <div>
          <p className="text-[11px] text-ink-faint">Date (BS)</p>
          <p className="tabular mt-0.5 text-sm text-ink">{r.dateBs}</p>
          <p className="tabular text-[11px] text-ink-faint">
            {new Date(r.date).toLocaleDateString("en-GB", {
              weekday: "short",
              day: "2-digit",
              month: "short",
            })}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-ink-faint">Correction</p>
          <p className="mt-0.5 text-sm text-ink">{r.typeLabel}</p>
        </div>
        <div>
          <p className="text-[11px] text-ink-faint">Shift</p>
          <p className="mt-0.5 text-sm text-ink-soft">{r.shiftName ?? "—"}</p>
          <p className="tabular text-[11px] text-ink-faint">
            {r.shiftWindow ? r.shiftWindow.replace(/:00 /g, " ").replace(/:00$/, "") : ""}
          </p>
        </div>
      </div>

      {/* what actually changes if this is approved */}
      <div className="mx-4 mb-3 flex items-center gap-3 rounded border border-line-soft bg-sunk px-3 py-2">
        <div className="text-center">
          <p className="text-[10px] tracking-wide text-ink-faint uppercase">Recorded</p>
          <p className="tabular mt-0.5 text-sm text-ink-soft">
            {shortTime(r.previousCheckIn)} – {shortTime(r.previousCheckOut)}
          </p>
          <p className="text-[11px] text-ink-faint">
            {r.currentStatus?.replace(/_/g, " ") ?? "no record"}
            {r.currentWorked ? ` · ${formatDuration(r.currentWorked)}` : ""}
          </p>
        </div>
        <ArrowRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
        <div className="text-center">
          <p className="text-[10px] tracking-wide text-ink-faint uppercase">Requested</p>
          <p className="tabular mt-0.5 text-sm font-medium text-ink">
            {shortTime(r.requestedCheckIn)} – {shortTime(r.requestedCheckOut)}
          </p>
          <p className="text-[11px] text-ink-faint">recalculated on approval</p>
        </div>
      </div>

      <div className="border-t border-line-soft px-4 py-3">
        <p className="text-[11px] text-ink-faint">Reason</p>
        <p className="mt-0.5 text-sm text-ink-soft">{r.reason}</p>
      </div>

      <form action={action} className="mt-auto flex flex-col gap-2 border-t border-line-soft px-4 py-3">
        <input type="hidden" name="requestId" value={r.requestId} />
        <input type="hidden" name="decision" value={mode === "reject" ? "rejected" : "approved"} />

        {state.message && !state.ok ? (
          <p className="flex items-start gap-1.5 rounded bg-danger-soft px-2.5 py-2 text-xs text-danger">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            {state.message}
          </p>
        ) : null}

        {mode !== "idle" ? (
          <Textarea
            name="comment"
            rows={2}
            required={mode === "reject"}
            placeholder={
              mode === "reject"
                ? "Why is this being rejected? The employee will see this."
                : "Optional note"
            }
            className="text-sm"
          />
        ) : null}

        {/* distinct keys: without them React reuses these button nodes across the
            branch change and the in-flight click submits the confirm button */}
        <div className="flex items-center gap-2">
          {mode === "idle" ? (
            <>
              <Button
                key="choose-approve"
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setMode("approve");
                }}
              >
                <Check className="size-4" />
                Approve
              </Button>
              <Button
                key="choose-reject"
                type="button"
                variant="danger"
                onClick={(e) => {
                  e.preventDefault();
                  setMode("reject");
                }}
              >
                <X className="size-4" />
                Reject
              </Button>
            </>
          ) : (
            <>
              <Button
                key="confirm"
                type="submit"
                variant={mode === "reject" ? "danger" : "primary"}
                disabled={pending}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Confirm {mode === "reject" ? "rejection" : "approval"}
              </Button>
              <Button
                key="cancel"
                type="button"
                variant="ghost"
                onClick={(e) => {
                  e.preventDefault();
                  setMode("idle");
                }}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </form>
    </Card>
  );
}
