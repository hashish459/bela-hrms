import type { ReactNode } from "react";
import Link from "next/link";
import * as Icons from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

/* ----------------------------------------------------------------- prose */

/** Documentation body text, held to a readable measure. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex max-w-[68ch] flex-col gap-3 text-sm text-ink-soft", className)}>
      {children}
    </div>
  );
}

export function DocSection({
  id,
  title,
  lead,
  children,
}: {
  id?: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-16 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {lead ? <p className="mt-1 max-w-[68ch] text-sm text-ink-soft">{lead}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A short list of steps, numbered because the order matters. */
export function Steps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((s, i) => (
        <li key={s.title} className="flex gap-3">
          <span className="tabular mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
            {i + 1}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{s.title}</p>
            <div className="mt-0.5 max-w-[64ch] text-sm text-ink-soft">{s.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "ok";
  title: string;
  children: ReactNode;
}) {
  const styles = {
    info: "border-info/30 bg-info-soft text-info",
    warn: "border-warn/30 bg-warn-soft text-warn",
    ok: "border-ok/30 bg-ok-soft text-ok",
  }[tone];
  const Icon = { info: Icons.Info, warn: Icons.TriangleAlert, ok: Icons.CircleCheck }[tone];

  return (
    <div className={cn("flex gap-2.5 rounded-md border px-3 py-2.5", styles)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-0.5 max-w-[62ch] text-sm opacity-90">{children}</div>
      </div>
    </div>
  );
}

export function DocCards({
  items,
}: {
  items: { href: string; icon: string; title: string; body: string }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((c) => {
        const Icon =
          (Icons as unknown as Record<string, Icons.LucideIcon>)[c.icon] ?? Icons.FileText;
        return (
          <Link key={c.href} href={c.href} className="group">
            <Card className="h-full p-4 transition-colors group-hover:border-accent">
              <Icon className="size-5 text-accent" aria-hidden />
              <p className="mt-2.5 text-sm font-semibold text-ink">{c.title}</p>
              <p className="mt-1 text-xs text-ink-soft">{c.body}</p>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

/** Key/value reference table. */
export function DefTable({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th className="w-56 border-b border-line-soft bg-sunk px-3 py-2 text-left align-top text-xs font-medium text-ink-soft">
                {k}
              </th>
              <td className="border-b border-line-soft px-3 py-2 align-top text-ink-soft">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------- diagrams */

/**
 * Diagrams are inline SVG using the theme's own colour tokens, so they follow
 * light/dark and the chosen accent instead of being flat images that only look
 * right in one of them.
 */
export function Figure({
  caption,
  children,
  scroll = true,
}: {
  caption: string;
  children: ReactNode;
  scroll?: boolean;
}) {
  return (
    <figure className="rounded-md border border-line bg-surface">
      <div className={cn("p-4", scroll ? "overflow-x-auto" : "")}>{children}</div>
      <figcaption className="border-t border-line-soft px-4 py-2 text-xs text-ink-faint">
        {caption}
      </figcaption>
    </figure>
  );
}

export function Pill({
  x,
  y,
  w = 150,
  h = 34,
  label,
  sub,
  tone = "surface",
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  label: string;
  sub?: string;
  tone?: "surface" | "accent" | "sunk" | "warn";
}) {
  const fill = {
    surface: "var(--color-surface)",
    accent: "var(--color-accent-soft)",
    sunk: "var(--color-sunk)",
    warn: "var(--color-warn-soft)",
  }[tone];
  const stroke = {
    surface: "var(--color-line)",
    accent: "var(--color-accent)",
    sunk: "var(--color-line)",
    warn: "var(--color-warn)",
  }[tone];
  const text = tone === "accent" ? "var(--color-accent)" : "var(--color-ink)";

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={5} fill={fill} stroke={stroke} />
      <text
        x={x + w / 2}
        y={sub ? y + h / 2 - 3 : y + h / 2 + 4}
        textAnchor="middle"
        fill={text}
        fontSize="11.5"
        fontWeight="500"
      >
        {label}
      </text>
      {sub ? (
        <text
          x={x + w / 2}
          y={y + h / 2 + 10}
          textAnchor="middle"
          fill="var(--color-ink-faint)"
          fontSize="9.5"
        >
          {sub}
        </text>
      ) : null}
    </g>
  );
}

export function Arrow({
  from,
  to,
  label,
  dashed = false,
}: {
  from: [number, number];
  to: [number, number];
  label?: string;
  dashed?: boolean;
}) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="var(--color-ink-faint)"
        strokeWidth="1.2"
        strokeDasharray={dashed ? "4 3" : undefined}
        markerEnd="url(#arrowhead)"
      />
      {label ? (
        <text
          x={mx}
          y={my - 5}
          textAnchor="middle"
          fill="var(--color-ink-faint)"
          fontSize="9.5"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

export function ArrowDefs() {
  return (
    <defs>
      <marker
        id="arrowhead"
        markerWidth="7"
        markerHeight="7"
        refX="6.5"
        refY="2.5"
        orient="auto"
      >
        <path d="M0,0 L7,2.5 L0,5 z" fill="var(--color-ink-faint)" />
      </marker>
    </defs>
  );
}

/** Horizontal bar chart for the documentation pages. */
export function BarChart({
  data,
  max,
  unit = "",
}: {
  data: { label: string; value: number; tone?: "accent" | "warn" | "ok" | "info" }[];
  max?: number;
  unit?: string;
}) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  const colour = {
    accent: "var(--color-accent)",
    warn: "var(--color-warn)",
    ok: "var(--color-ok)",
    info: "var(--color-info)",
  };
  return (
    <div className="flex flex-col gap-1.5">
      {data.map((d) => (
        <div key={d.label} className="grid grid-cols-[9rem_1fr_4rem] items-center gap-2">
          <span className="truncate text-xs text-ink-soft">{d.label}</span>
          <span className="h-3.5 rounded-sm bg-sunk">
            <span
              className="block h-full rounded-sm"
              style={{
                width: `${(d.value / top) * 100}%`,
                background: colour[d.tone ?? "accent"],
              }}
            />
          </span>
          <span className="tabular text-right text-xs text-ink-soft">
            {d.value}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}
