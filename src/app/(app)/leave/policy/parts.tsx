import { Badge, type Tone } from "@/components/ui";

/**
 * How each leave nature is described to a human.
 *
 * The words matter more than they look: "counts as present" and "counts as
 * leave" are the difference between a field engineer meeting their attendance
 * target and failing it, and the legacy system never said which one a leave type
 * would do until somebody ran the monthly report.
 */
export const NATURE_LABEL: Record<
  string,
  { label: string; attendance: string; tone: Tone }
> = {
  official_work: {
    label: "Field work",
    attendance: "Counts as present",
    tone: "info",
  },
  transit: {
    label: "Travel",
    attendance: "Counts as present",
    tone: "info",
  },
  paid: {
    label: "Paid leave",
    attendance: "Counts as leave",
    tone: "ok",
  },
  unpaid: {
    label: "Unpaid leave",
    attendance: "Counts as leave, unpaid",
    tone: "warn",
  },
  absent: {
    label: "Absence",
    attendance: "Counts as absent",
    tone: "danger",
  },
  substitute: {
    label: "Substitute",
    attendance: "Counts as leave, off a credit",
    tone: "accent",
  },
  holiday: {
    label: "Closure",
    attendance: "Counts as a holiday",
    tone: "neutral",
  },
};

export function NatureChip({ nature }: { nature: string }) {
  const meta = NATURE_LABEL[nature] ?? NATURE_LABEL.paid;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/** Pay percentage, coloured so an unpaid or part-paid type is obvious at a glance. */
export function PayChip({ percent }: { percent: number }) {
  const tone: Tone = percent >= 100 ? "ok" : percent === 0 ? "danger" : "warn";
  return (
    <Badge tone={tone}>
      <span className="tabular">{percent}%</span>
    </Badge>
  );
}
