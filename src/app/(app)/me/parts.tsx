import type { ReactNode } from "react";
import Link from "next/link";
import * as Icons from "lucide-react";
import { Badge, Card, type Tone } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Presentation pieces shared across the Employee Desk.
 *
 * The desk is read by everybody in the organisation, most of them daily and
 * many of them on a phone in a factory corridor. So the components here are
 * biased towards legibility over density: larger touch targets, one idea per
 * card, and figures that state their unit rather than assuming the reader
 * remembers it.
 */

/* ----------------------------------------------------------------- headings */

export function DeskHeader({
  greeting,
  name,
  meta,
  action,
}: {
  greeting: string;
  name: string;
  meta: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div className="min-w-0">
        <p className="text-xs text-ink-faint">{greeting}</p>
        <h1 className="truncate text-xl font-semibold tracking-tight text-ink">{name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
          {meta}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Dot separator that disappears at the start of a wrapped line. */
export function Dot() {
  return (
    <span aria-hidden className="text-ink-faint">
      ·
    </span>
  );
}

/* -------------------------------------------------------------- quick action */

/**
 * The four things people come to the desk to do.
 *
 * Large, labelled, and above everything else. The legacy desk buried "apply for
 * leave" three clicks deep behind a menu called Leave and Fieldwork, and the
 * single most common support question was where to find it.
 */
export function QuickActions({
  items,
}: {
  items: { href: string; icon: string; label: string; hint: string }[];
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => {
        const Icon =
          (Icons as unknown as Record<string, Icons.LucideIcon>)[item.icon] ?? Icons.Circle;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="group flex items-center gap-3 rounded-md border border-line bg-surface px-3.5 py-3 transition-colors hover:border-accent hover:bg-accent-soft"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-on-accent">
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">{item.label}</span>
              <span className="block truncate text-[11px] text-ink-faint">{item.hint}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- panels */

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-line-soft px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[11px] text-ink-faint">{description}</p>
          ) : null}
        </div>
        {action}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </Card>
  );
}

export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="shrink-0 text-[11px] whitespace-nowrap text-accent hover:underline"
    >
      {children}
    </Link>
  );
}

export function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-xs text-ink-faint">{children}</p>;
}

/* ---------------------------------------------------------------- balances */

/**
 * A leave balance as a bar rather than four numbers.
 *
 * Entitled, used, pending and available is more arithmetic than anybody does at
 * a glance. The bar shows used and reserved against the whole, and the figure
 * people actually want — how many days they can still take — is the one set in
 * bold beside it.
 */
export function BalanceMeter({
  name,
  colour,
  entitled,
  used,
  pending,
  available,
}: {
  name: string;
  colour: string;
  entitled: number;
  used: number;
  pending: number;
  available: number;
}) {
  const total = Math.max(entitled, used + pending + Math.max(0, available), 1);
  const pct = (n: number) => `${Math.min(100, (n / total) * 100)}%`;

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: colour }}
            aria-hidden
          />
          <span className="truncate text-[13px] text-ink">{name}</span>
        </span>
        <span className="tabular shrink-0 text-[13px]">
          <span className="font-semibold text-ink">{available.toFixed(available % 1 ? 1 : 0)}</span>
          <span className="text-ink-faint"> / {entitled.toFixed(entitled % 1 ? 1 : 0)} days</span>
        </span>
      </div>

      <div
        className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-sunk"
        role="img"
        aria-label={`${name}: ${available} of ${entitled} days available, ${used} used, ${pending} reserved`}
      >
        <span style={{ width: pct(used), background: colour }} />
        <span
          style={{ width: pct(pending), background: colour, opacity: 0.4 }}
          title={`${pending} reserved by undecided requests`}
        />
      </div>

      {pending > 0 ? (
        <p className="mt-1 text-[10px] text-ink-faint">
          {pending} day{pending === 1 ? "" : "s"} held by a request awaiting a decision
        </p>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------ status colour */

/** One vocabulary for attendance status, used by every desk screen. */
export const STATUS_META: Record<string, { label: string; tone: Tone; dot: string }> = {
  present: { label: "Present", tone: "ok", dot: "var(--color-ok)" },
  field_work: { label: "Field work", tone: "info", dot: "var(--color-info)" },
  half_day: { label: "Half day", tone: "warn", dot: "var(--color-warn)" },
  on_leave: { label: "On leave", tone: "accent", dot: "var(--color-accent)" },
  absent: { label: "Absent", tone: "danger", dot: "var(--color-danger)" },
  missing_punch: { label: "Missing punch", tone: "warn", dot: "var(--color-warn)" },
  weekly_off: { label: "Weekly off", tone: "neutral", dot: "var(--color-line)" },
  holiday: { label: "Holiday", tone: "neutral", dot: "var(--color-line)" },
  not_marked: { label: "Not marked", tone: "neutral", dot: "var(--color-line)" },
};

export function StatusChip({ status }: { status: string | null }) {
  const meta = STATUS_META[status ?? "not_marked"] ?? STATUS_META.not_marked;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/* ----------------------------------------------------------------- avatars */

/** Initials, since almost nobody has uploaded a photograph. */
export function Avatar({
  name,
  photoUrl,
  size = 36,
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
}) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  // A photograph is rendered as a CSS background rather than an <img>: the URL is
  // arbitrary user data, next/image cannot optimise a host it does not know, and
  // a raw <img> would trip the bundler's own lint rule for good reasons. This
  // keeps the element a fixed-size circle whatever the source aspect ratio.
  if (photoUrl) {
    return (
      <span
        role="img"
        aria-label={name}
        className="shrink-0 rounded-full bg-sunk bg-cover bg-center"
        style={{ width: size, height: size, backgroundImage: `url(${JSON.stringify(photoUrl)})` }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-sunk font-semibold text-ink-soft"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials}
    </span>
  );
}

/* ------------------------------------------------------------------ tabs */

export function DeskTabs({
  items,
  active,
}: {
  items: { href: string; label: string; count?: number }[];
  active: string;
}) {
  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-line" aria-label="Profile sections">
      {items.map((item) => {
        const isActive = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors",
              isActive
                ? "border-accent font-medium text-accent"
                : "border-transparent text-ink-soft hover:border-line hover:text-ink",
            )}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 ? (
              <span className="tabular rounded-full bg-sunk px-1.5 text-[10px] text-ink-faint">
                {item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------- definition */

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line-soft">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-4 px-4 py-2">
          <dt className="w-40 shrink-0 text-xs text-ink-faint">{label}</dt>
          <dd className="min-w-0 flex-1 text-[13px] text-ink">{value || <Muted>—</Muted>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-ink-faint">{children}</span>;
}
