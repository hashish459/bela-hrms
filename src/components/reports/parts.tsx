import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small presentational pieces shared by report screens. Server Components, no
 * state: a report is read, not operated.
 */

const TONE_TEXT = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-ink-faint",
} as const;

const TONE_FILL = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-line",
} as const;

export type RateTone = keyof typeof TONE_TEXT;

/** A percentage with a hairline bar under it, for rate columns in dense tables. */
export function RateCell({ rate, tone }: { rate: number | null; tone: RateTone }) {
  if (rate === null) return <span className="text-ink-faint">—</span>;
  const pct = Math.max(0, Math.min(100, rate * 100));
  return (
    <span className="inline-flex w-16 flex-col items-end gap-0.5">
      <span className={cn("tabular text-xs font-medium", TONE_TEXT[tone])}>{pct.toFixed(1)}%</span>
      <span className="h-0.5 w-full overflow-hidden rounded-full bg-sunk" aria-hidden>
        <span className={cn("block h-full rounded-full", TONE_FILL[tone])} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

/**
 * The heading of one report: what it is, which period and scope it covers, and
 * the export controls. The scope line is repeated on paper, where the filter
 * bar is not printed and a sheet without its period is not evidence of anything.
 */
export function ReportHeading({
  title,
  description,
  scope,
  actions,
}: {
  title: string;
  description: string;
  scope: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mt-5 mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
        <p className="mt-0.5 max-w-3xl text-sm text-ink-soft">{description}</p>
        <p className="tabular mt-1 text-[11px] text-ink-faint">{scope}</p>
      </div>
      {actions}
    </div>
  );
}

/** How a figure is calculated. Reports that do not say this get argued with. */
export function Definitions({ items }: { items: { term: string; meaning: ReactNode }[] }) {
  return (
    <details className="group mt-4 rounded-md border border-line bg-surface print:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-xs font-medium text-ink-soft hover:text-ink">
        <Info className="size-3.5 text-ink-faint" aria-hidden />
        How these figures are calculated
      </summary>
      <dl className="grid gap-x-6 gap-y-2 border-t border-line-soft px-4 py-3 text-xs sm:grid-cols-2">
        {items.map((i) => (
          <div key={i.term}>
            <dt className="font-medium text-ink">{i.term}</dt>
            <dd className="mt-0.5 text-ink-soft">{i.meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
