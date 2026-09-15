"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, CheckCircle2, Loader2, X } from "lucide-react";
import { decideLeave, type ActionState } from "../actions";
import { Badge, Button, Card, Textarea } from "@/components/ui";
import { formatDays } from "@/lib/utils";

const initial: ActionState = { ok: false };

type Request = {
  requestId: string;
  reference: string;
  fromDate: string;
  toDate: string;
  fromDateBs: string;
  toDateBs: string;
  totalDays: string;
  portion: string;
  reason: string;
  contact: string | null;
  submittedAt: string | null;
  level: number;
  approverLabel: string | null;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string | null;
  designation: string | null;
  leaveType: string;
  leaveColour: string;
};

export function DecisionCard({
  request: r,
  balance,
}: {
  request: Request;
  balance: { available: number; entitled: number } | null;
}) {
  const [state, action, pending] = useActionState(decideLeave, initial);
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

  const short = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

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

      <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
        <div>
          <p className="text-[11px] text-ink-faint">Type</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: r.leaveColour }}
              aria-hidden
            />
            {r.leaveType}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-ink-faint">Dates (BS)</p>
          <p className="tabular mt-0.5 text-sm text-ink">
            {r.fromDateBs}
            {r.toDateBs !== r.fromDateBs ? ` → ${r.toDateBs}` : ""}
          </p>
          <p className="tabular text-[11px] text-ink-faint">
            {short(r.fromDate)}
            {r.toDate !== r.fromDate ? ` – ${short(r.toDate)}` : ""}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-ink-faint">Days</p>
          <p className="tabular mt-0.5 text-sm font-medium text-ink">
            {r.totalDays}
            {r.portion !== "full" ? (
              <span className="ml-1 text-[11px] font-normal text-ink-faint">
                {r.portion.replace("_", " ")}
              </span>
            ) : null}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-ink-faint">Balance after</p>
          {balance ? (
            <p
              className={`tabular mt-0.5 text-sm font-medium ${
                balance.available - Number(r.totalDays) < 0 ? "text-danger" : "text-ink"
              }`}
            >
              {formatDays(balance.available)}
              <span className="text-[11px] font-normal text-ink-faint"> / {formatDays(balance.entitled)}</span>
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-ink-faint">Not deducted</p>
          )}
        </div>
      </div>

      <div className="border-t border-line-soft px-4 py-3">
        <p className="text-[11px] text-ink-faint">Reason</p>
        <p className="mt-0.5 text-sm text-ink-soft">{r.reason}</p>
        {r.contact ? (
          <p className="mt-1 text-xs text-ink-faint">Contact while away: {r.contact}</p>
        ) : null}
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
            placeholder={
              mode === "reject"
                ? "Why is this being rejected? The employee will see this."
                : "Optional note"
            }
            className="text-sm"
            required={mode === "reject"}
          />
        ) : null}

        {/*
          The keys matter. React flushes a state update from a discrete event
          synchronously, so without distinct keys it reuses these same <button>
          nodes across the branch change: the node the user pressed becomes the
          type="submit" confirm button before the browser runs the click's default
          action, and the form submits on one click. preventDefault belts-and-braces it.
        */}
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
