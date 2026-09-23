"use client";

import { useState, useTransition } from "react";
import { BellRing, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui";
import { flushEmailAction, runRemindersAction } from "./actions";

/** Run the reminder sweep or empty the email queue now, rather than waiting for the schedule. */
export function OpsButtons() {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reminders" | "email" | null>(null);
  const [, start] = useTransition();

  const run = (what: "reminders" | "email") => {
    setBusy(what);
    start(async () => {
      const r = what === "reminders" ? await runRemindersAction() : await flushEmailAction();
      setMessage(r.ok ?? r.error ?? null);
      setBusy(null);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => run("reminders")} disabled={busy !== null}>
          {busy === "reminders" ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" />}
          Run reminders now
        </Button>
        <Button type="button" variant="secondary" onClick={() => run("email")} disabled={busy !== null}>
          {busy === "email" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Process email queue
        </Button>
      </div>
      {message ? (
        <p className="text-xs text-ink-soft" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
