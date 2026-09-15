"use client";

import { useEffect } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  ACCENTS,
  ACCENT_LABEL,
  ACCENT_SWATCH,
  APPEARANCE_KEY,
  CONTRASTS,
  DENSITIES,
  FONTS,
  FONT_LABEL,
  SIZES,
  SIZE_LABEL,
  THEMES,
  applyAppearance,
  parseAppearance,
  type Appearance,
} from "@/lib/appearance";
import { usePersisted, writePersisted } from "@/lib/persisted";
import { cn } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui";

/** Reads the stored preferences and keeps <html> in step with them. */
function useAppearance(): [Appearance, (next: Partial<Appearance>) => void] {
  const raw = usePersisted(APPEARANCE_KEY);
  const current = parseAppearance(raw);

  // The bootstrap script sets the attributes on first paint; this keeps them
  // correct after a change, and is an external-system write, not component state.
  // Keyed on the raw stored string rather than the parsed object, which is a
  // fresh identity on every render.
  useEffect(() => {
    applyAppearance(parseAppearance(raw), document.documentElement);
  }, [raw]);

  return [
    current,
    (next) => writePersisted(APPEARANCE_KEY, JSON.stringify({ ...current, ...next })),
  ];
}

/** Compact light / dark / system switch for the header. */
export function ThemeToggle() {
  const [appearance, set] = useAppearance();
  const options = [
    { value: "light" as const, icon: Sun, label: "Light" },
    { value: "dark" as const, icon: Moon, label: "Dark" },
    { value: "system" as const, icon: Monitor, label: "System" },
  ];

  return (
    <div
      className="hidden items-center gap-0.5 rounded border border-line p-0.5 sm:flex"
      role="radiogroup"
      aria-label="Colour theme"
    >
      {options.map((o) => {
        const active = appearance.theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={`${o.label} theme`}
            onClick={() => set({ theme: o.value })}
            className={cn(
              "rounded p-1",
              active ? "bg-accent-soft text-accent" : "text-ink-faint hover:bg-sunk hover:text-ink",
            )}
          >
            <o.icon className="size-3.5" aria-hidden />
            <span className="sr-only">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function OptionRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 border-b border-line-soft px-4 py-3 last:border-b-0 sm:grid-cols-[14rem_1fr] sm:items-center">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-ink-faint">{hint}</p> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs",
        active
          ? "border-accent bg-accent-soft font-medium text-accent"
          : "border-line text-ink-soft hover:bg-sunk hover:text-ink",
      )}
    >
      {active ? <Check className="size-3" aria-hidden /> : null}
      {children}
    </button>
  );
}

/** The full panel, for Administration › Appearance. */
export function AppearanceSettings() {
  const [a, set] = useAppearance();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Appearance"
          description="Your own preference, stored in this browser. It does not change anything for anybody else."
        />

        <div role="radiogroup" aria-label="Colour theme">
          <OptionRow label="Colour theme" hint="System follows your operating system setting.">
            {THEMES.map((t) => (
              <Choice key={t} active={a.theme === t} onClick={() => set({ theme: t })}>
                <span className="capitalize">{t}</span>
              </Choice>
            ))}
          </OptionRow>
        </div>

        <div role="radiogroup" aria-label="Accent colour">
          <OptionRow label="Accent colour" hint="Used for links, active navigation and primary buttons.">
            {ACCENTS.map((c) => (
              <Choice key={c} active={a.accent === c} onClick={() => set({ accent: c })}>
                <span
                  className="size-3 rounded-full ring-1 ring-black/10"
                  style={{ background: ACCENT_SWATCH[c] }}
                  aria-hidden
                />
                {ACCENT_LABEL[c]}
              </Choice>
            ))}
          </OptionRow>
        </div>

        <div role="radiogroup" aria-label="Typeface">
          <OptionRow label="Typeface">
            {FONTS.map((f) => (
              <Choice key={f} active={a.font === f} onClick={() => set({ font: f })}>
                {FONT_LABEL[f]}
              </Choice>
            ))}
          </OptionRow>
        </div>

        <div role="radiogroup" aria-label="Text size">
          <OptionRow label="Text size" hint="Scales the whole interface, not just body text.">
            {SIZES.map((s) => (
              <Choice key={s} active={a.size === s} onClick={() => set({ size: s })}>
                {SIZE_LABEL[s]}
              </Choice>
            ))}
          </OptionRow>
        </div>

        <div role="radiogroup" aria-label="Row density">
          <OptionRow label="Row density" hint="Compact fits more rows on screen in the long registers.">
            {DENSITIES.map((d) => (
              <Choice key={d} active={a.density === d} onClick={() => set({ density: d })}>
                <span className="capitalize">{d}</span>
              </Choice>
            ))}
          </OptionRow>
        </div>

        <div role="radiogroup" aria-label="Contrast">
          <OptionRow label="Contrast" hint="Darkens secondary text and borders.">
            {CONTRASTS.map((c) => (
              <Choice key={c} active={a.contrast === c} onClick={() => set({ contrast: c })}>
                <span className="capitalize">{c}</span>
              </Choice>
            ))}
          </OptionRow>
        </div>
      </Card>

      <Card>
        <CardHeader title="Preview" description="Live — these are the real components." />
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded border border-transparent bg-accent px-3 py-1.5 text-sm font-medium text-on-accent">
              Primary action
            </button>
            <button className="rounded border border-line bg-surface px-3 py-1.5 text-sm text-ink">
              Secondary
            </button>
            <span className="rounded bg-ok-soft px-1.5 py-0.5 text-[11px] font-medium text-ok">
              Approved
            </span>
            <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn">
              Pending
            </span>
            <span className="rounded bg-danger-soft px-1.5 py-0.5 text-[11px] font-medium text-danger">
              Rejected
            </span>
          </div>
          <p className="max-w-prose text-sm text-ink-soft">
            Hari Bahadur Magar applied for 4 days of Home Leave from 2083-05-31, leaving 35 of 39
            days. The request is with Gopal Neupane.
          </p>
          <table className="w-full max-w-lg border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-line bg-sunk px-3 py-2 text-left text-[11px] tracking-wide text-ink-faint uppercase">
                  Employee
                </th>
                <th className="border-b border-line bg-sunk px-3 py-2 text-right text-[11px] tracking-wide text-ink-faint uppercase">
                  Worked
                </th>
                <th className="border-b border-line bg-sunk px-3 py-2 text-right text-[11px] tracking-wide text-ink-faint uppercase">
                  OT
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Rajendra Shrestha", "7h 40m", "13m"],
                ["Sunita Maharjan", "7h 37m", "5m"],
                ["Mina Chaudhary", "8h 25m", "1h 1m"],
              ].map(([n, w, o]) => (
                <tr key={n}>
                  <td className="border-b border-line-soft px-3 py-2 text-ink">{n}</td>
                  <td className="tabular border-b border-line-soft px-3 py-2 text-right text-ink-soft">
                    {w}
                  </td>
                  <td className="tabular border-b border-line-soft px-3 py-2 text-right text-info">
                    {o}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
