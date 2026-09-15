import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ surfaces */

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-md border border-line bg-surface", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line-soft px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-ink-faint">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-soft">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm font-medium text-ink-soft">{title}</p>
      {hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------- status */

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-sunk text-ink-soft",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Maps the domain enums onto tones in one place, so status colour never drifts. */
export const STATUS_TONE: Record<string, Tone> = {
  // request lifecycle
  draft: "neutral",
  pending: "warn",
  approved: "ok",
  rejected: "danger",
  cancelled: "neutral",
  returned: "info",
  skipped: "neutral",
  // employment
  active: "ok",
  probation: "info",
  on_leave: "warn",
  suspended: "danger",
  resigned: "neutral",
  terminated: "danger",
  retired: "neutral",
};

export function StatusBadge({ value }: { value: string }) {
  return (
    <Badge tone={STATUS_TONE[value] ?? "neutral"}>{value.replace(/_/g, " ")}</Badge>
  );
}

/* ------------------------------------------------------------------- actions */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover border-transparent",
  secondary: "bg-surface text-ink border-line hover:bg-sunk",
  ghost: "bg-transparent text-ink-soft border-transparent hover:bg-sunk hover:text-ink",
  danger: "bg-danger-soft text-danger border-transparent hover:brightness-95",
};

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded border px-3 py-1.5 text-sm font-medium " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button className={cn(BUTTON_BASE, BUTTON_CLASS[variant], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={cn(BUTTON_BASE, BUTTON_CLASS[variant], className)} {...props} />;
}

/* -------------------------------------------------------------------- inputs */

const FIELD_CLASS =
  "w-full rounded border border-line bg-surface px-2.5 py-1.5 text-sm text-ink " +
  "placeholder:text-ink-faint disabled:bg-sunk disabled:text-ink-faint";

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs font-medium text-ink-soft">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="text-xs text-ink-faint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(FIELD_CLASS, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(FIELD_CLASS, "min-h-20 resize-y", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(FIELD_CLASS, "pr-8", className)} {...props} />;
}

/* -------------------------------------------------------------------- tables */

export function TableShell({
  children,
  className,
}: {
  children: ReactNode;
  /** Lets a caller drop the border when the table is already inside a card. */
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto rounded-md border border-line bg-surface", className)}>
      <table className="w-full min-w-[42rem] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-line bg-sunk px-3 py-2 text-left text-[11px] font-medium tracking-wide",
        "text-ink-faint uppercase whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return (
    <td className={cn("border-b border-line-soft px-3 py-2 align-middle", className)} {...props} />
  );
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("hover:bg-sunk/60", className)} {...props} />;
}

/* --------------------------------------------------------------------- stats */

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  const accentBar: Record<Tone, string> = {
    neutral: "bg-line",
    accent: "bg-accent",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    info: "bg-info",
  };
  return (
    <div className="flex items-stretch gap-3 rounded-md border border-line bg-surface p-3">
      <span className={cn("w-0.5 shrink-0 rounded-full", accentBar[tone])} aria-hidden />
      <div className="min-w-0">
        <p className="text-xs text-ink-faint">{label}</p>
        <p className="tabular mt-1 text-2xl leading-none font-semibold text-ink">{value}</p>
        {sub ? <p className="mt-1.5 text-xs text-ink-faint">{sub}</p> : null}
      </div>
    </div>
  );
}

/** Proportional bar for a balance or utilisation figure. */
export function MeterBar({
  used,
  total,
  tone = "accent",
}: {
  used: number;
  total: number;
  tone?: Tone;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const fill: Record<Tone, string> = {
    neutral: "bg-ink-faint",
    accent: "bg-accent",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    info: "bg-info",
  };
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunk">
        <div className={cn("h-full rounded-full", fill[tone])} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular w-9 shrink-0 text-right text-[11px] text-ink-faint">{pct}%</span>
    </div>
  );
}
