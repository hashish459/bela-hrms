import { Badge, type Tone } from "@/components/ui";
import { LEAVE_STATUS_LABEL, type LeaveStatus } from "@/modules/leave/reports";

/** A leave type as a coloured dot and its name — the colour is the type's own. */
export function TypePill({ name, colour, muted }: { name: string; colour: string; muted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
      <span className="size-2 shrink-0 rounded-full" style={{ background: colour }} aria-hidden />
      <span className={muted ? "text-ink-faint" : "text-ink"}>{name}</span>
    </span>
  );
}

const STATUS_TONE: Record<LeaveStatus, Tone> = {
  draft: "neutral",
  pending: "warn",
  approved: "ok",
  rejected: "danger",
  cancelled: "neutral",
};

export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{LEAVE_STATUS_LABEL[status]}</Badge>;
}

/** "2083-05-03 → 05-07", compact when both ends share the year. */
export function BsSpan({ from, to }: { from: string; to: string }) {
  if (from === to) return <span className="tabular">{from}</span>;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return (
    <span className="tabular whitespace-nowrap">
      {from} → {sameYear ? to.slice(5) : to}
    </span>
  );
}
