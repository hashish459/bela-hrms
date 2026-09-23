"use client";

import { useActionState } from "react";
import { AlertCircle, Download, Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { runDiagnosticAction, type DiagnosticState } from "./diagnostics-actions";

const initial: DiagnosticState = {};

function toCsv(columns: string[], rows: string[][]) {
  const esc = (v: string) => {
    const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

/**
 * Picks and runs one of the fixed diagnostics. The options come from the
 * server; the browser only ever sends a key.
 */
export function Diagnostics({ options }: { options: { key: string; label: string; hint: string }[] }) {
  const [state, action, pending] = useActionState(runDiagnosticAction, initial);
  const current = options.find((o) => o.key === state.key);

  return (
    <div className="flex flex-col">
      <form action={action} className="flex flex-wrap gap-1.5 border-b border-line-soft p-3" aria-label="Diagnostics">
        {options.map((o) => (
          <button
            key={o.key}
            type="submit"
            name="diagnostic"
            value={o.key}
            disabled={pending}
            title={o.hint}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-60",
              state.key === o.key ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-ink-soft hover:bg-sunk hover:text-ink",
            )}
          >
            {pending && state.key === o.key ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" aria-hidden />}
            {o.label}
          </button>
        ))}
      </form>

      {state.error ? (
        <p className="m-3 flex items-center gap-1.5 rounded bg-danger-soft px-2.5 py-1.5 text-xs text-danger" role="alert">
          <AlertCircle className="size-3.5" aria-hidden />
          {state.error}
        </p>
      ) : null}

      {state.result && current ? (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[11px] text-ink-faint">
            <span>
              <span className="font-medium text-ink-soft">{current.label}</span> — {current.hint} · {state.result.rows.length}
              {state.result.truncated ? "+" : ""} rows in {state.result.durationMs.toFixed(0)} ms · read-only
            </span>
            {state.result.rows.length ? (
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob(["﻿" + toCsv(state.result!.columns, state.result!.rows)], { type: "text/csv" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `db-${state.key}.csv`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
                className="flex items-center gap-1 rounded border border-line px-2 py-0.5 text-ink-soft hover:bg-sunk"
              >
                <Download className="size-3" aria-hidden />
                CSV
              </button>
            ) : null}
          </div>
          {state.result.rows.length === 0 ? (
            <p className="px-4 pb-6 text-center text-xs text-ink-faint">No rows — nothing to report.</p>
          ) : (
            <div className="max-h-96 overflow-auto border-t border-line-soft">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-sunk">
                  <tr>
                    {state.result.columns.map((c) => (
                      <th key={c} className="border-b border-line px-3 py-1.5 text-left font-mono text-[11px] font-medium whitespace-nowrap text-ink-faint">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.result.rows.map((r, i) => (
                    <tr key={i} className="hover:bg-sunk/60">
                      {r.map((v, j) => (
                        <td key={j} className="border-b border-line-soft px-3 py-1.5 font-mono whitespace-nowrap text-ink-soft">
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : !state.error ? (
        <p className="px-4 py-6 text-center text-xs text-ink-faint">Pick a diagnostic to run it against the live database.</p>
      ) : null}
    </div>
  );
}
