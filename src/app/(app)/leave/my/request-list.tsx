"use client";

import { useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Hourglass, Inbox } from "lucide-react";
import { StatusBadge } from "@/components/ui";
import { cn, formatDays } from "@/lib/utils";
import { WithdrawButton } from "./withdraw-button";

export type RequestItem = {
  id: string;
  reference: string;
  type: string;
  colour: string;
  fromDateBs: string;
  toDateBs: string;
  totalDays: string;
  status: string;
  reason: string;
  portion: string;
  waitingOn: string | null;
  upcoming: boolean;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Withdrawn" },
] as const;

const PORTION: Record<string, string> = { first_half: "First half", second_half: "Second half" };

/** The request history as a filterable timeline. Filtering is local: twenty rows need no round trip. */
export function RequestList({ items }: { items: RequestItem[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const counts = useMemo(() => {
    const out: Record<string, number> = { all: items.length };
    for (const i of items) out[i.status] = (out[i.status] ?? 0) + 1;
    return out;
  }, [items]);
  const shown = filter === "all" ? items : items.filter((i) => i.status === filter);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 border-b border-line-soft px-4 py-3" role="tablist" aria-label="Filter requests">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
              filter === f.key
                ? "border-accent bg-accent-soft font-medium text-accent"
                : "border-line text-ink-soft hover:bg-sunk hover:text-ink",
            )}
          >
            {f.label}
            <span className="tabular text-[10px] opacity-70">{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <Inbox className="size-6 text-ink-faint" aria-hidden />
          <p className="text-sm text-ink-soft">
            {items.length === 0 ? "No leave requests yet — the form above sends your first one." : "Nothing in this view."}
          </p>
        </div>
      ) : (
        <ol className="divide-y divide-line-soft">
          {shown.map((r) => (
            <li key={r.id} className="group relative flex gap-3 px-4 py-3.5 transition-colors hover:bg-sunk/50">
              <span className="w-1 shrink-0 rounded-full" style={{ background: r.colour }} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{r.type}</span>
                  <StatusBadge value={r.status} />
                  {r.upcoming && r.status === "approved" ? (
                    <span className="rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-medium text-info">upcoming</span>
                  ) : null}
                  <span className="ml-auto font-mono text-[11px] text-ink-faint">{r.reference}</span>
                </div>
                <p className="tabular mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-ink-soft">
                  <CalendarDays className="size-3.5 text-ink-faint" aria-hidden />
                  {r.fromDateBs}
                  {r.toDateBs !== r.fromDateBs ? (
                    <>
                      <ArrowRight className="size-3 text-ink-faint" aria-hidden />
                      {r.toDateBs}
                    </>
                  ) : null}
                  <span className="text-ink-faint">·</span>
                  <span className="font-medium text-ink">
                    {formatDays(r.totalDays)} {Number(r.totalDays) === 1 ? "day" : "days"}
                  </span>
                  {PORTION[r.portion] ? <span className="text-ink-faint">({PORTION[r.portion]})</span> : null}
                </p>
                {r.reason ? <p className="mt-1 line-clamp-2 text-xs text-ink-faint">{r.reason}</p> : null}
                {r.status === "pending" && r.waitingOn ? (
                  <p className="mt-1.5 inline-flex items-center gap-1 rounded bg-warn-soft px-2 py-0.5 text-[11px] text-warn">
                    <Hourglass className="size-3" aria-hidden />
                    Waiting on {r.waitingOn}
                  </p>
                ) : null}
              </div>
              {r.status === "pending" || r.status === "approved" ? (
                <div className="shrink-0 self-center">
                  <WithdrawButton requestId={r.id} reference={r.reference} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
