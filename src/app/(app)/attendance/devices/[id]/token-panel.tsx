"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, Loader2, ShieldOff } from "lucide-react";
import { Badge, Button, CardHeader } from "@/components/ui";
import { issueDeviceToken, revokeDeviceToken } from "../actions";

/**
 * The push token, and the endpoint it is used against.
 *
 * The token is shown exactly once, when it is issued. Only its SHA-256 is
 * stored, so a leaked database does not hand somebody the ability to post
 * fabricated attendance for the whole organisation — and nobody, including an
 * administrator, can read it back afterwards. Losing it means issuing another.
 */
export function TokenPanel({
  deviceId,
  deviceCode,
  prefix,
  issuedAt,
  baseUrl,
}: {
  deviceId: string;
  deviceCode: string;
  prefix: string | null;
  issuedAt: string | null;
  baseUrl: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const endpoint = `${baseUrl}/api/devices/punches`;

  const sample = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer ${token ?? "<device token>"}" \\
  -H "Content-Type: application/json" \\
  -d '{"punches":[{"enrollNumber":"47","punchedAt":"2026-09-20T09:03:00","direction":"in"}]}'`;

  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(what);
        setTimeout(() => setCopied(null), 1800);
      },
      () => setError("Could not copy — select the text and copy it by hand."),
    );
  }

  function issue() {
    setError(null);
    startBusy(async () => {
      const result = await issueDeviceToken(deviceId);
      if (result.ok && result.token) setToken(result.token);
      else setError(result.message ?? "That did not work.");
    });
  }

  function revoke() {
    setError(null);
    startBusy(async () => {
      const result = await revokeDeviceToken(deviceId);
      if (result.ok) {
        setToken(null);
        setConfirmingRevoke(false);
      } else setError(result.message ?? "That did not work.");
    });
  }

  return (
    <>
      <CardHeader
        title="Push token"
        description="How this device authenticates when it posts readings."
        action={
          prefix ? (
            <Badge tone="ok">Issued</Badge>
          ) : (
            <Badge tone="warn">None</Badge>
          )
        }
      />

      <div className="flex flex-col gap-3 p-4">
        {token ? (
          <div className="rounded-md border border-ok/40 bg-ok-soft/50 p-3">
            <p className="text-xs font-medium text-ok">
              Copy this now. It is not stored and cannot be shown again.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border border-line bg-surface px-2 py-1.5 font-mono text-xs text-ink">
                {token}
              </code>
              <Button variant="secondary" onClick={() => copy(token, "token")}>
                {copied === "token" ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied === "token" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ) : prefix ? (
          <p className="text-sm text-ink-soft">
            A token beginning{" "}
            <code className="font-mono text-xs text-ink">{prefix}…</code> was issued
            {issuedAt ? ` on ${issuedAt}` : ""}. Only its hash is stored, so it cannot be shown
            again — issue a new one if it has been lost, which immediately stops the old one
            working.
          </p>
        ) : (
          <p className="text-sm text-ink-soft">
            This device has no token, so nothing can post readings as it. Issue one and configure
            it on the device or on the agent that forwards for it.
          </p>
        )}

        <div>
          <p className="text-[11px] tracking-wide text-ink-faint uppercase">Endpoint</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded border border-line bg-sunk px-2 py-1.5 font-mono text-xs text-ink-soft">
              POST {endpoint}
            </code>
            <button
              type="button"
              onClick={() => copy(endpoint, "endpoint")}
              className="rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-ink"
              title="Copy the endpoint"
            >
              {copied === "endpoint" ? <Check className="size-4" /> : <Copy className="size-4" />}
              <span className="sr-only">Copy the endpoint</span>
            </button>
          </div>
        </div>

        <details className="group">
          <summary className="cursor-pointer text-xs text-accent hover:underline">
            Show an example request
          </summary>
          <div className="mt-2 flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded border border-line bg-sunk p-2.5 font-mono text-[11px] leading-relaxed text-ink-soft">
              {sample}
            </pre>
            <button
              type="button"
              onClick={() => copy(sample, "sample")}
              className="rounded p-1.5 text-ink-faint hover:bg-sunk hover:text-ink"
              title="Copy the example"
            >
              {copied === "sample" ? <Check className="size-4" /> : <Copy className="size-4" />}
              <span className="sr-only">Copy the example request</span>
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-faint">
            Timestamps are the reader&rsquo;s local wall clock. Up to 1,000 readings per request,
            and re-sending the same ones is safe — the identical reading is stored once.
          </p>
        </details>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={issue} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            {prefix ? "Issue a new token" : "Issue a token"}
          </Button>

          {prefix ? (
            confirmingRevoke ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-ink-soft">
                Stop {deviceCode} posting?
                <Button variant="danger" onClick={revoke} disabled={busy}>
                  Revoke
                </Button>
                <Button variant="ghost" onClick={() => setConfirmingRevoke(false)} disabled={busy}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmingRevoke(true)} disabled={busy}>
                <ShieldOff className="size-4" />
                Revoke
              </Button>
            )
          ) : null}
        </div>

        {prefix ? (
          <p className="text-[11px] text-ink-faint">
            Issuing a new token replaces the old one immediately. Anything still using the previous
            one starts getting 401s, so update the device first if you can.
          </p>
        ) : null}
      </div>
    </>
  );
}
