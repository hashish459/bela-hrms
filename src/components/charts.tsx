import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Charts, drawn as SVG against the theme's own colour tokens.
 *
 * No charting library. Three reasons, in order of weight:
 *
 *   1. These are Server Components. A library that needs a canvas and a layout
 *      pass needs "use client", which turns a static panel into a hydration
 *      cost on every dashboard load.
 *   2. Theme tokens. A library colours from a JS palette, so it cannot follow
 *      light/dark or the chosen accent without re-rendering on the client.
 *   3. Honesty about scale. These are five-to-thirty-point summaries, not
 *      interactive exploration. A 90KB dependency to draw eight rectangles is
 *      not a trade worth making.
 *
 * Each chart here answers one question that a table answers worse. Anything a
 * table answers better stays a table.
 */

export type Slice = {
  label: string;
  value: number;
  /** A CSS colour. Pass a token — `var(--color-ok)` — so it follows the theme. */
  colour: string;
  hint?: string;
};

function total(slices: Slice[]) {
  return slices.reduce((sum, s) => sum + s.value, 0);
}

function pct(value: number, of: number) {
  return of === 0 ? 0 : (value / of) * 100;
}

/* -------------------------------------------------------------- donut */

/**
 * Donut. Use when the question is "what is this month made of" and the parts sum
 * to a meaningful whole — attendance statuses across a month do; headcount by
 * department does not, because nobody asks what proportion of the company is in
 * Finance as a first question.
 *
 * The centre carries the number the reader actually came for. A donut without a
 * centre figure is a pie chart with a hole in it.
 */
export function DonutChart({
  slices,
  centreValue,
  centreLabel,
  size = 168,
  thickness = 22,
}: {
  slices: Slice[];
  centreValue: ReactNode;
  centreLabel: string;
  size?: number;
  thickness?: number;
}) {
  const sum = total(slices);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  // Running offset, so each arc starts where the last one ended.
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${centreLabel}: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`}
        className="shrink-0"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-sunk)"
          strokeWidth={thickness}
        />
        {sum > 0 &&
          slices
            .filter((s) => s.value > 0)
            .map((s) => {
              const length = (s.value / sum) * circumference;
              const dash = `${length} ${circumference - length}`;
              const rotation = (offset / circumference) * 360 - 90;
              offset += length;
              return (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={s.colour}
                  strokeWidth={thickness}
                  strokeDasharray={dash}
                  transform={`rotate(${rotation} ${size / 2} ${size / 2})`}
                  // A hair of rounding on each arc reads as separation without
                  // the gaps a stroke-linecap of "round" would add to the sum.
                  strokeLinecap="butt"
                />
              );
            })}
        <text
          x={size / 2}
          y={size / 2 - 2}
          textAnchor="middle"
          className="tabular"
          fill="var(--color-ink)"
          fontSize="22"
          fontWeight="600"
        >
          {centreValue}
        </text>
        <text
          x={size / 2}
          y={size / 2 + 16}
          textAnchor="middle"
          fill="var(--color-ink-faint)"
          fontSize="10"
        >
          {centreLabel}
        </text>
      </svg>

      <ul className="flex min-w-40 flex-1 flex-col gap-1.5">
        {slices.map((s) => (
          <li key={s.label} className="flex items-baseline gap-2 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: s.colour }}
              aria-hidden
            />
            <span className="flex-1 truncate text-ink-soft">{s.label}</span>
            <span className="tabular font-medium text-ink">{s.value}</span>
            <span className="tabular w-10 text-right text-ink-faint">
              {pct(s.value, sum).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------- stacked bar chart */

export type StackedRow = {
  label: string;
  segments: { key: string; value: number }[];
  /** Shown at the end of the row — usually the total. */
  trailing?: ReactNode;
};

/**
 * Stacked bars. Use when every row shares the same categories and the reader
 * compares *composition* across rows — attendance mix per department, where the
 * question is which department has the absence problem, not how many people it
 * has.
 *
 * Rows are normalised to 100% by default, because comparing composition across
 * departments of different sizes is the whole point; pass `absolute` when the
 * magnitudes are themselves the comparison.
 */
export function StackedBarChart({
  rows,
  keys,
  absolute = false,
  className,
}: {
  rows: StackedRow[];
  keys: { key: string; label: string; colour: string }[];
  absolute?: boolean;
  className?: string;
}) {
  const max = Math.max(
    1,
    ...rows.map((r) => r.segments.reduce((sum, s) => sum + s.value, 0)),
  );

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {keys.map((k) => (
          <li key={k.key} className="flex items-center gap-1.5 text-[11px] text-ink-soft">
            <span
              className="size-2.5 rounded-sm"
              style={{ background: k.colour }}
              aria-hidden
            />
            {k.label}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2">
        {rows.map((row) => {
          const rowTotal = row.segments.reduce((sum, s) => sum + s.value, 0);
          const denominator = absolute ? max : rowTotal;
          return (
            <div
              key={row.label}
              className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-2.5"
            >
              <span className="truncate text-xs text-ink-soft" title={row.label}>
                {row.label}
              </span>
              <span
                className="flex h-4 overflow-hidden rounded-sm bg-sunk"
                role="img"
                aria-label={`${row.label}: ${row.segments
                  .map((s) => `${keys.find((k) => k.key === s.key)?.label ?? s.key} ${s.value}`)
                  .join(", ")}`}
              >
                {row.segments
                  .filter((s) => s.value > 0)
                  .map((s) => {
                    const key = keys.find((k) => k.key === s.key);
                    return (
                      <span
                        key={s.key}
                        title={`${key?.label ?? s.key}: ${s.value}`}
                        style={{
                          width: `${pct(s.value, denominator)}%`,
                          background: key?.colour ?? "var(--color-line)",
                        }}
                      />
                    );
                  })}
              </span>
              <span className="tabular text-right text-xs text-ink-soft">
                {row.trailing ?? rowTotal}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- waffle chart */

/**
 * Waffle. One hundred cells, one per percentage point.
 *
 * Use it for a single proportion a person is expected to *act* on — leave
 * utilisation, or the share of a month already closed. It beats a progress bar
 * because the reader can count the squares, and it beats a donut because there
 * is only one number and a donut of one slice is a circle.
 *
 * Not for more than three categories: past that, the eye cannot follow the fill
 * order and it becomes decoration.
 */
export function WaffleChart({
  slices,
  columns = 10,
  caption,
}: {
  slices: Slice[];
  columns?: number;
  caption?: string;
}) {
  const sum = total(slices);
  const cells = columns * columns;

  // Largest-remainder allocation, so the squares add up to exactly `cells`.
  // Rounding each slice independently loses or gains a square and the grid stops
  // being readable as percentages.
  const exact = slices.map((s) => (sum === 0 ? 0 : (s.value / sum) * cells));
  const floors = exact.map(Math.floor);
  let remaining = cells - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const { index } of order) {
    if (remaining <= 0) break;
    floors[index] += 1;
    remaining -= 1;
  }

  const filled: string[] = [];
  floors.forEach((count, index) => {
    for (let i = 0; i < count; i++) filled.push(slices[index].colour);
  });

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div
        className="grid shrink-0 gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${columns}, 0.6rem)` }}
        role="img"
        aria-label={
          caption ??
          slices.map((s) => `${s.label} ${pct(s.value, sum).toFixed(0)}%`).join(", ")
        }
      >
        {Array.from({ length: cells }, (_, i) => (
          <span
            key={i}
            className="size-2.5 rounded-[2px]"
            style={{ background: filled[i] ?? "var(--color-sunk)" }}
          />
        ))}
      </div>

      <ul className="flex min-w-36 flex-1 flex-col gap-1.5">
        {slices.map((s, i) => (
          <li key={s.label} className="text-xs">
            <span className="flex items-baseline gap-2">
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ background: s.colour }}
                aria-hidden
              />
              <span className="flex-1 truncate text-ink-soft">{s.label}</span>
              <span className="tabular font-medium text-ink">{floors[i]}%</span>
            </span>
            {s.hint ? <span className="block pl-4.5 text-[11px] text-ink-faint">{s.hint}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------- spark columns */

/**
 * A short run of columns — a fortnight of attendance, a month of requests.
 *
 * Deliberately unlabelled on the x-axis: at this size a date under every column
 * is unreadable, and the shape is the message. The title says the period.
 */
export function SparkColumns({
  points,
  height = 56,
}: {
  points: { label: string; value: number; tone?: "accent" | "warn" | "danger" | "ok" }[];
  height?: number;
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const colour = {
    accent: "var(--color-accent)",
    warn: "var(--color-warn)",
    danger: "var(--color-danger)",
    ok: "var(--color-ok)",
  };

  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {points.map((p) => (
        <span
          key={p.label}
          title={`${p.label}: ${p.value}`}
          className="min-w-1 flex-1 rounded-t-[2px]"
          style={{
            height: `${Math.max(2, (p.value / max) * height)}px`,
            background: colour[p.tone ?? "accent"],
          }}
        />
      ))}
    </div>
  );
}
