"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavModule } from "@/components/app-nav";

/**
 * The keyboard layer for the whole product.
 *
 *   Ctrl/⌘ K   command palette — every screen the viewer can open
 *   g then …   jump straight to a screen (g d dashboard, g l leave, …)
 *   [          collapse / expand the sidebar
 *   ?          this list
 *   /          find a screen in the sidebar (owned by the sidebar)
 *
 * Single keys are ignored while somebody is typing, and every chord only
 * exists when the viewer can open the screen it points at — the targets come
 * from the same permission-filtered modules as the sidebar.
 */

type Target = { id: string; label: string; href: string; module: string; icon?: string };

/** Second key of a `g` chord → a nav item id, tried in order until one is available. */
const CHORDS: { key: string; label: string; ids: string[] }[] = [
  { key: "d", label: "Dashboard", ids: ["dashboard"] },
  { key: "a", label: "My attendance", ids: ["attendance.my", "attendance.register"] },
  { key: "l", label: "My leave", ids: ["leave.my", "leave.register"] },
  { key: "o", label: "Overtime", ids: ["attendance.overtime"] },
  { key: "w", label: "Work-Book", ids: ["workbook.my", "workbook.records"] },
  { key: "c", label: "Leave calendar", ids: ["leave.calendar"] },
  { key: "e", label: "Employees", ids: ["hr.employees"] },
  { key: "n", label: "Notifications", ids: ["self.notifications"] },
  { key: "s", label: "Appearance settings", ids: ["admin.settings"] },
];

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  if (!t) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}

function Icon({ name, className }: { name?: string; className?: string }) {
  const C = (name && (Icons as unknown as Record<string, Icons.LucideIcon>)[name]) || Icons.Circle;
  return <C className={className} aria-hidden />;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-line bg-sunk px-1 font-mono text-[10px] leading-4 text-ink-soft">
      {children}
    </kbd>
  );
}

export function KeyboardShortcuts({ modules, onToggleSidebar }: { modules: NavModule[]; onToggleSidebar: () => void }) {
  const router = useRouter();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [chord, setChord] = useState(false);

  const targets = useMemo<Target[]>(() => {
    const out: Target[] = [{ id: "dashboard", label: "Dashboard", href: "/dashboard", module: "Home", icon: "LayoutDashboard" }];
    for (const m of modules) {
      for (const s of m.sections) {
        for (const i of s.items) out.push({ id: i.id, label: i.label, href: i.href, module: m.label, icon: i.icon ?? m.icon });
      }
    }
    return out;
  }, [modules]);

  const chords = useMemo(
    () =>
      CHORDS.map((c) => ({ ...c, target: c.ids.map((id) => targets.find((t) => t.id === id)).find(Boolean) })).filter(
        (c): c is typeof c & { target: Target } => Boolean(c.target),
      ),
    [targets],
  );

  const toggle = useRef(onToggleSidebar);
  useEffect(() => {
    toggle.current = onToggleSidebar;
  }, [onToggleSidebar]);

  useEffect(() => {
    let chordTimer: number | undefined;
    let pending = false;
    const endChord = () => {
      pending = false;
      setChord(false);
      window.clearTimeout(chordTimer);
    };

    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setHelp(false);
        setPalette((p) => !p);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]:not([data-shortcuts]), [role="alertdialog"]')) return;

      if (pending) {
        const c = chords.find((x) => x.key === e.key.toLowerCase());
        endChord();
        if (c) {
          e.preventDefault();
          router.push(c.target.href);
        }
        return;
      }
      if (e.key === "g") {
        pending = true;
        setChord(true);
        chordTimer = window.setTimeout(endChord, 1500);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setPalette(false);
        setHelp((h) => !h);
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        toggle.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(chordTimer);
    };
  }, [chords, router]);

  return (
    <>
      {chord ? (
        <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-soft shadow-lg print:hidden" role="status">
          <Kbd>g</Kbd> then… {chords.slice(0, 6).map((c) => `${c.key} ${c.label.toLowerCase()}`).join(" · ")}
        </div>
      ) : null}
      {palette ? (
        <Palette
          targets={targets}
          onClose={() => setPalette(false)}
          onGo={(href) => {
            setPalette(false);
            router.push(href);
          }}
        />
      ) : null}
      {help ? <Help chords={chords} onClose={() => setHelp(false)} /> : null}
    </>
  );
}

function Overlay({ label, onClose, children, className }: { label: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      // keep Tab inside the panel
      if (e.key === "Tab" && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh] print:hidden" role="dialog" aria-modal="true" aria-label={label} data-shortcuts>
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" />
      <div ref={panel} className={cn("relative w-full overflow-hidden rounded-lg border border-line bg-surface shadow-2xl", className)}>
        {children}
      </div>
    </div>
  );
}

function Palette({ targets, onClose, onGo }: { targets: Target[]; onClose: () => void; onGo: (href: string) => void }) {
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const scored = targets
      .map((t) => {
        const hay = `${t.label} ${t.module}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        const label = t.label.toLowerCase();
        const score = words.length === 0 ? 0 : label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 1 : 2;
        return { t, score };
      })
      .filter((x): x is { t: Target; score: number } => x !== null);
    return scored.sort((a, b) => a.score - b.score).map((x) => x.t).slice(0, 50);
  }, [q, targets]);

  const active = Math.min(index, Math.max(0, results.length - 1));

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <Overlay label="Go to a screen" onClose={onClose} className="max-w-xl">
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Icons.Search className="size-4 text-ink-faint" aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "Home") {
              setIndex(0);
            } else if (e.key === "End") {
              setIndex(results.length - 1);
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              onGo(results[active].href);
            }
          }}
          placeholder="Go to a screen…"
          className="h-12 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint"
          style={{ outline: "none" }}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
          aria-label="Search screens"
        />
        <Kbd>Esc</Kbd>
      </div>
      <ul id="palette-results" ref={list} role="listbox" className="max-h-80 overflow-y-auto p-1.5">
        {results.length === 0 ? (
          <li className="px-3 py-8 text-center text-sm text-ink-faint">Nothing matches “{q}”.</li>
        ) : (
          results.map((t, i) => (
            <li
              key={t.id}
              id={`palette-${t.id}`}
              role="option"
              aria-selected={i === active}
              data-index={i}
              onMouseMove={() => setIndex(i)}
              onClick={() => onGo(t.href)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm",
                i === active ? "bg-accent-soft text-accent" : "text-ink-soft",
              )}
            >
              <Icon name={t.icon} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-medium">{t.label}</span>
              <span className="truncate text-[11px] text-ink-faint">{t.module}</span>
              {i === active ? <Icons.CornerDownLeft className="size-3.5 shrink-0" aria-hidden /> : null}
            </li>
          ))
        )}
      </ul>
      <div className="flex flex-wrap items-center gap-3 border-t border-line bg-sunk/50 px-3 py-2 text-[11px] text-ink-faint">
        <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span className="flex items-center gap-1"><Kbd>Enter</Kbd> open</span>
        <span className="flex items-center gap-1"><Kbd>?</Kbd> all shortcuts</span>
      </div>
    </Overlay>
  );
}

function Help({ chords, onClose }: { chords: { key: string; label: string }[]; onClose: () => void }) {
  const groups: { title: string; rows: [React.ReactNode, string][] }[] = [
    {
      title: "Anywhere",
      rows: [
        [<><Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> <Kbd>K</Kbd></>, "Go to any screen"],
        [<Kbd key="s">/</Kbd>, "Find a screen in the sidebar"],
        [<Kbd key="b">[</Kbd>, "Collapse or expand the sidebar"],
        [<><Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> <Kbd>P</Kbd></>, "Print the page as a report"],
        [<Kbd key="q">?</Kbd>, "Show this list"],
        [<Kbd key="e">Esc</Kbd>, "Close a drawer, dialog or search"],
      ],
    },
    { title: "Go to — press g, then", rows: chords.map((c) => [<Kbd key={c.key}>{c.key}</Kbd>, c.label]) },
    {
      title: "In lists and forms",
      rows: [
        [<><Kbd>Tab</Kbd> / <Kbd>Shift</Kbd><Kbd>Tab</Kbd></>, "Next / previous control"],
        [<><Kbd>↑</Kbd> <Kbd>↓</Kbd></>, "Move through the sidebar and menus"],
        [<><Kbd>Home</Kbd> <Kbd>End</Kbd></>, "First / last sidebar entry"],
        [<><Kbd>Enter</Kbd> / <Kbd>Space</Kbd></>, "Open, press or toggle"],
      ],
    },
  ];
  return (
    <Overlay label="Keyboard shortcuts" onClose={onClose} className="max-w-2xl">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icons.Keyboard className="size-4 text-accent" aria-hidden />
          Keyboard shortcuts
        </h2>
        <button type="button" onClick={onClose} className="rounded p-1 text-ink-faint hover:bg-sunk hover:text-ink" aria-label="Close">
          <Icons.X className="size-4" />
        </button>
      </header>
      <div className="grid gap-5 p-4 sm:grid-cols-2">
        {groups.map((g) => (
          <section key={g.title} className={g.title.startsWith("Go") ? "sm:row-span-2" : undefined}>
            <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-faint uppercase">{g.title}</h3>
            <dl className="flex flex-col gap-1.5">
              {g.rows.map(([k, label], i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-xs">
                  <dt className="text-ink-soft">{label}</dt>
                  <dd className="flex shrink-0 items-center gap-0.5 text-ink-faint">{k}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Overlay>
  );
}
